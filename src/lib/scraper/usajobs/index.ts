import { APP_CONSTANTS } from "@/lib/constants";
import { resolveApiKey } from "@/lib/api-key-resolver";
import type { UsajobsSourceConfig } from "@/models/automation.model";
import type { JobDetails } from "../types";
import type { AtsSearchResult } from "../ats/types";
import {
  annualSalaryRange,
  mapUsajobsItem,
  parseUsajobsDate,
} from "./mapper";
import { dedupeCaseInsensitive } from "./sourceConfig";
import {
  USAJOBS_EMAIL_REGEX,
  USAJOBS_KEY_REGEX,
  USAJOBS_MAX_KEYWORDS,
  USAJOBS_MAX_LOCATIONS,
  USAJOBS_MAX_TITLES,
  type UsajobsCredentials,
  UsajobsFailure,
  UsajobsFetchOptions,
  UsajobsFetchResult,
  UsajobsFilters,
  UsajobsSearchItem,
  UsajobsSearchResponse,
} from "./types";

// The one pseudo-"board" a query-based run is accounted under (errors, the
// failure notification row). Fixed so a repeated failure resurfaces one row.
export const USAJOBS_BOARD_TOKEN = "usajobs";
export const USAJOBS_BOARD_NAME = "USAJOBS search";
// errorMessage of a run that has no usable key / registration email.
export const USAJOBS_NOT_CONFIGURED = "usajobs_not_configured";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export type UsajobsCredentialResult =
  | { credentials: UsajobsCredentials; problem?: undefined }
  // `problem` is an actionable, secret-free sentence for the run log.
  | { credentials: null; problem: string };

// Credentials are one pair, never mixed across sources:
//  - the user saved both rows     -> use them
//  - the user saved neither       -> the server environment pair
//    (USAJOBS_API_KEY and USAJOBS_USER_AGENT_EMAIL, both required)
//  - the user saved exactly one   -> not configured, naming the gap
//    (falling back would pair one account's key with another's email)
export async function resolveUsajobsCredentials(
  userId: string | undefined,
): Promise<UsajobsCredentialResult> {
  const own = { envFallback: false };
  const [ownKey, ownEmail] = await Promise.all([
    resolveApiKey(userId, "usajobs", own),
    resolveApiKey(userId, "usajobs_email", own),
  ]);

  let key = ownKey?.trim();
  let email = ownEmail?.trim();
  let source = "saved in Settings";

  if (!key && !email) {
    // No userId: resolveApiKey consults only the environment.
    const [envKey, envEmail] = await Promise.all([
      resolveApiKey(undefined, "usajobs"),
      resolveApiKey(undefined, "usajobs_email"),
    ]);
    key = envKey?.trim();
    email = envEmail?.trim();
    source = "set in the server environment";
    if (!key && !email) {
      return {
        credentials: null,
        problem:
          "No USAJOBS credentials are configured. Save your API key and registration email in Settings, or set USAJOBS_API_KEY and USAJOBS_USER_AGENT_EMAIL on the server.",
      };
    }
    if (!key || !email) {
      const missing = key ? "USAJOBS_USER_AGENT_EMAIL" : "USAJOBS_API_KEY";
      return {
        credentials: null,
        problem: `Only one of USAJOBS_API_KEY and USAJOBS_USER_AGENT_EMAIL is set in the server environment (${missing} is missing); both are required.`,
      };
    }
  } else if (!key || !email) {
    const missing = key ? "registration email" : "API key";
    return {
      credentials: null,
      problem: `Your USAJOBS ${missing} is not saved in Settings. Save both the API key and the registration email, or remove the one you saved to use the server credentials.`,
    };
  }

  if (!USAJOBS_KEY_REGEX.test(key)) {
    return {
      credentials: null,
      problem: `The USAJOBS API key ${source} is not valid (it must be plain ASCII with no spaces). Re-enter it.`,
    };
  }
  if (!USAJOBS_EMAIL_REGEX.test(email)) {
    return {
      credentials: null,
      problem: `The USAJOBS registration email ${source} is not a valid address. Re-enter it.`,
    };
  }
  return { credentials: { apiKey: key, userAgentEmail: email } };
}

