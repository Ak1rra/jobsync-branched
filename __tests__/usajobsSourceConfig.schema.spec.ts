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
    expect(create({ keywords: ["nurse"] }).success).toBe(true);
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
    ["targetTitles", { targetTitles: ["Electrical Engineer"] }],
    ["locations", { locations: ["Atlanta, Georgia"] }],
    ["organization", { organization: ["TR"] }],
    ["jobCategoryCode", { jobCategoryCode: ["2210"] }],
  ])("accepts %s as the narrowing criterion", (_name, cfg) => {
    expect(create(cfg).success).toBe(true);
  });

  it("accepts every documented filter together", () => {
    const result = create({
      locations: ["Atlanta, Georgia", "Norfolk Virginia"],
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
      targetTitles: ["IT Specialist", "Engineer"],
      keywords: ["python"],
      strictLocation: true,
      topK: 20,
      saveUnanalyzed: false,
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ["unknown hiring path", { keywords: ["x"], hiringPath: ["everyone"] }],
    ["bad whoMayApply", { keywords: ["x"], whoMayApply: "nobody" }],
    ["schedule code out of range", { keywords: ["x"], positionScheduleTypeCode: [7] }],
    ["undocumented clearance code 6", { keywords: ["x"], securityClearanceRequired: [6] }],
    ["datePosted over 60", { keywords: ["x"], datePosted: 61 }],
    ["negative datePosted", { keywords: ["x"], datePosted: -1 }],
    ["non-integer datePosted", { keywords: ["x"], datePosted: 1.5 }],
    ["unknown sort field", { keywords: ["x"], sortField: "vibes" }],
    ["bad sort direction", { keywords: ["x"], sortDirection: "sideways" }],
    ["bad Fields value", { keywords: ["x"], fields: "Some" }],
    ["pay grade 16", { keywords: ["x"], payGradeLow: "16" }],
    ["pay grade not padded", { keywords: ["x"], payGradeHigh: "7" }],
    ["series code not 4 digits", { jobCategoryCode: ["221"] }],
    ["series code with separator", { jobCategoryCode: ["2210;0830"] }],
    ["organization with separator", { organization: ["TR;AF"] }],
    ["organization injection", { organization: ["TR&Page=9"] }],
    ["location containing ';'", { locations: ["A;B"] }],
    ["empty title", { targetTitles: [""] }],
    ["title too long", { targetTitles: ["x".repeat(101)] }],
    ["empty keyword", { keywords: [""] }],
    ["keyword too long", { keywords: ["x".repeat(101)] }],
    ["radius without a location", { keywords: ["x"], radius: 25 }],
    ["radius of 0", { locations: ["Reno"], radius: 0 }],
    ["radius with only titles", { targetTitles: ["Nurse"], radius: 10 }],
    ["min pay above max pay", { keywords: ["x"], remunerationMinimumAmount: 90000, remunerationMaximumAmount: 50000 }],
    ["low grade above high grade", { keywords: ["x"], payGradeLow: "12", payGradeHigh: "07" }],
    ["topK over the cap", { keywords: ["x"], topK: 51 }],
  ])("rejects %s", (_name, cfg) => {
    expect(create(cfg).success).toBe(false);
  });

  it("accepts long titles, keywords and locations lists (every entry ranks; only the first few are searched)", () => {
    expect(
      create({
        targetTitles: Array.from({ length: 8 }, (_, i) => `T${i}`),
        keywords: Array.from({ length: 12 }, (_, i) => `K${i}`),
        locations: Array.from({ length: 15 }, (_, i) => `L${i}`),
        radius: 10,
      }).success,
    ).toBe(true);
  });

  it("no longer stores a separate keyword / positionTitle / locationName (stripped, not a criterion)", () => {
    expect(create({ keyword: "nurse" }).success).toBe(false);
    expect(create({ positionTitle: "Nurse" }).success).toBe(false);
    expect(create({ locationName: ["Reno"] }).success).toBe(false);
    const parsed = UsajobsSourceConfigSchema.safeParse({
      keywords: ["x"],
      keyword: "y",
      positionTitle: "Nurse",
      locationName: ["Reno"],
    });
    expect(parsed.success && Object.keys(parsed.data)).toEqual(["keywords"]);
  });

  it("counts keywords as a search criterion", () => {
    expect(create({ keywords: ["a", "b", "c", "d", "e", "f"] }).success).toBe(true);
    expect(create({ keywords: [] }).success).toBe(false);
  });

  it("reports a criterion error on the keywords path", () => {
    const result = UsajobsSourceConfigSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/search criterion/);
      expect(result.error.issues[0].path).toEqual(["keywords"]);
    }
  });
});

