import type { JobBoard, UsajobsSourceConfig } from "@/models/automation.model";
import type { JobDetails } from "../types";

// `host` is optional and Lever-only (Greenhouse ignores it); it's persisted
// once a company is resolved so runtime fetches never re-probe regions.
export type AtsHost = "default" | "eu";

export interface AtsSearchResult {
  jobs: JobDetails[];
  errors: { token: string; reason: string }[];
  // Soft, credential-free notes for the run log (e.g. a deliberate result
  // ceiling was hit). They never change the run status.
  notes?: string[];
}

interface AtsProviderBase {
  id: JobBoard;
  label: string; // display name shown in the wizard/detail UI
}

// Company-watchlist boards (Greenhouse, Lever, Ashby).
export interface AtsWatchlistProvider extends AtsProviderBase {
  // Fetch a watchlist with bounded concurrency + per-token isolation.
  search(
    companies: { name: string; token: string; host?: AtsHost }[],
  ): Promise<AtsSearchResult>;
}

// Query-based boards (USAJOBS): one search over the parsed source config, not
// a watchlist. The runner accounts for the query as a single pseudo-board
// (boardToken/boardName) so errors, partial results and notifications reuse
// the existing per-board machinery. `errors` may be non-empty alongside
// `jobs`: that is a PARTIAL fetch and the run must end completed_with_errors.
export interface AtsQueryProvider extends AtsProviderBase {
  boardToken: string;
  boardName: string;
  searchQuery(ctx: {
    userId: string;
    config: UsajobsSourceConfig;
    signal?: AbortSignal;
  }): Promise<AtsSearchResult>;
}

export type AtsProvider = AtsWatchlistProvider | AtsQueryProvider;

export function isQueryProvider(p: AtsProvider): p is AtsQueryProvider {
  return "searchQuery" in p;
}