export function buildUsajobsHeaders(
  creds: UsajobsCredentials,
): Record<string, string> {
  return {
    Host: APP_CONSTANTS.USAJOBS_HOST,
    "User-Agent": creds.userAgentEmail,
    "Authorization-Key": creds.apiKey,
    Accept: "application/json",
  };
}

// ---------------------------------------------------------------------------
// Query construction
// ---------------------------------------------------------------------------

const WHO_MAY_APPLY_WIRE = {
  public: "Public",
  status: "Status",
  all: "All",
} as const;

// Multi-value parameters are semicolon-delimited per the API docs.
const join = (values: (string | number)[]) => values.join(";");

// Derives the request filters from a saved config: the shared targetTitles
// become the PositionTitle searches, the shared keywords the Keyword searches
// (only used when there are no titles, see UsajobsFilters.keywords) and the
// shared locations the LocationName list (the config stores no separate
// server-side title/keyword/location).
export function toUsajobsFilters(config: UsajobsSourceConfig): UsajobsFilters {
  const { targetTitles, keywords, locations, ...rest } = config;
  const filters: UsajobsFilters = rest;
  const titles = dedupeCaseInsensitive(targetTitles ?? []);
  const words = dedupeCaseInsensitive(keywords ?? []);
  const places = dedupeCaseInsensitive(locations ?? []);
  if (titles.length) filters.positionTitles = titles;
  if (words.length) filters.keywords = words;
  if (places.length) filters.locationName = places;
  return filters;
}

// Translates one search into [name, value] pairs in a fixed order. Absent
// filters are omitted. Values are encoded by buildUsajobsUrl. PositionTitle
// and Keyword take a single value, so the title / keyword of THIS search are
// passed explicitly (f.positionTitles / f.keywords list them all; the fetcher
// runs one search each, see searchPlan).
export function buildUsajobsParams(
  f: UsajobsFilters,
  page: number,
  pageSize: number,
  positionTitle?: string,
  keyword?: string,
): [string, string][] {
  const p: [string, string][] = [];
  const add = (name: string, value: string | number | undefined) => {
    if (value !== undefined && value !== "") p.push([name, String(value)]);
  };
  const addList = (name: string, values?: (string | number)[]) => {
    if (values?.length) add(name, join(values));
  };

  add("Keyword", keyword);
  add("PositionTitle", positionTitle);
  addList("LocationName", f.locationName?.slice(0, USAJOBS_MAX_LOCATIONS));
  add("Radius", f.radius);
  addList("Organization", f.organization);
  addList("JobCategoryCode", f.jobCategoryCode);
  add("RemunerationMinimumAmount", f.remunerationMinimumAmount);
  add("RemunerationMaximumAmount", f.remunerationMaximumAmount);
  add("PayGradeLow", f.payGradeLow?.padStart(2, "0"));
  add("PayGradeHigh", f.payGradeHigh?.padStart(2, "0"));
  addList("HiringPath", f.hiringPath);
  // The docs list "All", "Public", "Status" (only their example URL is
  // lowercase); send the documented capitalization.
  add("WhoMayApply", f.whoMayApply && WHO_MAY_APPLY_WIRE[f.whoMayApply]);
  if (f.remoteIndicator !== undefined) {
    add("RemoteIndicator", f.remoteIndicator ? "True" : "False");
  }
  addList("PositionScheduleTypeCode", f.positionScheduleTypeCode);
  addList("PositionOfferingTypeCode", f.positionOfferingTypeCode);
  addList("SecurityClearanceRequired", f.securityClearanceRequired);
  add("DatePosted", f.datePosted);
  add("SortField", f.sortField);
  if (f.sortDirection) {
    add("SortDirection", f.sortDirection === "asc" ? "Asc" : "Desc");
  }
  add("Fields", f.fields ?? "Full");
  add("ResultsPerPage", pageSize);
  add("Page", page);
  return p;
}

