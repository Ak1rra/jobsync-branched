import { APP_CONSTANTS } from "@/lib/constants";
import type { CreateAutomationInput } from "@/models/automation.schema";
import type { JobBoard } from "@/models/automation.model";
import { foldLegacyUsajobsConfig } from "@/lib/scraper/usajobs/sourceConfig";
import type { AtsConfigValue } from "../AtsSearchStep";
import type {
  UsajobsConfigValue,
  WatchlistBoard,
} from "../ats-search-step/types";

// Boards that track a company watchlist. USAJOBS is query-based and has its
// own config (EMPTY_USAJOBS) and search step.
export type AtsKey = WatchlistBoard;

export function isQueryBoard(board: JobBoard): board is "usajobs" {
  return board === "usajobs";
}

export const EMPTY_ATS: AtsConfigValue = {
  companies: [],
  targetTitles: [],
  keywords: [],
  locations: [],
  strictLocation: false,
  topK: APP_CONSTANTS.MAX_JOBS_PER_RUN,
  saveUnanalyzed: true,
};

// No search criterion yet, so the wizard blocks "Next" until one is entered
// (the schema requires at least one).
export const EMPTY_USAJOBS: UsajobsConfigValue = {
  targetTitles: [],
  keywords: [],
  locations: [],
  strictLocation: false,
  topK: APP_CONSTANTS.MAX_JOBS_PER_RUN,
  saveUnanalyzed: true,
};

export const STEPS = [
  { id: "basics", title: "Basics", description: "Name your automation" },
  { id: "search", title: "Search", description: "Configure search criteria" },
  { id: "resume", title: "Resume", description: "Select resume for matching" },
  { id: "matching", title: "Matching", description: "Set match threshold" },
  { id: "schedule", title: "Schedule", description: "When to run" },
  { id: "review", title: "Review", description: "Confirm settings" },
];

export const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${i.toString().padStart(2, "0")}:00`,
}));

// Weekday preselected when the user switches a schedule to weekly (Monday).
export const DEFAULT_WEEKLY_DAY = 1;

export function parseEditSourceConfig(
  sc?: string | null,
): CreateAutomationInput["sourceConfig"] | undefined {
  if (!sc) return undefined;
  try {
    const parsed = JSON.parse(sc);
    if (!(parsed?.greenhouse || parsed?.lever || parsed?.ashby || parsed?.usajobs)) {
      return undefined;
    }
    // A USAJOBS config saved before titles/locations were unified keeps them
    // in positionTitle/locationName; fold them into the shared fields so the
    // edit form shows them in the one title and location field.
    return parsed.usajobs
      ? { ...parsed, usajobs: foldLegacyUsajobsConfig(parsed.usajobs) }
      : parsed;
  } catch {
    return undefined;
  }
}

export interface WizardResume {
  id: string;
  title: string;
  sectionCount: number;
}
