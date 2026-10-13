import type { JobDetails } from "../types";

// Pure types + option lists for the USAJOBS Search API
// (https://developer.usajobs.gov/api-reference/get-api-search). No runtime
// imports: the client-bundled automation schema deep-imports this file.

// Documented value lists. Kept here so the schema (save-boundary validation),
// the param translator, and the future UI pickers share one source.
export const USAJOBS_HIRING_PATHS = [
  "public",
  "vet",
  "nguard",
  "disability",
  "native",
  "mspouse",
  "student",
  "ses",
  "peace",
  "overseas",
  "fed-internal-search",
  "graduates",
  "fed-excepted",
  "fed-competitive",
  "fed-transition",
  "land",
  "special-authorities",
] as const;
export type UsajobsHiringPath = (typeof USAJOBS_HIRING_PATHS)[number];

// Header values must be printable ASCII with no whitespace; anything else
// would make fetch throw an error that echoes the offending value. Shared by
// save-time validation (apiKeySaveSchema) and run-time credential checks.
export const USAJOBS_KEY_REGEX = /^[\x21-\x7E]+$/;
export const USAJOBS_EMAIL_REGEX = /^[\x21-\x7E]+@[\x21-\x7E]+\.[\x21-\x7E]+$/;

// "All" and "Status" additionally require specific authorization from OPM.
export const USAJOBS_WHO_MAY_APPLY = ["public", "status", "all"] as const;
export type UsajobsWhoMayApply = (typeof USAJOBS_WHO_MAY_APPLY)[number];

// PositionScheduleTypeCode: 1 full-time, 2 part-time, 3 shift work,
// 4 intermittent, 5 job sharing, 6 multiple schedules.
export const USAJOBS_SCHEDULE_CODES = [1, 2, 3, 4, 5, 6] as const;

// SecurityClearanceRequired: 0 none, 1 Confidential, 2 Secret, 3 Top Secret,
// 4 SCI, 5 Q, 7 L, 8 Other. (6 is not documented.)
export const USAJOBS_CLEARANCE_CODES = [0, 1, 2, 3, 4, 5, 7, 8] as const;

export const USAJOBS_SORT_FIELDS = [
  "opendate",
  "closedate",
  "organizationname",
  "jobtitle",
  "positiontitle",
  "openingdate",
  "closingdate",
  "honame",
  "salarymin",
  "location",
  "department",
  "title",
  "agency",
  "salary",
] as const;
export type UsajobsSortField = (typeof USAJOBS_SORT_FIELDS)[number];

export const USAJOBS_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type UsajobsSortDirection = (typeof USAJOBS_SORT_DIRECTIONS)[number];

// Fields=Min returns the summary only; Full adds duties/requirements/etc.
export const USAJOBS_FIELDS = ["Min", "Full"] as const;
export type UsajobsFields = (typeof USAJOBS_FIELDS)[number];

// Server-side filters, one-to-one with the documented query parameters
// (camelCase of the API name). Everything is optional; the translator omits
// absent values. See buildUsajobsParams in ./index.ts.
export interface UsajobsFilters {
  keyword?: string;
  positionTitle?: string;
  locationName?: string[]; // semicolon-delimited on the wire
  radius?: number; // paired with locationName; the docs do not state units
  organization?: string[]; // agency sub-element codes, semicolon-delimited
  jobCategoryCode?: string[]; // 4-digit occupational series, semicolon-delimited
  remunerationMinimumAmount?: number;
  remunerationMaximumAmount?: number;
  payGradeLow?: string; // "01".."15"
  payGradeHigh?: string;
  hiringPath?: UsajobsHiringPath[];
  whoMayApply?: UsajobsWhoMayApply;
  remoteIndicator?: boolean; // true: remote only, false: exclude remote
  positionScheduleTypeCode?: number[];
  positionOfferingTypeCode?: string[]; // "work type" codes (Code List API)
  securityClearanceRequired?: number[];
  datePosted?: number; // posted within this many days (0-60)
  sortField?: UsajobsSortField;
  sortDirection?: UsajobsSortDirection;
  fields?: UsajobsFields;
}