// One server-side search of a run: a title and/or a keyword.
interface UsajobsSearch {
  title?: string;
  keyword?: string;
}

// The searches a run makes. Titles take precedence: one search per title (the
// first USAJOBS_MAX_TITLES), and the keywords then only rank results
// client-side (a title x keyword product would multiply requests). With no
// titles, one search per keyword (the first USAJOBS_MAX_KEYWORDS). With
// neither, a single search on the other filters. Entries left out of the
// searches still rank results; see searchLimitNotes.
export function searchPlan(f: UsajobsFilters): UsajobsSearch[] {
  if (f.positionTitles?.length) {
    return f.positionTitles
      .slice(0, USAJOBS_MAX_TITLES)
      .map((title) => ({ title }));
  }
  if (f.keywords?.length) {
    return f.keywords
      .slice(0, USAJOBS_MAX_KEYWORDS)
      .map((keyword) => ({ keyword }));
  }
  return [{}];
}

// Run-log notes for entries that are not sent to USAJOBS because of the
// per-request limits above. Soft notes, not failures: the run status does not
// change, and every entry still ranks results.
export function searchLimitNotes(f: UsajobsFilters): string[] {
  const notes: string[] = [];
  const titles = f.positionTitles?.length ?? 0;
  const keywords = f.keywords?.length ?? 0;
  const places = f.locationName?.length ?? 0;
  if (titles > USAJOBS_MAX_TITLES) {
    notes.push(
      `Searched USAJOBS for the first ${USAJOBS_MAX_TITLES} of ${titles} titles; all ${titles} still rank results`,
    );
  } else if (!titles && keywords > USAJOBS_MAX_KEYWORDS) {
    notes.push(
      `Searched USAJOBS for the first ${USAJOBS_MAX_KEYWORDS} of ${keywords} keywords; all ${keywords} still rank results`,
    );
  }
  if (places > USAJOBS_MAX_LOCATIONS) {
    notes.push(
      `Searched USAJOBS in the first ${USAJOBS_MAX_LOCATIONS} of ${places} locations; all ${places} still apply to your location filter`,
    );
  }
  return notes;
}

