import {
  cleanUsajobsConfig,
  hasSecondaryUsajobsFilters,
  isUsajobsConfigValid,
  summarizeUsajobsFilters,
  usajobsIssues,
} from "@/components/automations/ats-search-step/usajobsConfig";
import type { UsajobsSourceConfig } from "@/models/automation.model";

const base: UsajobsSourceConfig = {
  targetTitles: [],
  keywords: [],
  locations: [],
  strictLocation: false,
  topK: 10,
  saveUnanalyzed: true,
};

describe("cleanUsajobsConfig", () => {
  it("drops blank strings, empty lists, undefined and NaN from the filters", () => {
    const cleaned = cleanUsajobsConfig({
      ...base,
      keyword: "  ",
      positionTitle: "Nurse",
      organization: [],
      radius: undefined,
      datePosted: Number.NaN,
    });
    expect(cleaned).not.toHaveProperty("keyword");
    expect(cleaned).not.toHaveProperty("organization");
    expect(cleaned).not.toHaveProperty("radius");
    expect(cleaned).not.toHaveProperty("datePosted");
    expect(cleaned.positionTitle).toBe("Nurse");
  });

  it("keeps the ranking fields as-is, including empty lists", () => {
    const cleaned = cleanUsajobsConfig({ ...base, keyword: "x" });
    expect(cleaned.targetTitles).toEqual([]);
    expect(cleaned.keywords).toEqual([]);
    expect(cleaned.strictLocation).toBe(false);
    expect(cleaned.topK).toBe(10);
  });

  it("drops a radius that has no location", () => {
    expect(
      cleanUsajobsConfig({ ...base, keyword: "x", radius: 5 }),
    ).not.toHaveProperty("radius");
    expect(
      cleanUsajobsConfig({ ...base, locationName: ["Denver"], radius: 5 })
        .radius,
    ).toBe(5);
  });
});

describe("usajobsIssues / isUsajobsConfigValid", () => {
  it("requires at least one search criterion", () => {
    expect(isUsajobsConfigValid(base)).toBe(false);
    expect(usajobsIssues(base)[0].message).toMatch(
      /at least one search criterion/i,
    );
  });

  it.each([
    ["keyword", { keyword: "x" }],
    ["positionTitle", { positionTitle: "x" }],
    ["locationName", { locationName: ["Denver"] }],
    ["organization", { organization: ["AF"] }],
    ["jobCategoryCode", { jobCategoryCode: ["2210"] }],
  ])("accepts %s as the criterion", (_name, patch) => {
    expect(isUsajobsConfigValid({ ...base, ...patch })).toBe(true);
    expect(usajobsIssues({ ...base, ...patch })).toEqual([]);
  });

  it("does not count a filter-only config as a criterion", () => {
    expect(isUsajobsConfigValid({ ...base, hiringPath: ["vet"] })).toBe(false);
  });

  it("reports min above max and grade inversion with the field named", () => {
    const issues = usajobsIssues({
      ...base,
      keyword: "x",
      remunerationMinimumAmount: 9,
      remunerationMaximumAmount: 1,
      payGradeLow: "12",
      payGradeHigh: "05",
    });
    expect(issues.map((i) => i.message)).toEqual([
      expect.stringMatching(/minimum pay exceeds maximum pay/i),
      expect.stringMatching(/low pay grade exceeds high pay grade/i),
    ]);
  });
});

describe("hasSecondaryUsajobsFilters", () => {
  it("is false for the primary block and ranking fields only", () => {
    expect(
      hasSecondaryUsajobsFilters({
        ...base,
        keyword: "x",
        locationName: ["Denver"],
        radius: 5,
      }),
    ).toBe(false);
  });

  it("is true once any secondary filter is set", () => {
    expect(hasSecondaryUsajobsFilters({ ...base, datePosted: 7 })).toBe(true);
  });
});

describe("summarizeUsajobsFilters", () => {
  it("returns nothing for an empty config", () => {
    expect(summarizeUsajobsFilters({})).toEqual([]);
  });

  it("describes set filters with human labels and skips unset ones", () => {
    const rows = summarizeUsajobsFilters({
      keyword: "data",
      locationName: ["Denver", "Austin"],
      radius: 25,
      remunerationMinimumAmount: 90000,
      hiringPath: ["vet", "public"],
      positionScheduleTypeCode: [1],
      securityClearanceRequired: [2],
      remoteIndicator: false,
      sortField: "closedate",
      sortDirection: "asc",
    });
    expect(Object.fromEntries(rows.map((r) => [r.label, r.value]))).toEqual({
      Keyword: "data",
      "Search locations": "Denver, Austin (within 25)",
      Salary: "From $90,000",
      "Hiring path": "Veterans, Open to the public",
      Schedule: "Full-time",
      "Security clearance": "Secret",
      Remote: "Exclude remote",
      Sort: "Close date (Ascending)",
    });
  });

  it("tolerates unknown stored codes instead of throwing", () => {
    const rows = summarizeUsajobsFilters({
      hiringPath: ["mystery" as any],
      positionScheduleTypeCode: [99],
    });
    expect(rows.map((r) => r.value)).toEqual(["mystery", "99"]);
  });
});
