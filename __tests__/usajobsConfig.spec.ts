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
      targetTitles: ["Nurse"],
      organization: [],
      radius: undefined,
      datePosted: Number.NaN,
      sortField: " " as any,
    });
    expect(cleaned).not.toHaveProperty("sortField");
    expect(cleaned).not.toHaveProperty("organization");
    expect(cleaned).not.toHaveProperty("radius");
    expect(cleaned).not.toHaveProperty("datePosted");
    expect(cleaned.targetTitles).toEqual(["Nurse"]);
  });

  it("keeps the ranking fields as-is, including empty lists", () => {
    const cleaned = cleanUsajobsConfig({ ...base, targetTitles: ["x"] });
    expect(cleaned.targetTitles).toEqual(["x"]);
    expect(cleaned.keywords).toEqual([]);
    expect(cleaned.strictLocation).toBe(false);
    expect(cleaned.topK).toBe(10);
  });

  it("drops a radius that has no location", () => {
    expect(
      cleanUsajobsConfig({ ...base, keywords: ["x"], radius: 5 }),
    ).not.toHaveProperty("radius");
    expect(
      cleanUsajobsConfig({ ...base, locations: ["Denver"], radius: 5 }).radius,
    ).toBe(5);
    // an emptied location list (kept as [] like the other boards) also drops it
    expect(
      cleanUsajobsConfig({ ...base, keywords: ["x"], locations: [], radius: 5 }),
    ).not.toHaveProperty("radius");
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
    ["keywords", { keywords: ["x"] }],
    ["targetTitles", { targetTitles: ["x"] }],
    ["locations", { locations: ["Denver"] }],
    ["organization", { organization: ["AF"] }],
    ["jobCategoryCode", { jobCategoryCode: ["2210"] }],
  ])("accepts %s as the criterion", (_name, patch) => {
    expect(isUsajobsConfigValid({ ...base, ...patch })).toBe(true);
    expect(usajobsIssues({ ...base, ...patch })).toEqual([]);
  });

  it("names the unified fields in keyword/title/location validation messages", () => {
    const tooMany = usajobsIssues({
      ...base,
      keywords: ["x".repeat(101)],
      targetTitles: ["x".repeat(101)],
      locations: ["A;B"],
    });
    expect(tooMany.map((i) => i.field)).toEqual([
      "Position titles",
      "Keywords",
      "Locations",
    ]);
    // only the "at least one criterion" rule is shown without a field prefix
    expect(tooMany[1].message).toMatch(/^Keywords: /);
  });

  it("does not limit the number of keywords, titles or locations", () => {
    const many = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);
    expect(
      usajobsIssues({
        ...base,
        keywords: many("k", 9),
        targetTitles: many("t", 9),
        locations: many("l", 14),
      }),
    ).toEqual([]);
  });

  it("does not count a filter-only config as a criterion", () => {
    expect(isUsajobsConfigValid({ ...base, hiringPath: ["vet"] })).toBe(false);
  });

  it("reports min above max and grade inversion with the field named", () => {
    const issues = usajobsIssues({
      ...base,
      keywords: ["x"],
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
        keywords: ["x"],
        targetTitles: ["Nurse"],
        locations: ["Denver"],
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
      keywords: ["data"],
      targetTitles: ["Analyst", "Scientist"],
      locations: ["Denver", "Austin"],
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
      // keywords, titles and locations are listed once, by the shared rows of
      // the views
      Radius: "25",
      Salary: "From $90,000",
      "Hiring path": "Veterans, Open to the public",
      Schedule: "Full-time",
      "Security clearance": "Secret",
      Remote: "Exclude remote",
      Sort: "Close date (Ascending)",
    });
  });

  it("does not list keywords, titles or locations (the views show those once) and drops a radius with no location", () => {
    const labels = (cfg: Parameters<typeof summarizeUsajobsFilters>[0]) =>
      summarizeUsajobsFilters(cfg).map((r) => r.label);
    expect(
      labels({ keywords: ["data"], targetTitles: ["Nurse"], locations: ["Reno"] }),
    ).toEqual([]);
    expect(labels({ radius: 25 })).toEqual([]);
  });

  it("tolerates unknown stored codes instead of throwing", () => {
    const rows = summarizeUsajobsFilters({
      hiringPath: ["mystery" as any],
      positionScheduleTypeCode: [99],
    });
    expect(rows.map((r) => r.value)).toEqual(["mystery", "99"]);
  });
});
