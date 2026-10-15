import {
  EMPTY_ATS,
  EMPTY_USAJOBS,
  isQueryBoard,
  parseEditSourceConfig,
} from "@/components/automations/automation-wizard/wizardConfig";
import {
  PROVIDER_META,
  boardName,
} from "@/components/automations/ats-search-step/types";
import { UsajobsSourceConfigSchema } from "@/models/automation.schema";
import { cleanUsajobsConfig } from "@/components/automations/ats-search-step/usajobsConfig";

describe("parseEditSourceConfig", () => {
  it("returns undefined for null/blank input", () => {
    expect(parseEditSourceConfig(null)).toBeUndefined();
    expect(parseEditSourceConfig("")).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    expect(parseEditSourceConfig("{not json")).toBeUndefined();
  });

  it("keeps a Greenhouse config", () => {
    const sc = JSON.stringify({ greenhouse: { companies: [] } });
    expect(parseEditSourceConfig(sc)).toEqual({ greenhouse: { companies: [] } });
  });

  it("keeps a Lever config", () => {
    const sc = JSON.stringify({ lever: { companies: [] } });
    expect(parseEditSourceConfig(sc)).toEqual({ lever: { companies: [] } });
  });

  it("keeps an Ashby config so editing an Ashby automation keeps its companies", () => {
    const sc = JSON.stringify({
      ashby: { companies: [{ name: "Ramp", token: "ramp" }] },
    });
    expect(parseEditSourceConfig(sc)).toEqual({
      ashby: { companies: [{ name: "Ramp", token: "ramp" }] },
    });
  });
});

describe("parseEditSourceConfig - usajobs legacy keyword/title/location", () => {
  const parse = (usajobs: unknown) =>
    parseEditSourceConfig(JSON.stringify({ usajobs }))?.usajobs as any;

  it("folds keyword, positionTitle and locationName into the shared fields for the edit form", () => {
    const cfg = parse({
      keyword: "x",
      positionTitle: "IT Specialist",
      locationName: ["Denver", "reno"],
      radius: 20,
      targetTitles: ["Engineer"],
      keywords: ["X", "Python"],
      locations: ["Reno"],
    });
    expect(cfg).not.toHaveProperty("keyword");
    expect(cfg.keywords).toEqual(["X", "Python"]);
    expect(cfg).not.toHaveProperty("positionTitle");
    expect(cfg).not.toHaveProperty("locationName");
    expect(cfg.targetTitles).toEqual(["IT Specialist", "Engineer"]);
    expect(cfg.locations).toEqual(["Denver", "Reno"]);
    expect(cfg.radius).toBe(20);
    expect(UsajobsSourceConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it("round-trips a legacy keyword + positionTitle + locationName config through edit and save", () => {
    const legacy = {
      keyword: "data scientist",
      positionTitle: "Statistician",
      locationName: ["Denver", "Reno"],
      radius: 25,
      hiringPath: ["vet"],
      topK: 7,
    };
    // Edit form: the legacy keys appear in the three shared fields.
    const form = parse(legacy);
    expect(form).toEqual({
      keywords: ["data scientist"],
      targetTitles: ["Statistician"],
      locations: ["Denver", "Reno"],
      radius: 25,
      hiringPath: ["vet"],
      topK: 7,
    });
    // Save: the cleaned form validates and carries no legacy key.
    const saved = cleanUsajobsConfig(form);
    const parsed = UsajobsSourceConfigSchema.safeParse(saved);
    expect(parsed.success).toBe(true);
    expect(saved).not.toHaveProperty("keyword");
    expect(saved).not.toHaveProperty("positionTitle");
    expect(saved).not.toHaveProperty("locationName");
    // Re-opening what was saved changes nothing (folding is idempotent).
    expect(parse(saved)).toEqual(saved);
  });

  it("leaves a current config and the other boards untouched", () => {
    const current = { keywords: ["x"], targetTitles: ["A"], locations: ["B"] };
    expect(parse(current)).toEqual(current);
    const lever = { lever: { companies: [], locationName: ["kept"] } };
    expect(parseEditSourceConfig(JSON.stringify(lever))).toEqual(lever);
  });
});

describe("parseEditSourceConfig - usajobs", () => {
  it("keeps a USAJOBS config so editing a USAJOBS automation keeps its query", () => {
    const sc = JSON.stringify({ usajobs: { keywords: ["nurse"], radius: 10 } });
    expect(parseEditSourceConfig(sc)).toEqual({
      usajobs: { keywords: ["nurse"], radius: 10 },
    });
  });

  it("still returns undefined for a config with no known board", () => {
    expect(
      parseEditSourceConfig(JSON.stringify({ other: {} })),
    ).toBeUndefined();
  });
});

describe("isQueryBoard", () => {
  it("is true only for USAJOBS", () => {
    expect(isQueryBoard("usajobs")).toBe(true);
    ["greenhouse", "lever", "ashby"].forEach((b) =>
      expect(isQueryBoard(b as any)).toBe(false),
    );
  });
});

describe("EMPTY_USAJOBS", () => {
  it("is not savable until a criterion is added, then is schema-valid", () => {
    expect(UsajobsSourceConfigSchema.safeParse(EMPTY_USAJOBS).success).toBe(
      false,
    );
    expect(
      UsajobsSourceConfigSchema.safeParse({ ...EMPTY_USAJOBS, keywords: ["x"] })
        .success,
    ).toBe(true);
  });

  it("shares the watchlist defaults for the ranking fields", () => {
    expect(EMPTY_USAJOBS.topK).toBe(EMPTY_ATS.topK);
    expect(EMPTY_USAJOBS.saveUnanalyzed).toBe(EMPTY_ATS.saveUnanalyzed);
    expect(EMPTY_USAJOBS).not.toHaveProperty("companies");
  });
});

describe("boardName", () => {
  it("upper-cases the USAJOBS acronym and leaves the rest alone", () => {
    expect(boardName("usajobs")).toBe("USAJOBS");
    expect(boardName("greenhouse")).toBe("greenhouse");
    expect(boardName("jsearch")).toBe("jsearch");
  });
});

describe("PROVIDER_META", () => {
  it("has an entry for every board the wizard can select", () => {
    ["greenhouse", "lever", "ashby"].forEach((board) => {
      expect(PROVIDER_META[board]).toBeDefined();
      expect(PROVIDER_META[board].label.length).toBeGreaterThan(0);
    });
  });

  it("labels USAJOBS without company-directory hints", () => {
    expect(PROVIDER_META.usajobs.label).toBe("USAJOBS");
  });

  it("keeps the three watchlist boards unchanged", () => {
    expect(PROVIDER_META.greenhouse.label).toBe("Greenhouse");
    expect(PROVIDER_META.lever.urlHint).toMatch(/jobs\.lever\.co/);
    expect(PROVIDER_META.ashby.searchExample).toBe("Ramp");
  });
});
