import page1 from "./fixtures/usajobs-search-page1.json";
import page2 from "./fixtures/usajobs-search-page2.json";
import {
  annualSalaryRange,
  formatUsajobsSalary,
  mapUsajobsItem,
  parseUsajobsDate,
} from "@/lib/scraper/usajobs/mapper";
import { jobDedupeKey, normalizeJobUrl } from "@/lib/scraper/utils";

const items = page1.SearchResult.SearchResultItems as any[];

describe("mapUsajobsItem (full announcement)", () => {
  const job = mapUsajobsItem(items[0])!;

  it("maps title, agency as company, and the display location", () => {
    expect(job.title).toBe("IT Specialist (APPSW)");
    expect(job.company).toBe("Office of the Chief Information Officer");
    expect(job.location).toBe("Washington, District of Columbia");
  });

  it("uses PositionURI as the url", () => {
    expect(job.url).toBe("https://www.usajobs.gov:443/job/812345600");
  });

  it("formats salary with the pay interval", () => {
    expect(job.salary).toBe("$86,962 - $113,050 per year");
  });

  it("converts the zone-less publication date to a UTC ISO string", () => {
    expect(job.postedDate).toBe("2026-10-01T00:00:00.000Z");
  });

  it("passes the application close date through as dueDate", () => {
    expect(job.dueDate).toBe("2099-12-31T23:59:59.997Z");
  });

  it("maps Full-time schedule to an employmentType normalizeJobType reads as FT", () => {
    expect(job.employmentType).toBe("Full-time");
  });

  it("reads RemoteIndicator 'False' as isRemote=false", () => {
    expect(job.isRemote).toBe(false);
  });

  it("builds a factual description header plus body sections", () => {
    const d = job.description;
    expect(d).toContain("Announcement number: DE-12345678-26-ABC");
    expect(d).toContain("Control number: 812345600");
    expect(d).toContain("Agency: Office of the Chief Information Officer");
    expect(d).toContain("Department: Department of Veterans Affairs");
    expect(d).toContain("Grade: GS 11-12");
    expect(d).toContain("Series: 2210 Information Technology Management");
    expect(d).toContain("Schedule: Full-time");
    expect(d).toContain("Appointment type: Permanent");
    expect(d).toContain("Hiring path: public, vet");
    expect(d).toContain("Security clearance: Secret");
    expect(d).toContain("Telework eligible: Yes");
    expect(d).toContain("Closes: 2099-12-31");
    expect(d).toContain("Apply: https://www.usajobs.gov:443/job/812345600/apply");
    expect(d).toContain("Summary\nDevelops and maintains application software.");
    expect(d).toContain("Major duties\nDesigns and tests software.\nDocuments system changes.");
    expect(d).toContain("Qualifications\nYou must have one year");
  });
});

describe("mapUsajobsItem (sparse / unusual announcements)", () => {
  it("maps a temporary part-time hourly remote job", () => {
    const job = mapUsajobsItem(items[1])!;
    expect(job.company).toBe("Forest Service");
    expect(job.location).toBe("Multiple Locations");
    expect(job.salary).toBe("$21.50 - $28 per hour");
    expect(job.employmentType).toBe("Temporary"); // offering type wins
    expect(job.isRemote).toBe(true);
  });

  it("omits absent fields instead of inventing them", () => {
    const job = mapUsajobsItem(items[2])!;
    expect(job.salary).toBeUndefined();
    expect(job.postedDate).toBeUndefined();
    expect(job.dueDate).toBeUndefined();
    expect(job.isRemote).toBeUndefined();
    expect(job.employmentType).toBeUndefined();
    expect(job.description).not.toMatch(/Grade:|Series:|Closes:|Apply:|Summary/);
    expect(job.description).toContain("Agency: Department of Energy");
  });

  it("falls back to de-duplicated PositionLocation names", () => {
    expect(mapUsajobsItem(items[2])!.location).toBe(
      "Oak Ridge, Tennessee; Richland, Washington",
    );
  });

  it("skips an item with no link (url is the dedupe identity)", () => {
    const noLink = (page2.SearchResult.SearchResultItems as any[])[1];
    expect(mapUsajobsItem(noLink)).toBeNull();
  });

  it("falls back to ApplyURI when PositionURI is missing", () => {
    const job = mapUsajobsItem({
      MatchedObjectDescriptor: {
        PositionTitle: "X",
        OrganizationName: "Y",
        ApplyURI: ["https://example.gov/apply/1"],
      },
    })!;
    expect(job.url).toBe("https://example.gov/apply/1");
  });

  it("uses DepartmentName when OrganizationName is missing", () => {
    const job = mapUsajobsItem({
      MatchedObjectDescriptor: {
        PositionTitle: "X",
        DepartmentName: "Dept",
        PositionURI: "https://example.gov/job/1",
      },
    })!;
    expect(job.company).toBe("Dept");
  });

  it.each([
    [null],
    [undefined],
    [{}],
    [{ MatchedObjectDescriptor: null }],
    [{ MatchedObjectDescriptor: "nope" }],
    [{ MatchedObjectDescriptor: { PositionTitle: 42 } }],
  ])("returns null (no throw) for malformed item %j", (item) => {
    expect(() => mapUsajobsItem(item as any)).not.toThrow();
    expect(mapUsajobsItem(item as any)).toBeNull();
  });

  it("tolerates wrong-typed optional fields without throwing", () => {
    const job = mapUsajobsItem({
      MatchedObjectId: 7,
      MatchedObjectDescriptor: {
        PositionTitle: "Title",
        OrganizationName: "Org",
        PositionURI: "https://example.gov/job/7",
        PositionRemuneration: "oops",
        JobCategory: { Name: "x" },
        PositionSchedule: [null, 5, { Name: 9 }],
        ApplyURI: 12,
        PublicationStartDate: "not a date",
        ApplicationCloseDate: {},
        UserArea: { Details: { HiringPath: 3, RemoteIndicator: "maybe", MajorDuties: 4 } },
      },
    } as any)!;
    expect(job.title).toBe("Title");
    expect(job.salary).toBeUndefined();
    expect(job.postedDate).toBeUndefined();
    expect(job.dueDate).toBeUndefined();
    expect(job.isRemote).toBeUndefined();
    expect(job.description).toContain("Control number: 7");
  });

  it("keeps paragraph breaks and strips HTML in text fields", () => {
    const job = mapUsajobsItem({
      MatchedObjectDescriptor: {
        PositionTitle: "T",
        OrganizationName: "O",
        PositionURI: "https://example.gov/job/9",
        QualificationSummary: "<p>One &amp; two</p><p>Three</p>",
      },
    })!;
    expect(job.description).toContain("Qualifications\nOne & two\nThree");
  });
});