// ---------------------------------------------------------------------------
// Response shape (only the parts we read; every leaf is optional because the
// mapper must tolerate partial / malformed announcements).
// ---------------------------------------------------------------------------

export interface UsajobsRemuneration {
  MinimumRange?: string | number | null;
  MaximumRange?: string | number | null;
  RateIntervalCode?: string | null;
  Description?: string | null;
}

export interface UsajobsNamedCode {
  Name?: string | null;
  Code?: string | null;
}

export interface UsajobsDetails {
  JobSummary?: string | null;
  MajorDuties?: string | string[] | null;
  Requirements?: string | null;
  HiringPath?: string[] | string | null;
  WhoMayApply?: UsajobsNamedCode | null;
  LowGrade?: string | null;
  HighGrade?: string | null;
  SecurityClearance?: string | null;
  RemoteIndicator?: boolean | string | null;
  TeleworkEligible?: boolean | string | null;
  SubAgencyName?: string | null;
}

export interface UsajobsDescriptor {
  PositionID?: string | null;
  PositionTitle?: string | null;
  PositionURI?: string | null;
  ApplyURI?: string[] | string | null;
  PositionLocationDisplay?: string | null;
  PositionLocation?: { LocationName?: string | null }[] | null;
  OrganizationName?: string | null;
  DepartmentName?: string | null;
  JobCategory?: UsajobsNamedCode[] | null;
  JobGrade?: UsajobsNamedCode[] | null;
  PositionSchedule?: UsajobsNamedCode[] | null;
  PositionOfferingType?: UsajobsNamedCode[] | null;
  QualificationSummary?: string | null;
  PositionRemuneration?: UsajobsRemuneration[] | null;
  PublicationStartDate?: string | null;
  ApplicationCloseDate?: string | null;
  UserArea?: { Details?: UsajobsDetails | null } | null;
}

export interface UsajobsSearchItem {
  MatchedObjectId?: string | number | null;
  MatchedObjectDescriptor?: UsajobsDescriptor | null;
}

export interface UsajobsSearchResponse {
  SearchResult?: {
    SearchResultCount?: number;
    SearchResultCountAll?: number;
    SearchResultItems?: UsajobsSearchItem[];
    UserArea?: { NumberOfPages?: number | string } | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Failure classification (internal; mapped to ScraperError / board reasons at
// the provider boundary).
// ---------------------------------------------------------------------------

export type UsajobsFailureKind =
  | "not_configured" // no/invalid key or registration email
  | "auth" // 401 / 403 — credentials rejected, never retried
  | "invalid_request" // 400 — the query is bad, never retried
  | "rate_limited" // 429
  | "server" // 5xx after bounded retries
  | "network" // transport error after bounded retries
  | "timeout" // overall deadline hit
  | "parse"; // malformed JSON / unexpected shape

export interface UsajobsFailure {
  kind: UsajobsFailureKind;
  message: string; // credential-free
  status?: number;
  retryAfterSeconds?: number;
}

export interface UsajobsFetchResult {
  jobs: JobDetails[];
  // Set when the fetch stopped early. With jobs.length > 0 this is a PARTIAL
  // result and must never be reported as a clean, complete fetch.
  failure?: UsajobsFailure;
  pagesFetched: number;
  skipped: number; // items dropped as unmappable or filtered client-side
  totalAvailable?: number; // SearchResultCountAll, when reported
  // True when a ceiling (pages/results) stopped us with more pages remaining.
  truncated: boolean;
}

export interface UsajobsCredentials {
  apiKey: string;
  userAgentEmail: string;
}

// Injectable seams so tests need neither real time nor real randomness.
export interface UsajobsFetchOptions {
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  maxAttempts?: number;
  signal?: AbortSignal; // external (user cancel); aborts with an AbortError
  now?: () => number; // clock for the client-side closed-announcement filter
}
