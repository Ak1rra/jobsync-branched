import type { BoardErrorCode } from "@/models/notification.model";

// Matches the strings the ATS fetchers (and the USAJOBS client) emit; the spec pins each one.
export function classifyBoardError(reason: string): BoardErrorCode {
  // startsWith: USAJOBS appends a "(partial: ...)" note to its reasons.
  if (reason.startsWith("rate limited")) return "rate_limited";
  if (/timed out/i.test(reason)) return "timeout";
  if (/malformed/i.test(reason)) return "parse";
  const status = reason.match(/returned (\d{3})/)?.[1];
  if (status === "404" || status === "410") return "not_found";
  // Greenhouse has no 429 branch, so its rate limit arrives as a status.
  if (status === "429") return "rate_limited";
  if (status) return "http_error";
  return "network";
}

const RUN_FAILURE_COPY: Record<string, string> = {
  resume_missing: "The resume this automation uses no longer exists.",
  no_companies: "No companies are on the watchlist.",
  source_removed: "This job board has been removed. Delete this automation.",
  usajobs_not_configured:
    "USAJOBS is not configured. Add your USAJOBS API key and registration email in Settings (or set USAJOBS_API_KEY and USAJOBS_USER_AGENT_EMAIL on the server).",
  usajobs_invalid_config:
    "This automation's USAJOBS search settings are invalid. Edit the automation and save it again.",
};

export function describeRunFailure(
  errorMessage: string | null,
  blockedReason: string | null,
): string {
  const key = blockedReason ?? errorMessage;
  if (!key) return "Unknown error";
  return RUN_FAILURE_COPY[key] ?? key;
}