describe("UpdateAutomationSchema (usajobs)", () => {
  it("accepts a usajobs update with its config", () => {
    const result = UpdateAutomationSchema.safeParse({
      jobBoard: "usajobs",
      sourceConfig: { usajobs: { keywords: ["nurse"] } },
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
      sourceConfig: { usajobs: { keywords: ["nurse"] } },
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
      JSON.stringify({ usajobs: { keywords: ["nurse"], targetTitles: ["Nurse", "RN"] } }),
    )!;
    expect(cfg.query.keywords).toEqual(["nurse"]);
    expect(cfg.query).not.toHaveProperty("keyword");
    expect(cfg.ranking).toMatchObject({
      keywords: ["nurse"], // the same list is the search and the ranking terms
      targetTitles: ["Nurse", "RN"],
      locations: [],
      strictLocation: false,
      saveUnanalyzed: true,
    });
    expect(cfg.ranking.topK).toBeGreaterThan(0);
  });

  it("feeds the one titles/locations list to both the query and the ranking", () => {
    const cfg = parseUsajobsConfig(
      JSON.stringify({
        usajobs: { targetTitles: ["Nurse", "RN"], locations: ["Denver", "Reno"], radius: 25 },
      }),
    )!;
    expect(cfg.query.targetTitles).toEqual(["Nurse", "RN"]);
    expect(cfg.ranking.targetTitles).toEqual(["Nurse", "RN"]);
    expect(cfg.ranking.locations).toEqual(["Denver", "Reno"]);
  });

  describe("legacy keyword / positionTitle / locationName", () => {
    const parse = (usajobs: unknown) =>
      parseUsajobsConfig(JSON.stringify({ usajobs }));

    it("folds positionTitle into targetTitles and locationName into locations", () => {
      const cfg = parse({
        positionTitle: "IT Specialist",
        locationName: ["Denver, Colorado"],
        radius: 30,
        targetTitles: ["Engineer"],
        locations: ["Reno"],
        strictLocation: true,
      })!;
      expect(cfg.query).not.toHaveProperty("positionTitle");
      expect(cfg.query).not.toHaveProperty("locationName");
      expect(cfg.query.targetTitles).toEqual(["IT Specialist", "Engineer"]);
      expect(cfg.query.locations).toEqual(["Denver, Colorado", "Reno"]);
      expect(cfg.query.radius).toBe(30);
      expect(cfg.ranking.targetTitles).toEqual(["IT Specialist", "Engineer"]);
      expect(cfg.ranking.locations).toEqual(["Denver, Colorado", "Reno"]);
    });

    it("folds a legacy keyword into keywords (deduped) and feeds it to ranking", () => {
      const cfg = parse({
        keyword: "data scientist",
        keywords: ["Python", "DATA SCIENTIST"],
        targetTitles: ["Analyst"],
      })!;
      expect(cfg.query).not.toHaveProperty("keyword");
      expect(cfg.query.keywords).toEqual(["DATA SCIENTIST", "Python"]);
      expect(cfg.ranking.keywords).toEqual(["DATA SCIENTIST", "Python"]);
      expect(parse({ keyword: "nurse" })!.query.keywords).toEqual(["nurse"]);
    });

    it("keeps the legacy keyword first and every existing ranking keyword", () => {
      const cfg = parse({
        keyword: "Legacy",
        keywords: ["a", "b", "c", "d", "e", "f", "g"],
      })!;
      expect(cfg.query.keywords).toEqual(["Legacy", "a", "b", "c", "d", "e", "f", "g"]);
      expect(cfg.ranking.keywords).toHaveLength(8);
    });

    it("keeps a legacy-only title/location config runnable (was the only criterion)", () => {
      const cfg = parse({ positionTitle: "Nurse" })!;
      expect(cfg.query.targetTitles).toEqual(["Nurse"]);
      expect(parse({ locationName: ["Reno"], radius: 5 })!.query.locations).toEqual(["Reno"]);
    });

    it("dedupes case-insensitively, first spelling wins", () => {
      const cfg = parse({
        positionTitle: "it specialist",
        locationName: ["DENVER", "reno"],
        targetTitles: ["IT Specialist"],
        locations: ["Denver"],
      })!;
      expect(cfg.query.targetTitles).toEqual(["IT Specialist"]);
      expect(cfg.query.locations).toEqual(["Denver", "reno"]);
    });

    it("keeps the legacy search title first, ahead of the entries that follow it", () => {
      const cfg = parse({
        positionTitle: "Search Title",
        targetTitles: ["A", "B", "C", "D", "E"],
      })!;
      expect(cfg.query.targetTitles).toEqual(["Search Title", "A", "B", "C", "D", "E"]);
      expect(cfg.ranking.targetTitles).toHaveLength(6);
    });
  });

  it("honours saveUnanalyzed=false, strictLocation and topK", () => {
    const cfg = parseUsajobsConfig(
      JSON.stringify({
        usajobs: { keywords: ["x"], saveUnanalyzed: false, strictLocation: true, locations: ["DC"], topK: 5 },
      }),
    )!;
    expect(cfg.ranking).toMatchObject({ saveUnanalyzed: false, strictLocation: true, topK: 5 });
  });

  it.each([
    ["null", null],
    ["not JSON", "{oops"],
    ["no usajobs key", JSON.stringify({ greenhouse: { companies: [] } })],
    ["no criterion", JSON.stringify({ usajobs: {} })],
    ["tampered value", JSON.stringify({ usajobs: { keywords: ["x"], hiringPath: ["a;Page=9"] } })],
  ])("returns null for %s", (_label, raw) => {
    expect(parseUsajobsConfig(raw as string | null)).toBeNull();
  });
});