// encodeURIComponent (not URLSearchParams) so spaces are %20, as in the
// official examples, rather than '+'.
export function buildUsajobsUrl(
  f: UsajobsFilters,
  page: number,
  pageSize: number = APP_CONSTANTS.USAJOBS_PAGE_SIZE,
  positionTitle?: string,
  keyword?: string,
): string {
  const query = buildUsajobsParams(f, page, pageSize, positionTitle, keyword)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${APP_CONSTANTS.USAJOBS_BASE_URL}?${query}`;
}

// CLIENT-SIDE filters for what the API cannot express exactly. Applied to the
// raw item after fetch; unknowns are always kept (never drop on missing data).
//  - Closed announcements: the API should not return them, but a stale page
//    must not save a posting that can no longer be applied to.
//  - Salary bounds: RemunerationMinimum/MaximumAmount match salary *buckets*
//    (coarse), so re-check the actual per-year range when the item has one.
function passesClientFilters(
  item: UsajobsSearchItem,
  f: UsajobsFilters,
  nowMs: number,
): boolean {
  const d = item.MatchedObjectDescriptor;
  const closes = parseUsajobsDate(d?.ApplicationCloseDate);
  if (closes && new Date(closes).getTime() < nowMs) return false;

  if (
    f.remunerationMinimumAmount !== undefined ||
    f.remunerationMaximumAmount !== undefined
  ) {
    const range = annualSalaryRange(d?.PositionRemuneration);
    if (range) {
      if (
        f.remunerationMinimumAmount !== undefined &&
        range.max < f.remunerationMinimumAmount
      ) {
        return false;
      }
      if (
        f.remunerationMaximumAmount !== undefined &&
        range.min > f.remunerationMaximumAmount
      ) {
        return false;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Transport: one overall deadline, bounded retries, classified failures
// ---------------------------------------------------------------------------

function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Retry-After is delta-seconds or an HTTP date.
function parseRetryAfter(raw: string | null | undefined, nowMs: number) {
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - nowMs) / 1000));
}

type PageResult =
  | { ok: true; body: UsajobsSearchResponse }
  | { ok: false; failure: UsajobsFailure };

export async function fetchUsajobsJobs(
  creds: UsajobsCredentials,
  filters: UsajobsFilters,
  options: UsajobsFetchOptions = {},
): Promise<UsajobsFetchResult> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const maxAttempts = options.maxAttempts ?? APP_CONSTANTS.USAJOBS_MAX_ATTEMPTS;
  const pageSize = APP_CONSTANTS.USAJOBS_PAGE_SIZE;
  const external = options.signal;

  // One deadline for the whole loop (every page and every retry wait), and an
  // external abort (user cancel) folded into the same controller.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? APP_CONSTANTS.USAJOBS_FETCH_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  if (external?.aborted) controller.abort();
  else external?.addEventListener("abort", onExternalAbort, { once: true });

  const headers = buildUsajobsHeaders(creds);
  // Defense in depth: no message may carry the key or the registration email.
  const scrub = (text: string) =>
    [creds.apiKey, creds.userAgentEmail].reduce(
      (acc, secret) => (secret ? acc.split(secret).join("[redacted]") : acc),
      text,
    );
  const fail = (
    kind: UsajobsFailure["kind"],
    message: string,
    extra: Partial<UsajobsFailure> = {},
  ): PageResult => ({
    ok: false,
    failure: { kind, message: scrub(message), ...extra },
  });

  // A thrown abort is either the user's cancel (propagate so the run ends
  // "cancelled") or our own deadline (a classified timeout failure).
  const handleAbort = (): PageResult => {
    if (external?.aborted) throw abortError();
    return fail("timeout", "USAJOBS search timed out");
  };
  const isAbort = (e: unknown) =>
    controller.signal.aborted ||
    (e instanceof Error && e.name === "AbortError");

  const backoffMs = (attempt: number) => {
    const ceiling = Math.min(
      APP_CONSTANTS.USAJOBS_RETRY_MAX_DELAY_MS,
      APP_CONSTANTS.USAJOBS_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
    );
    return Math.round(ceiling / 2 + (random() * ceiling) / 2); // equal jitter
  };

  async function fetchPage(
    page: number,
    search: UsajobsSearch,
  ): Promise<PageResult> {
    const url = buildUsajobsUrl(
      filters,
      page,
      pageSize,
      search.title,
      search.keyword,
    );
    for (let attempt = 1; ; attempt++) {
      if (controller.signal.aborted) return handleAbort();
      const canRetry = attempt < maxAttempts;
      let retryDelayMs: number;
      let last: PageResult;

      try {
        const res = await fetch(url, { headers, signal: controller.signal });

        if (res.status === 401 || res.status === 403) {
          return fail(
            "auth",
            `USAJOBS returned ${res.status} - the API key or registration email was rejected`,
            { status: res.status },
          );
        }
        if (res.status === 400) {
          return fail(
            "invalid_request",
            "USAJOBS returned 400 - the search was rejected as invalid",
            { status: 400 },
          );
        }
        if (res.status === 429) {
          const retryAfter = parseRetryAfter(
            res.headers?.get?.("retry-after"),
            now(),
          );
          const wait =
            retryAfter !== undefined ? retryAfter * 1000 : backoffMs(attempt);
          // Honour Retry-After only when the wait is short; otherwise give up
          // and let the next scheduled run try again.
          if (!canRetry || wait > APP_CONSTANTS.USAJOBS_RETRY_MAX_DELAY_MS) {
            return fail("rate_limited", "rate limited", {
              status: 429,
              retryAfterSeconds: retryAfter,
            });
          }
          retryDelayMs = wait;
          last = fail("rate_limited", "rate limited", { status: 429 });
        } else if (res.status >= 500) {
          retryDelayMs = backoffMs(attempt);
          last = fail("server", `USAJOBS returned ${res.status}`, {
            status: res.status,
          });
        } else if (!res.ok) {
          // Other 4xx: the request itself is wrong; retrying cannot help.
          return fail(
            "invalid_request",
            `USAJOBS returned ${res.status}`,
            { status: res.status },
          );
        } else {
          let body: UsajobsSearchResponse;
          try {
            body = await res.json();
          } catch (e) {
            if (isAbort(e)) return handleAbort();
            return fail("parse", "USAJOBS returned a malformed response");
          }
          const items = body?.SearchResult?.SearchResultItems;
          if (!body?.SearchResult || !Array.isArray(items)) {
            return fail("parse", "USAJOBS returned a malformed response");
          }
          return { ok: true, body };
        }
      } catch (e) {
        if (isAbort(e)) return handleAbort();
        retryDelayMs = backoffMs(attempt);
        const code = (e as { cause?: { code?: unknown } })?.cause?.code;
        last = fail(
          "network",
          typeof code === "string"
            ? `USAJOBS network error (${code})`
            : "USAJOBS network error",
        );
      }

      if (!canRetry) return last;
      try {
        await sleep(retryDelayMs, controller.signal);
      } catch {
        return handleAbort();
      }
    }
  }

  const jobs: JobDetails[] = [];
  // Announcements already handled by ANY search of this run (merge dedupe).
  const handled = new Set<string>();
  let pagesFetched = 0;
  let skipped = 0;
  let totalAvailable: number | undefined;
  let truncated = false;
  let failure: UsajobsFailure | undefined;
  // Set when continuing cannot help (credentials rejected, deadline hit,
  // rate limited) or a shared ceiling was reached.
  let stopAll = false;
  let searchesRun = 0;

  const keyOf = (it: UsajobsSearchItem) =>
    String(it?.MatchedObjectId ?? it?.MatchedObjectDescriptor?.PositionURI ?? "");

  // PositionTitle and Keyword take one value, so each title (or, with no
  // titles, each keyword) is its own paginated search. They share the
  // deadline, retry policy, page/result ceilings and the merged dedupe set.
  const searches = searchPlan(filters);

  // One paginated search; mutates the shared state above.
  async function runSearch(search: UsajobsSearch) {
    // Per-search: a server that ignores `Page` returns the same rows, and
    // each search counts its own rows against its own SearchResultCountAll.
    const seenInSearch = new Set<string>();
    let rawSeen = 0;
    searchesRun++;

    for (let page = 1; ; page++) {
      const result = await fetchPage(page, search);
      if (!result.ok) {
        failure ??= result.failure;
        const k = result.failure.kind;
        if (k === "auth" || k === "timeout" || k === "rate_limited") {
          stopAll = true;
        }
        return;
      }
      pagesFetched++;

      const sr = result.body.SearchResult!;
      const items = sr.SearchResultItems!;
      const all = Number(sr.SearchResultCountAll);
      if (Number.isFinite(all)) totalAvailable = all;
      const pages = Number.parseInt(String(sr.UserArea?.NumberOfPages), 10);

      if (items.length === 0) return;

      // Repeat-page guard: stop instead of refetching the same rows up to the
      // page ceiling.
      const keys = items.map(keyOf);
      if (keys.every((k) => k && seenInSearch.has(k))) return;
      keys.forEach((k) => k && seenInSearch.add(k));
      rawSeen += items.length;

      for (const item of items) {
        const key = keyOf(item);
        // Already returned by an earlier search (or page) of this run.
        if (key && handled.has(key)) continue;
        if (key) handled.add(key);
        const mapped = mapUsajobsItem(item);
        if (!mapped || !passesClientFilters(item, filters, now())) {
          skipped++;
          continue;
        }
        jobs.push(mapped);
      }

      const lastPage =
        (Number.isFinite(pages) && page >= pages) ||
        (totalAvailable !== undefined && rawSeen >= totalAvailable) ||
        (!Number.isFinite(pages) && items.length < pageSize);
      if (lastPage) return;

      if (
        pagesFetched >= APP_CONSTANTS.USAJOBS_MAX_PAGES ||
        jobs.length >= APP_CONSTANTS.USAJOBS_MAX_RESULTS
      ) {
        truncated = true; // more pages exist; we stopped at a safety ceiling
        stopAll = true;
        return;
      }

      try {
        await sleep(APP_CONSTANTS.USAJOBS_PAGE_DELAY_MS, controller.signal);
      } catch {
        const timeout = handleAbort();
        if (!timeout.ok) failure ??= timeout.failure;
        stopAll = true;
        return;
      }
    }
  }

  try {
    for (let i = 0; i < searches.length && !stopAll; i++) {
      if (i > 0) {
        // Searches remain but a shared ceiling is already used up.
        if (
          pagesFetched >= APP_CONSTANTS.USAJOBS_MAX_PAGES ||
          jobs.length >= APP_CONSTANTS.USAJOBS_MAX_RESULTS
        ) {
          truncated = true;
          break;
        }
        try {
          await sleep(APP_CONSTANTS.USAJOBS_PAGE_DELAY_MS, controller.signal);
        } catch {
          const timeout = handleAbort();
          if (!timeout.ok) failure ??= timeout.failure;
          break;
        }
      }
      await runSearch(searches[i]);
    }
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onExternalAbort);
  }

  // Several searches overlap, so their SearchResultCountAll values do not add
  // up to a count of distinct announcements; only report it for one search.
  if (searchesRun > 1) totalAvailable = undefined;

  return {
    jobs: jobs.slice(0, APP_CONSTANTS.USAJOBS_MAX_RESULTS),
    failure,
    pagesFetched,
    skipped,
    totalAvailable,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Provider entry point (AtsQueryProvider.searchQuery)
// ---------------------------------------------------------------------------

function failureReason(result: UsajobsFetchResult): string {
  const f = result.failure!;
  if (result.jobs.length === 0) return f.message;
  // Partial: say so, so a truncated result never reads as a complete fetch.
  return `${f.message} (partial: kept ${result.jobs.length} job(s) from ${result.pagesFetched} page(s))`;
}

export async function searchUsajobsJobs(ctx: {
  userId: string;
  config: UsajobsSourceConfig;
  signal?: AbortSignal;
}): Promise<AtsSearchResult> {
  const { credentials, problem } = await resolveUsajobsCredentials(ctx.userId);
  if (!credentials) {
    return {
      jobs: [],
      errors: [{ token: USAJOBS_BOARD_TOKEN, reason: USAJOBS_NOT_CONFIGURED }],
      notes: [problem],
    };
  }

  const filters = toUsajobsFilters(ctx.config);
  const result = await fetchUsajobsJobs(credentials, filters, {
    signal: ctx.signal,
  });
  const fetched = result.jobs.length + result.skipped;
  return {
    jobs: result.jobs,
    errors: result.failure
      ? [{ token: USAJOBS_BOARD_TOKEN, reason: failureReason(result) }]
      : [],
    // A deliberate cap (like ATS_LISTING_CAP), not a failure: log it and keep
    // the run "completed".
    notes: [
      ...searchLimitNotes(filters),
      ...(result.truncated
        ? [
            `Result ceiling reached: fetched ${fetched}${
              result.totalAvailable !== undefined
                ? ` of ${result.totalAvailable}`
                : ""
            } matching announcements - narrow your filters to see the rest`,
          ]
        : []),
    ],
  };
}