describe("salary and date helpers", () => {
  it("formats a single value (min == max) without a range", () => {
    expect(
      formatUsajobsSalary([
        { MinimumRange: "100000", MaximumRange: "100000", RateIntervalCode: "PA" },
      ]),
    ).toBe("$100,000 per year");
  });

  it("uses the API description over the code, and the raw code as a last resort", () => {
    expect(
      formatUsajobsSalary([
        { MinimumRange: 10, MaximumRange: 20, RateIntervalCode: "BW", Description: "Bi-weekly" },
      ]),
    ).toBe("$10 - $20 bi-weekly");
    expect(
      formatUsajobsSalary([{ MinimumRange: 10, MaximumRange: 20, RateIntervalCode: "ZZ" }]),
    ).toBe("$10 - $20 ZZ");
  });

  it("ignores unparseable and negative amounts", () => {
    expect(formatUsajobsSalary([{ MinimumRange: "abc", MaximumRange: null }])).toBeUndefined();
    expect(formatUsajobsSalary([{ MinimumRange: -5, MaximumRange: -1 }])).toBeUndefined();
    expect(formatUsajobsSalary(undefined)).toBeUndefined();
  });

  it("reports an annual range only for per-year rows", () => {
    expect(
      annualSalaryRange([{ MinimumRange: "50000", MaximumRange: "70000", RateIntervalCode: "PA" }]),
    ).toEqual({ min: 50000, max: 70000 });
    expect(
      annualSalaryRange([{ MinimumRange: "20", MaximumRange: "30", RateIntervalCode: "PH" }]),
    ).toBeUndefined();
  });

  it("parses zone-less, zoned and invalid dates deterministically", () => {
    expect(parseUsajobsDate("2026-10-01T00:00:00.0000")).toBe("2026-10-01T00:00:00.000Z");
    expect(parseUsajobsDate("2026-10-01T05:00:00+05:00")).toBe("2026-10-01T00:00:00.000Z");
    expect(parseUsajobsDate("garbage")).toBeUndefined();
    expect(parseUsajobsDate(null)).toBeUndefined();
  });
});

describe("stable identity / dedupe key", () => {
  it("normalizeJobUrl drops the :443 port but keeps the announcement id path", () => {
    expect(normalizeJobUrl("https://www.usajobs.gov:443/job/812345600")).toBe(
      "https://www.usajobs.gov/job/812345600",
    );
  });

  it("the same announcement keys identically with or without the port", () => {
    const a = jobDedupeKey({ url: "https://www.usajobs.gov:443/job/812345600" });
    const b = jobDedupeKey({ url: "https://www.usajobs.gov/job/812345600/?utm_source=x" });
    expect(a).toBe(b);
    expect(a).toBe("url:usajobs.gov/job/812345600");
  });

  it("two announcements with the same title/agency but different ids do not merge", () => {
    const base = { title: "IT Specialist", company: "VA", location: "DC" };
    expect(
      jobDedupeKey({ ...base, url: "https://www.usajobs.gov/job/1" }),
    ).not.toBe(jobDedupeKey({ ...base, url: "https://www.usajobs.gov/job/2" }));
  });

  it("a USAJOBS job is not merged with another source's job of the same title", () => {
    const base = { title: "IT Specialist", company: "VA", location: "DC" };
    expect(
      jobDedupeKey({ ...base, url: "https://www.usajobs.gov/job/1" }),
    ).not.toBe(jobDedupeKey({ ...base, url: "https://jobs.lever.co/va/abc" }));
  });
});
