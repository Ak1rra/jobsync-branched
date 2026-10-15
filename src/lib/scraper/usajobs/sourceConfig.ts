// Pure helpers (no runtime imports): the client-bundled wizard and the
// server-side run both use them.

// First occurrence wins; compared trimmed and case-insensitively.
export function dedupeCaseInsensitive(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

// legacy + existing, deduped, nothing dropped. The legacy value goes FIRST:
// only the first few titles / keywords / locations are sent to the server (see
// searchPlan), and the legacy value is what the server used to search on, so
// it must stay among them. A legacy value that repeats an existing entry
// keeps the existing spelling.
function foldInto(existing: string[], legacy: string[]): string[] {
  const spelling = new Map<string, string>();
  for (const v of dedupeCaseInsensitive(existing)) spelling.set(v.toLowerCase(), v);
  const first = legacy.map((v) => spelling.get(v.trim().toLowerCase()) ?? v);
  return dedupeCaseInsensitive([...first, ...existing]);
}

// A location containing ';' would be split by the API; split it up front.
const splitLocations = (values: string[]) => values.flatMap((v) => v.split(";"));

// The longest keyword the schema accepts; the legacy `keyword` allowed 200.
const MAX_KEYWORD_LENGTH = 100;

// Configs saved before the title/keyword/location fields were unified stored
// the server-side search in `positionTitle` (string), `keyword` (string) and
// `locationName` (string[]) next to the ranking `targetTitles` / `keywords` /
// `locations`. Folds those into the shared fields (deduped, case-insensitive)
// and drops the legacy keys, so the schema (which strips unknown keys) never
// silently loses them.
//
// Nothing is trimmed: every entry keeps ranking results. Only how many are
// sent to the server is limited, at request time. A config that is already
// current (no legacy keys, no ';' in a location) passes through unchanged, as
// do non-objects.
export function foldLegacyUsajobsConfig(cfg: unknown): unknown {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return cfg;
  const { positionTitle, keyword, locationName, ...rest } = cfg as Record<
    string,
    unknown
  >;
  const hasLegacy =
    positionTitle !== undefined ||
    keyword !== undefined ||
    locationName !== undefined;
  const hasSemicolon =
    Array.isArray(rest.locations) &&
    rest.locations.some((l) => typeof l === "string" && l.includes(";"));
  if (!hasLegacy && !hasSemicolon) return cfg;

  const legacyTitles =
    typeof positionTitle === "string" ? [positionTitle.trim()] : [];
  const legacyKeywords =
    typeof keyword === "string" ? [keyword.trim().slice(0, MAX_KEYWORD_LENGTH)] : [];
  const legacyLocations = splitLocations(strings(locationName));

  const out: Record<string, unknown> = { ...rest };
  if (legacyTitles.length || "targetTitles" in out) {
    out.targetTitles = foldInto(strings(out.targetTitles), legacyTitles);
  }
  if (legacyKeywords.length || "keywords" in out) {
    out.keywords = foldInto(strings(out.keywords), legacyKeywords);
  }
  if (legacyLocations.length || "locations" in out) {
    out.locations = foldInto(
      splitLocations(strings(out.locations)),
      legacyLocations,
    );
  }
  return out;
}
