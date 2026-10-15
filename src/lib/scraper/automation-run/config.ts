import { APP_CONSTANTS } from "@/lib/constants";
import type {
  JobBoard,
  UsajobsSourceConfig,
} from "@/models/automation.model";
import { UsajobsSourceConfigSchema } from "@/models/automation.schema";
import { foldLegacyUsajobsConfig } from "@/lib/scraper/usajobs/sourceConfig";

export interface AtsRunConfig {
  companies: { name: string; token: string; host?: "default" | "eu" }[];
  targetTitles: string[];
  keywords: string[];
  locations: string[];
  strictLocation: boolean;
  topK: number;
  saveUnanalyzed: boolean;
}

// Re-validated at run time (not just at save) so a hand-edited or legacy row
// cannot send an unvalidated value into the query string. Returns the ranking
// fields in the shared shape plus the validated USAJOBS query config. Rows
// saved before titles/keywords/locations were unified (positionTitle /
// keyword / locationName) are folded into targetTitles / keywords / locations
// first, so they keep working.
export function parseUsajobsConfig(
  sourceConfig: string | null | undefined,
): { query: UsajobsSourceConfig; ranking: Omit<AtsRunConfig, "companies"> } | null {
  if (!sourceConfig) return null;
  try {
    const cfg = foldLegacyUsajobsConfig(JSON.parse(sourceConfig)?.usajobs);
    const parsed = UsajobsSourceConfigSchema.safeParse(cfg);
    if (!parsed.success) return null;
    const q = parsed.data;
    return {
      query: q,
      ranking: {
        // The titles/locations are both the server-side search and the
        // ranking terms (one list each), so a job the API matched by synonym
        // still ranks against what the user asked for. Keywords are likewise
        // both (a saved legacy `keyword` is folded into them above).
        targetTitles: q.targetTitles ?? [],
        keywords: q.keywords ?? [],
        locations: q.locations ?? [],
        strictLocation: !!q.strictLocation,
        topK: q.topK ?? APP_CONSTANTS.MAX_JOBS_PER_RUN,
        saveUnanalyzed: q.saveUnanalyzed !== false,
      },
    };
  } catch {
    return null;
  }
}

export function parseAtsConfig(
  sourceConfig: string | null | undefined,
  jobBoard: JobBoard,
): AtsRunConfig | null {
  if (!sourceConfig) return null;
  try {
    const parsed = JSON.parse(sourceConfig);
    const cfg = parsed?.[jobBoard];
    if (!cfg || !Array.isArray(cfg.companies)) return null;
    return {
      companies: cfg.companies,
      targetTitles: Array.isArray(cfg.targetTitles) ? cfg.targetTitles : [],
      keywords: Array.isArray(cfg.keywords) ? cfg.keywords : [],
      locations: Array.isArray(cfg.locations) ? cfg.locations : [],
      strictLocation: !!cfg.strictLocation,
      topK:
        typeof cfg.topK === "number" && cfg.topK > 0
          ? cfg.topK
          : APP_CONSTANTS.MAX_JOBS_PER_RUN,
      saveUnanalyzed: cfg.saveUnanalyzed !== false,
    };
  } catch {
    return null;
  }
}
