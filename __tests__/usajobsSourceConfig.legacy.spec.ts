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
    const current = { keyword: "k", targetTitles: ["A"], locations: ["B"] };
    expect(foldLegacyUsajobsConfig(current)).toBe(current);
  });

  it("appends positionTitle to targetTitles and locationName to locations", () => {
    expect(
      foldLegacyUsajobsConfig({
        positionTitle: "IT Specialist",
        locationName: ["Denver", "Reno"],
        targetTitles: ["Engineer"],
        locations: ["Austin"],
        radius: 5,
      }),
    ).toEqual({
      targetTitles: ["Engineer", "IT Specialist"],
      locations: ["Austin", "Denver", "Reno"],
      radius: 5,
    });
  });

  it("creates the shared lists when the config had none", () => {
    expect(
      foldLegacyUsajobsConfig({ positionTitle: " Nurse ", locationName: ["Reno"] }),
    ).toEqual({ targetTitles: ["Nurse"], locations: ["Reno"] });
  });

  it("dedupes case-insensitively against what is already there", () => {
    expect(
      foldLegacyUsajobsConfig({
        positionTitle: "it specialist",
        locationName: ["DENVER", "Reno", "reno"],
        targetTitles: ["IT Specialist"],
        locations: ["Denver"],
      }),
    ).toEqual({ targetTitles: ["IT Specialist"], locations: ["Denver", "Reno"] });
  });

  it("never loses the legacy search values to the caps", () => {
    const out = foldLegacyUsajobsConfig({
      positionTitle: "Search",
      targetTitles: ["A", "B", "C", "D", "E"],
      locationName: ["L1", "L2"],
      locations: Array.from({ length: 10 }, (_, i) => `X${i}`),
    }) as any;
    expect(out.targetTitles).toEqual(["A", "B", "C", "D", "Search"]);
    expect(out.locations).toHaveLength(10);
    expect(out.locations.slice(-2)).toEqual(["L1", "L2"]);
    expect(UsajobsSourceConfigSchema.safeParse(out).success).toBe(true);
  });

  it("trims an over-cap pre-unification ranking list so the config still validates", () => {
    const out = foldLegacyUsajobsConfig({
      keyword: "k",
      targetTitles: ["A", "B", "C", "D", "E", "F", "G"],
    }) as any;
    expect(out.targetTitles).toEqual(["A", "B", "C", "D", "E"]);
    expect(UsajobsSourceConfigSchema.safeParse(out).success).toBe(true);
  });

  it("splits a ';' inside a location instead of letting it corrupt LocationName", () => {
    const out = foldLegacyUsajobsConfig({ locationName: ["A;B"], locations: ["C;D"] }) as any;
    expect(out.locations).toEqual(["C", "D", "A", "B"]);
  });

  it("ignores a malformed legacy value rather than throwing", () => {
    expect(foldLegacyUsajobsConfig({ keyword: "k", positionTitle: 5, locationName: "x" })).toEqual({
      keyword: "k",
    });
  });
});
