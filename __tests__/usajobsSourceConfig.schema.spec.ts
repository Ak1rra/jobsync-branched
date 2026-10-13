import {
  CreateAutomationSchema,
  UpdateAutomationSchema,
  UsajobsSourceConfigSchema,
} from "@/models/automation.schema";
import { apiKeySaveSchema } from "@/models/apiKey.schema";
import { parseUsajobsConfig } from "@/lib/scraper/automation-run/config";
import { ATS_BOARDS, RUNNABLE_BOARDS } from "@/models/automation.model";

const base = {
  name: "Federal IT",
  resumeId: "550e8400-e29b-41d4-a716-446655440000",
  matchThreshold: 80,
  scheduleHour: 8,
};

const create = (usajobs: unknown) =>
  CreateAutomationSchema.safeParse({
    ...base,
    jobBoard: "usajobs",
    sourceConfig: { usajobs },
  });

describe("usajobs board registration", () => {
  it("is schedulable, and not mistaken for a company-watchlist board", () => {
    expect(RUNNABLE_BOARDS).toContain("usajobs");
    expect(ATS_BOARDS).not.toContain("usajobs");
    expect(ATS_BOARDS).toEqual(["greenhouse", "lever", "ashby"]);
  });
});

describe("CreateAutomationSchema (usajobs)", () => {
  it("accepts a keyword-only query and needs no companies", () => {
    expect(create({ keyword: "nurse" }).success).toBe(true);
  });

  it("rejects a missing usajobs config block", () => {
    const result = CreateAutomationSchema.safeParse({ ...base, jobBoard: "usajobs" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty config (no search criterion)", () => {
    expect(create({}).success).toBe(false);
    expect(create({ remoteIndicator: true, datePosted: 7 }).success).toBe(false);
  });

  it.each([
    ["positionTitle", { positionTitle: "Electrical Engineer" }],
    ["locationName", { locationName: ["Atlanta, Georgia"] }],
    ["organization", { organization: ["TR"] }],
    ["jobCategoryCode", { jobCategoryCode: ["2210"] }],
  ])("accepts %s as the narrowing criterion", (_name, cfg) => {
    expect(create(cfg).success).toBe(true);
  });

  it("accepts every documented filter together", () => {
    const result = create({
      keyword: "software",
      positionTitle: "Engineer",
      locationName: ["Atlanta, Georgia", "Norfolk Virginia"],
      radius: 75,
      organization: ["TR", "AF"],
      jobCategoryCode: ["2210", "0830"],
      remunerationMinimumAmount: 26000,
      remunerationMaximumAmount: 85000,
      payGradeLow: "07",
      payGradeHigh: "12",
      hiringPath: ["public", "fed-competitive"],
      whoMayApply: "public",
      remoteIndicator: false,
      positionScheduleTypeCode: [1, 2],
      positionOfferingTypeCode: ["15317"],
      securityClearanceRequired: [0, 2],
      datePosted: 14,
      sortField: "opendate",
      sortDirection: "desc",
      fields: "Full",
      targetTitles: ["IT Specialist"],
      keywords: ["python"],
      locations: ["Washington"],
      strictLocation: true,
      topK: 20,
      saveUnanalyzed: false,
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ["unknown hiring path", { keyword: "x", hiringPath: ["everyone"] }],
    ["bad whoMayApply", { keyword: "x", whoMayApply: "nobody" }],
    ["schedule code out of range", { keyword: "x", positionScheduleTypeCode: [7] }],
    ["undocumented clearance code 6", { keyword: "x", securityClearanceRequired: [6] }],
    ["datePosted over 60", { keyword: "x", datePosted: 61 }],
    ["negative datePosted", { keyword: "x", datePosted: -1 }],
    ["non-integer datePosted", { keyword: "x", datePosted: 1.5 }],
    ["unknown sort field", { keyword: "x", sortField: "vibes" }],
    ["bad sort direction", { keyword: "x", sortDirection: "sideways" }],
    ["bad Fields value", { keyword: "x", fields: "Some" }],
    ["pay grade 16", { keyword: "x", payGradeLow: "16" }],
    ["pay grade not padded", { keyword: "x", payGradeHigh: "7" }],
    ["series code not 4 digits", { jobCategoryCode: ["221"] }],
    ["series code with separator", { jobCategoryCode: ["2210;0830"] }],
    ["organization with separator", { organization: ["TR;AF"] }],
    ["organization injection", { organization: ["TR&Page=9"] }],
    ["location containing ';'", { locationName: ["A;B"] }],
    ["empty keyword", { keyword: "   " }],
    ["keyword too long", { keyword: "x".repeat(201) }],
    ["too many locations", { locationName: Array.from({ length: 11 }, (_, i) => `L${i}`) }],
    ["radius without a location", { keyword: "x", radius: 25 }],
    ["radius of 0", { locationName: ["Reno"], radius: 0 }],
    ["min pay above max pay", { keyword: "x", remunerationMinimumAmount: 90000, remunerationMaximumAmount: 50000 }],
    ["low grade above high grade", { keyword: "x", payGradeLow: "12", payGradeHigh: "07" }],
    ["topK over the cap", { keyword: "x", topK: 51 }],
  ])("rejects %s", (_name, cfg) => {
    expect(create(cfg).success).toBe(false);
  });

  it("reports a criterion error on the keyword path", () => {
    const result = UsajobsSourceConfigSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/search criterion/);
    }
  });
});

describe("UpdateAutomationSchema (usajobs)", () => {
  it("accepts a usajobs update with its config", () => {
    const result = UpdateAutomationSchema.safeParse({
      jobBoard: "usajobs",
      sourceConfig: { usajobs: { keyword: "nurse" } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects switching to usajobs without a config", () => {
    expect(UpdateAutomationSchema.safeParse({ jobBoard: "usajobs" }).success).toBe(false);
  });

  it("still accepts a name-only update", () => {
    expect(UpdateAutomationSchema.safeParse({ name: "renamed" }).success).toBe(true);
  });
});

describe("other boards are unchanged", () => {
  it.each(["greenhouse", "lever", "ashby"])("%s still requires a company", (board) => {
    const empty = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: board,
      sourceConfig: { [board]: { companies: [] } },
    });
    expect(empty.success).toBe(false);
    const ok = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: board,
      sourceConfig: { [board]: { companies: [{ name: "Acme", token: "acme" }] } },
    });
    expect(ok.success).toBe(true);
  });

  it("a usajobs block does not satisfy a greenhouse automation", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: { usajobs: { keyword: "nurse" } },
    });
    expect(result.success).toBe(false);
  });
});

