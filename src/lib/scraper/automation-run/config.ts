import { APP_CONSTANTS } from "@/lib/constants";
import type {
  JobBoard,
  UsajobsSourceConfig,
} from "@/models/automation.model";
import { UsajobsSourceConfigSchema } from "@/models/automation.schema";

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
// fields in the shared shape plus the validated USAJOBS query config.
export function parseUsajobsConfig(
  sourceConfig: string | null | undefined,
): { query: UsajobsSourceConfig; ranking: Omit<AtsRunConfig, "companies"> } | null {
  if (!sourceConfig) return null;
  try {
    const cfg = JSON.parse(sourceConfig)?.usajobs;
    const parsed = UsajobsSourceConfigSchema.safeParse(cfg);
    if (!parsed.success) return null;
    const q = parsed.data;
    return {
      query: q,
      ranking: {
        // The server-side title/keyword is the user's own relevance
        // statement, so it also counts as a ranking term; otherwise a
        // search the API matched by synonym could fail the relevance floor.
        targetTitles: [
          ...(q.targetTitles ?? []),
          ...(q.positionTitle ? [q.positionTitle] : []),
        ],
        keywords: [...(q.keywords ?? []), ...(q.keyword ? [q.keyword] : [])],
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
