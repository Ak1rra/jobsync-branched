// Automation types and interfaces

import type { UsajobsFilters } from "@/lib/scraper/usajobs/types";

export type AutomationStatus = "active" | "paused";
export type AutomationRunStatus =
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "completed_with_errors"
  | "blocked"
  | "rate_limited"
  | "cancelled";
export type DiscoveryStatus = "new" | "accepted" | "dismissed";
export type JobBoard = "greenhouse" | "lever" | "ashby" | "usajobs";

export interface GreenhouseCompany {
  name: string;
  token: string;
}

export interface GreenhouseSourceConfig {
  companies: GreenhouseCompany[];
  targetTitles?: string[];
  keywords?: string[];
  locations?: string[];
  strictLocation?: boolean;
  topK?: number;
  saveUnanalyzed?: boolean;
}

export type LeverHost = "default" | "eu";

export interface LeverCompany {
  name: string;
  token: string;
  host?: LeverHost; // absent/"default" = the common case
}

// Field-identical to Greenhouse except `companies` carries the extra `host`.
export interface LeverSourceConfig
  extends Omit<GreenhouseSourceConfig, "companies"> {
  companies: LeverCompany[];
}

// Ashby has a single global host, so its company entries are the plain
// {name, token} shape — no `host`, unlike Lever.
export interface AshbyCompany {
  name: string;
  token: string;
}

export interface AshbySourceConfig
  extends Omit<GreenhouseSourceConfig, "companies"> {
  companies: AshbyCompany[];
}

// USAJOBS is query-based, not a company watchlist: there is no `companies`.
// The server-side filters (UsajobsFilters) narrow the API query; the shared
// targetTitles/keywords/locations/strictLocation/topK/saveUnanalyzed fields
// drive the same client-side ranking pipeline as the other boards. The shared
// targetTitles and locations are ALSO the server-side title/location search
// (single source of truth), so the filters' own positionTitles/locationName
// are derived at request time and never stored.
export interface UsajobsSourceConfig
  extends Omit<GreenhouseSourceConfig, "companies">,
    Omit<UsajobsFilters, "positionTitles" | "locationName"> {}

export interface SourceConfig {
  greenhouse?: GreenhouseSourceConfig;
  lever?: LeverSourceConfig;
  ashby?: AshbySourceConfig;
  usajobs?: UsajobsSourceConfig;
}

// Plain, dependency-free list of the company-watchlist boards. Do NOT import this from ats/registry.ts
// (that pulls the network-calling search fns into client bundles). The
// company/watchlist UIs import it here; the scheduler iterates RUNNABLE_BOARDS
// below.
export const ATS_BOARDS: JobBoard[] = ["greenhouse", "lever", "ashby"];

// Query-based boards: one search over the source config, no company watchlist.
// Deliberately NOT in ATS_BOARDS, whose consumers (watchlist/company UIs) key
// per-company data by board.
export const QUERY_BOARDS: JobBoard[] = ["usajobs"];

// Every board a scheduled or manual run can execute.
export const RUNNABLE_BOARDS: JobBoard[] = [...ATS_BOARDS, ...QUERY_BOARDS];

// Boards that used to exist and were removed. Their Automation rows stay in
// the database; the UI marks them retired and only offers pause/delete.
export const RETIRED_BOARDS = ["jsearch"];
export function isRetiredBoard(board: string): boolean {
  return RETIRED_BOARDS.includes(board);
}

export interface Automation {
  id: string;
  userId: string;
  name: string;
  jobBoard: JobBoard;
  keywords: string;
  location: string;
  sourceConfig?: string | null;
  resumeId: string;
  matchThreshold: number;
  scheduleHour: number;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  status: AutomationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationWithResume extends Automation {
  resume: {
    id: string;
    title: string;
  };
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  jobsSearched: number;
  jobsDeduplicated: number;
  jobsProcessed: number;
  jobsMatched: number;
  jobsSaved: number;
  status: AutomationRunStatus;
  errorMessage: string | null;
  blockedReason: string | null;
  funnelStats: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface DiscoveredJob {
  id: string;
  userId: string;
  automationId: string;
  automation?: {
    id: string;
    name: string;
  };
  jobUrl: string | null;
  description: string;
  jobType: string;
  workplaceType?: string | null;
  createdAt: Date;
  jobTitleId: string;
  companyId: string;
  locationId: string | null;
  matchScore: number;
  matchData: string | null;
  discoveryStatus: DiscoveryStatus;
  discoveredAt: Date;
  JobTitle: { label: string };
  Company: { label: string };
  Location?: { label: string } | null;
}

export interface ScrapedJobData {
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl: string;
  sourceBoard: JobBoard;
  employmentType?: string;
  isRemote?: boolean;
  workplaceType?: string;
  dueDate?: string; // ISO; overrides the default due-date window when valid
}