describe("apiKeySaveSchema (usajobs credentials)", () => {
  it("accepts the usajobs key", () => {
    expect(apiKeySaveSchema.safeParse({ provider: "usajobs", key: "abc123" }).success).toBe(true);
  });

  it("accepts a valid registration email", () => {
    expect(
      apiKeySaveSchema.safeParse({
        provider: "usajobs_email",
        key: "jane@example.com",
        sensitive: false,
      }).success,
    ).toBe(true);
  });

  it.each([
    ["a space inside", "abc def"],
    ["a newline inside", "abc\ndef"],
    ["a non-ASCII character", "k\u00e9y123"],
    ["only whitespace", "   "],
  ])("rejects a usajobs key with %s at save time", (_l, key) => {
    expect(apiKeySaveSchema.safeParse({ provider: "usajobs", key }).success).toBe(false);
  });

  it("accepts a usajobs key with only surrounding whitespace (trimmed at run time)", () => {
    expect(
      apiKeySaveSchema.safeParse({ provider: "usajobs", key: "  abc123  " }).success,
    ).toBe(true);
  });

  it("rejects a non-ASCII registration email", () => {
    expect(
      apiKeySaveSchema.safeParse({ provider: "usajobs_email", key: "j\u00e9@example.com" })
        .success,
    ).toBe(false);
  });

  it("does not apply the usajobs key format to other providers", () => {
    expect(
      apiKeySaveSchema.safeParse({ provider: "openai", key: "has a space" }).success,
    ).toBe(true);
  });

  it("rejects a registration value that is not an email", () => {
    expect(
      apiKeySaveSchema.safeParse({ provider: "usajobs_email", key: "jane" }).success,
    ).toBe(false);
  });

  it("still rejects unknown providers and keeps existing ones", () => {
    expect(apiKeySaveSchema.safeParse({ provider: "nope", key: "x" }).success).toBe(false);
    expect(apiKeySaveSchema.safeParse({ provider: "openai", key: "sk-x" }).success).toBe(true);
  });
});

describe("parseUsajobsConfig (run-time re-validation)", () => {
  it("returns the query plus shared ranking fields with defaults", () => {
    const cfg = parseUsajobsConfig(
      JSON.stringify({ usajobs: { keyword: "nurse", positionTitle: "RN", targetTitles: ["Nurse"] } }),
    )!;
    expect(cfg.query.keyword).toBe("nurse");
    expect(cfg.ranking).toMatchObject({
      keywords: ["nurse"], // the server keyword also feeds ranking
      targetTitles: ["Nurse", "RN"],
      locations: [],
      strictLocation: false,
      saveUnanalyzed: true,
    });
    expect(cfg.ranking.topK).toBeGreaterThan(0);
  });

  it("honours saveUnanalyzed=false, strictLocation and topK", () => {
    const cfg = parseUsajobsConfig(
      JSON.stringify({
        usajobs: { keyword: "x", saveUnanalyzed: false, strictLocation: true, locations: ["DC"], topK: 5 },
      }),
    )!;
    expect(cfg.ranking).toMatchObject({ saveUnanalyzed: false, strictLocation: true, topK: 5 });
  });

  it.each([
    ["null", null],
    ["not JSON", "{oops"],
    ["no usajobs key", JSON.stringify({ greenhouse: { companies: [] } })],
    ["no criterion", JSON.stringify({ usajobs: {} })],
    ["tampered value", JSON.stringify({ usajobs: { keyword: "x", hiringPath: ["a;Page=9"] } })],
  ])("returns null for %s", (_label, raw) => {
    expect(parseUsajobsConfig(raw as string | null)).toBeNull();
  });
});
