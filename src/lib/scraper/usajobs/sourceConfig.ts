import { USAJOBS_MAX_LOCATIONS, USAJOBS_MAX_TITLES } from "./types";

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

// existing + legacy, deduped. Over the cap, the LEGACY entries are kept and
// the existing tail is trimmed: the legacy value was what the server searched
// on, so dropping it would change which jobs are fetched.
function foldInto(existing: string[], legacy: string[], cap: number): string[] {
  const merged = dedupeCaseInsensitive([...existing, ...legacy]);
  if (merged.length <= cap) return merged;
  const kept = dedupeCaseInsensitive(legacy).slice(0, cap);
  const keptKeys = new Set(kept.map((v) => v.toLowerCase()));
  const room = cap - kept.length;
  const rest = dedupeCaseInsensitive(existing).filter(
    (v) => !keptKeys.has(v.toLowerCase()),
  );
  return [...rest.slice(0, room), ...kept];
}

// A location containing ';' would be split by the API; split it up front.
const splitLocations = (values: string[]) => values.flatMap((v) => v.split(";"));

// Configs saved before the title/location fields were unified stored the
// server-side search in `positionTitle` (string) and `locationName` (string[])
// next to the ranking `targetTitles` / `locations`. Folds those into the
// shared fields (deduped, case-insensitive) and drops the legacy keys, so the
// schema (which strips unknown keys) never silently loses them.
//
// The shared lists were also unbounded before (ranking only), but are now
// capped because each title is a search; an older config over the cap is
// trimmed here rather than failing validation, so it keeps running. A config
// that is already current (no legacy keys, within the caps) passes through
// unchanged, as do non-objects.
export function foldLegacyUsajobsConfig(cfg: unknown): unknown {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return cfg;
  const { positionTitle, locationName, ...rest } = cfg as Record<
    string,
    unknown
  >;
  const hasLegacy = positionTitle !== undefined || locationName !== undefined;
  const over = (v: unknown, cap: number) => Array.isArray(v) && v.length > cap;
  const hasSemicolon =
    Array.isArray(rest.locations) &&
    rest.locations.some((l) => typeof l === "string" && l.includes(";"));
  if (
    !hasLegacy &&
    !over(rest.targetTitles, USAJOBS_MAX_TITLES) &&
    !over(rest.locations, USAJOBS_MAX_LOCATIONS) &&
    !hasSemicolon
  ) {
    return cfg;
  }

  const legacyTitles =
    typeof positionTitle === "string" ? [positionTitle.trim()] : [];
  const legacyLocations = splitLocations(strings(locationName));

  const out: Record<string, unknown> = { ...rest };
  if (legacyTitles.length || "targetTitles" in out) {
    out.targetTitles = foldInto(
      strings(out.targetTitles),
      legacyTitles,
      USAJOBS_MAX_TITLES,
    );
  }
  if (legacyLocations.length || "locations" in out) {
    out.locations = foldInto(
      splitLocations(strings(out.locations)),
      legacyLocations,
      USAJOBS_MAX_LOCATIONS,
    );
  }
  return out;
}
