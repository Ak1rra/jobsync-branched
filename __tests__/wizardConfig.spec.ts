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

describe("parseEditSourceConfig - usajobs", () => {
  it("keeps a USAJOBS config so editing a USAJOBS automation keeps its query", () => {
    const sc = JSON.stringify({ usajobs: { keyword: "nurse", radius: 10 } });
    expect(parseEditSourceConfig(sc)).toEqual({
      usajobs: { keyword: "nurse", radius: 10 },
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
      UsajobsSourceConfigSchema.safeParse({ ...EMPTY_USAJOBS, keyword: "x" })
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
