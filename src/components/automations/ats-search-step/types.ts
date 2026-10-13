import type {
  LeverSourceConfig,
  UsajobsSourceConfig,
} from "@/models/automation.model";

// The step is provider-agnostic; it edits the canonical Lever config shape — a
// superset of Greenhouse's, where the extra per-company `host` is unused and
// UI-invisible for Greenhouse.
export type AtsConfigValue = LeverSourceConfig;

// USAJOBS is query-based: no companies, but its own server-side filters.
export type UsajobsConfigValue = UsajobsSourceConfig;

// Boards whose automations track a company watchlist (picker, directory,
// watch). Query boards such as USAJOBS are deliberately excluded.
export type WatchlistBoard = "greenhouse" | "lever" | "ashby";

// The ranking/targeting fields every board's config shares, so the targeting
// and run-option fields can edit either config shape.
export type RankingFields = Pick<
  UsajobsSourceConfig,
  | "targetTitles"
  | "keywords"
  | "locations"
  | "strictLocation"
  | "topK"
  | "saveUnanalyzed"
>;

export type EntityOption = { id: string; label: string; value: string };

// Display name for a stored board id. Raw ids stay lowercase (the UI applies
// CSS capitalize) except USAJOBS, which is an acronym.
export function boardName(board: string): string {
  return board === "usajobs" ? "USAJOBS" : board;
}

export const PROVIDER_META: Record<
  string,
  { label: string; urlHint: string; searchExample: string }
> = {
  greenhouse: {
    label: "Greenhouse",
    urlHint: "Or paste a boards.greenhouse.io link",
    searchExample: "Anthropic",
  },
  lever: {
    label: "Lever",
    urlHint: "Or paste a jobs.lever.co link or token",
    searchExample: "Netflix",
  },
  ashby: {
    label: "Ashby",
    urlHint: "Or paste a jobs.ashbyhq.com link or token",
    searchExample: "Ramp",
  },
  // Label only. USAJOBS has no company directory, so urlHint/searchExample are
  // never rendered; the company pickers are not offered for it.
  usajobs: {
    label: "USAJOBS",
    urlHint: "",
    searchExample: "",
  },
};
