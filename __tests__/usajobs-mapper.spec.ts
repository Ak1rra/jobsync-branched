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

  it("builds an HTML description: bold-label fact list, then headed sections", () => {
    const d = job.description;
    expect(d.startsWith("<ul><li><strong>Announcement number:</strong> DE-12345678-26-ABC</li>")).toBe(true);
    expect(d).toContain("<li><strong>Control number:</strong> 812345600</li>");
    expect(d).toContain("<li><strong>Agency:</strong> Office of the Chief Information Officer</li>");
    expect(d).toContain("<li><strong>Department:</strong> Department of Veterans Affairs</li>");
    expect(d).toContain("<li><strong>Grade:</strong> GS 11-12</li>");
    expect(d).toContain("<li><strong>Series:</strong> 2210 Information Technology Management</li>");
    expect(d).toContain("<li><strong>Schedule:</strong> Full-time</li>");
    expect(d).toContain("<li><strong>Appointment type:</strong> Permanent</li>");
    expect(d).toContain("<li><strong>Security clearance:</strong> Secret</li>");
    expect(d).toContain("<li><strong>Telework eligible:</strong> Yes</li>");
    expect(d).toContain("<h3>Summary</h3><p>Develops and maintains application software.</p>");
    expect(d).toContain(
      "<h3>Major duties</h3><ul><li>Designs and tests software.</li><li>Documents system changes.</li></ul>",
    );
    expect(d).toContain("<h3>Qualifications</h3><p>You must have one year");
    // facts come first, then the sections in order
    expect(d.indexOf("<h3>Summary")).toBeGreaterThan(d.indexOf("Telework eligible"));
    expect(d.indexOf("<h3>Major duties")).toBeGreaterThan(d.indexOf("<h3>Summary"));
    expect(d.indexOf("<h3>Qualifications")).toBeGreaterThan(d.indexOf("<h3>Major duties"));
  });

  it("shows hiring-path codes as labels", () => {
    expect(job.description).toContain(
      "<li><strong>Hiring path:</strong> Open to the public, Veterans</li>",
    );
  });

  it("formats the close date with the app's date convention (PP)", () => {
    expect(job.description).toContain("<li><strong>Closes:</strong> Dec 31, 2099</li>");
    expect(job.description).not.toContain("2099-12-31");
  });

  it("strips the default port from the displayed apply link only", () => {
    expect(job.description).toContain(
      '<li><strong>Apply:</strong> <a href="https://www.usajobs.gov/job/812345600/apply">https://www.usajobs.gov/job/812345600/apply</a></li>',
    );
    expect(job.description).not.toContain(":443");
  });

  it("leaves the stored url (the dedupe key) untouched, port included", () => {
    expect(job.url).toBe("https://www.usajobs.gov:443/job/812345600");
  });
});

describe("description structure and cleaning", () => {
  const wrap = (details: object, descriptor: object = {}) =>
    mapUsajobsItem({
      MatchedObjectDescriptor: {
        PositionTitle: "T",
        OrganizationName: "O",
        PositionURI: "https://example.gov:443/job/1",
        ...descriptor,
        UserArea: { Details: details },
      },
    })!;

  it("escapes hostile text in facts, headings content and links", () => {
    const job = wrap(
      {
        SecurityClearance: '<script>alert(1)</script> "x" & y',
        JobSummary: "<script>alert(2)</script>safe <b>bold</b>",
        MajorDuties: ["<img src=x onerror=alert(3)>", "a < b & c"],
      },
      {
        PositionID: "<b>id</b>",
        ApplyURI: ['https://example.gov/a?x="><script>alert(4)</script>'],
      },
    );
    const d = job.description;
    expect(d).not.toMatch(/<script|<img|<b>/i);
    expect(d).not.toContain('"><');
    expect(d).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot; &amp; y");
    expect(d).toContain("&lt;b&gt;id&lt;/b&gt;");
    expect(d).toContain("<li>a &lt; b &amp; c</li>");
  });

  it("renders a multi-line text field as one paragraph per line, not a list", () => {
    const d = wrap({ JobSummary: "First para.\r\n\r\nSecond   para." }).description;
    expect(d).toContain("<h3>Summary</h3><p>First para.</p><p>Second para.</p>");
  });

  it("renders a single-element MajorDuties array as a paragraph", () => {
    expect(wrap({ MajorDuties: ["Only duty."] }).description).toContain(
      "<h3>Major duties</h3><p>Only duty.</p>",
    );
  });

  it("falls back to the raw code for an unknown or prototype-ish hiring path", () => {
    const d = wrap({ HiringPath: ["public", "brand-new", "constructor", "public"] }).description;
    expect(d).toContain("<strong>Hiring path:</strong> Open to the public, brand-new, constructor</li>");
  });

  it("accepts a single-string hiring path", () => {
    expect(wrap({ HiringPath: "vet" }).description).toContain(
      "<strong>Hiring path:</strong> Veterans</li>",
    );
  });

  it("collapses odd whitespace in fact values", () => {
    expect(wrap({ SecurityClearance: "  Top \n\t Secret  " }).description).toContain(
      "<strong>Security clearance:</strong> Top Secret</li>",
    );
  });

  it("drops Department/Sub-agency when they repeat the agency", () => {
    const d = wrap(
      { SubAgencyName: "office of x" },
      { OrganizationName: "Office of X", DepartmentName: " OFFICE OF X " },
    ).description;
    expect(d).toContain("<strong>Agency:</strong> Office of X</li>");
    expect(d).not.toContain("Department:");
    expect(d).not.toContain("Sub-agency:");
  });

  it("omits an unparseable or non-http apply link rather than showing it", () => {
    expect(wrap({}, { ApplyURI: ["javascript:alert(1)"] }).description).not.toContain("Apply:");
    expect(wrap({}, { ApplyURI: ["not a url"] }).description).not.toContain("Apply:");
  });

  it("omits empty facts and sections entirely (no empty list or heading)", () => {
    const job = mapUsajobsItem({
      MatchedObjectDescriptor: {
        PositionTitle: "T",
        OrganizationName: "",
        DepartmentName: "D",
        PositionURI: "https://example.gov/job/2",
        QualificationSummary: "   ",
      },
    })!;
    expect(job.description).toBe("<ul><li><strong>Department:</strong> D</li></ul>");
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
    expect(job.description).toContain("<strong>Agency:</strong> Department of Energy</li>");
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
    expect(job.description).toContain("<strong>Control number:</strong> 7</li>");
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
    expect(job.description).toContain(
      "<h3>Qualifications</h3><p>One &amp; two</p><p>Three</p>",
    );
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
