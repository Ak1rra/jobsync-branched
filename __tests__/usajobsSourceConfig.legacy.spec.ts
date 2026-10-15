import {
  dedupeCaseInsensitive,
  foldLegacyUsajobsConfig,
} from "@/lib/scraper/usajobs/sourceConfig";
import { UsajobsSourceConfigSchema } from "@/models/automation.schema";

describe("dedupeCaseInsensitive", () => {
  it("keeps the first spelling, trims, and drops blanks", () => {
    expect(dedupeCaseInsensitive([" Nurse", "nurse", "", "  ", "RN", "rn "])).toEqual([
      "Nurse",
      "RN",
    ]);
  });
});

describe("foldLegacyUsajobsConfig", () => {
  it("returns non-objects and current configs untouched (same reference)", () => {
    expect(foldLegacyUsajobsConfig(undefined)).toBeUndefined();
    expect(foldLegacyUsajobsConfig(null)).toBeNull();
    expect(foldLegacyUsajobsConfig("x")).toBe("x");
    const arr: unknown[] = [];
    expect(foldLegacyUsajobsConfig(arr)).toBe(arr);
    const current = { keywords: ["k"], targetTitles: ["A"], locations: ["B"] };
    expect(foldLegacyUsajobsConfig(current)).toBe(current);
  });

  it("puts positionTitle, keyword and locationName first in the shared lists", () => {
    expect(
      foldLegacyUsajobsConfig({
        positionTitle: "IT Specialist",
        keyword: "cloud",
        locationName: ["Denver", "Reno"],
        targetTitles: ["Engineer"],
        keywords: ["python"],
        locations: ["Austin"],
        radius: 5,
      }),
    ).toEqual({
      targetTitles: ["IT Specialist", "Engineer"],
      keywords: ["cloud", "python"],
      locations: ["Denver", "Reno", "Austin"],
      radius: 5,
    });
  });

  it("creates the shared lists when the config had none", () => {
    expect(
      foldLegacyUsajobsConfig({
        positionTitle: " Nurse ",
        keyword: " triage ",
        locationName: ["Reno"],
      }),
    ).toEqual({ targetTitles: ["Nurse"], keywords: ["triage"], locations: ["Reno"] });
  });

  it("dedupes case-insensitively against what is already there", () => {
    expect(
      foldLegacyUsajobsConfig({
        positionTitle: "it specialist",
        keyword: "PYTHON",
        locationName: ["DENVER", "Reno", "reno"],
        targetTitles: ["IT Specialist"],
        keywords: ["Python"],
        locations: ["Denver"],
      }),
    ).toEqual({
      targetTitles: ["IT Specialist"],
      keywords: ["Python"],
      locations: ["Denver", "Reno"],
    });
  });

  it("drops nothing from long lists and keeps the legacy search values first (they are what gets searched)", () => {
    const out = foldLegacyUsajobsConfig({
      positionTitle: "Search",
      keyword: "Kw",
      targetTitles: ["A", "B", "C", "D", "E"],
      keywords: ["k1", "k2", "k3", "k4", "k5"],
      locationName: ["L1", "L2"],
      locations: Array.from({ length: 10 }, (_, i) => `X${i}`),
    }) as any;
    expect(out.targetTitles).toEqual(["Search", "A", "B", "C", "D", "E"]);
    expect(out.keywords).toEqual(["Kw", "k1", "k2", "k3", "k4", "k5"]);
    expect(out.locations).toHaveLength(12);
    expect(out.locations.slice(0, 2)).toEqual(["L1", "L2"]);
    expect(UsajobsSourceConfigSchema.safeParse(out).success).toBe(true);
  });

  it("does not trim a long current ranking list (returned untouched)", () => {
    const current = {
      keywords: ["a", "b", "c", "d", "e", "f", "g"],
      targetTitles: ["A", "B", "C", "D", "E", "F", "G"],
      locations: Array.from({ length: 12 }, (_, i) => `L${i}`),
    };
    expect(foldLegacyUsajobsConfig(current)).toBe(current);
    expect(UsajobsSourceConfigSchema.safeParse(current).success).toBe(true);
  });

  it("splits a ';' inside a location instead of letting it corrupt LocationName", () => {
    const out = foldLegacyUsajobsConfig({ locationName: ["A;B"], locations: ["C;D"] }) as any;
    expect(out.locations).toEqual(["A", "B", "C", "D"]);
  });

  it("ignores a malformed legacy value rather than throwing", () => {
    expect(foldLegacyUsajobsConfig({ keyword: 5, positionTitle: 5, locationName: "x" })).toEqual({});
    expect(foldLegacyUsajobsConfig({ keyword: "k", positionTitle: 5, locationName: "x" })).toEqual({
      keywords: ["k"],
    });
  });

  it("truncates an over-long legacy keyword to the new per-keyword limit", () => {
    const out = foldLegacyUsajobsConfig({ keyword: "x".repeat(150) }) as any;
    expect(out.keywords).toEqual(["x".repeat(100)]);
    expect(UsajobsSourceConfigSchema.safeParse(out).success).toBe(true);
  });
});
