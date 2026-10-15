import { format } from "date-fns";
import { HIRING_PATH_LABELS } from "./types";
import type { JobDetails } from "../types";
import { decodeHtml, flattenHtml } from "../html";
import type {
  UsajobsHiringPath,
  UsajobsDescriptor,
  UsajobsNamedCode,
  UsajobsRemuneration,
  UsajobsSearchItem,
} from "./types";

// Every helper below tolerates null / wrong-typed values: the feed is
// third-party and a single odd announcement must never fail a whole run.

function str(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function names(value: unknown): string[] {
  return list<UsajobsNamedCode>(value)
    .map((v) => str(v?.Name))
    .filter((v): v is string => !!v);
}

// USAJOBS text fields are mostly plain text with \r\n, occasionally HTML.
// Keep paragraph/line breaks (flattenHtml alone collapses all whitespace).
function cleanText(raw: unknown): string {
  const text = Array.isArray(raw)
    ? raw.map((r) => (typeof r === "string" ? r : "")).join("\n")
    : typeof raw === "string"
      ? raw
      : "";
  if (!text.trim()) return "";
  return text
    .replace(/<\s*(?:br|\/p|\/li|\/div|\/h\d)\b[^>]*>/gi, "\n")
    .split(/\r?\n/)
    .map((line) => flattenHtml(line))
    .filter(Boolean)
    .join("\n");
}

function flag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const s = str(value)?.toLowerCase();
  if (s === "true" || s === "yes" || s === "y") return true;
  if (s === "false" || s === "no" || s === "n") return false;
  return undefined;
}

// The API serializes dates like "2026-10-01T00:00:00.0000" (no zone). Treat a
// zone-less value as UTC so the result does not depend on the server's TZ.
export function parseUsajobsDate(raw: unknown): string | undefined {
  const s = str(raw);
  if (!s) return undefined;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const isoLike = /^\d{4}-\d{2}-\d{2}T/.test(s);
  const date = new Date(isoLike && !hasZone ? `${s}Z` : s);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

const WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
// $86,962 for whole-dollar amounts, $21.50 when cents matter (hourly pay).
const MONEY = {
  format: (n: number) => (Number.isInteger(n) ? WHOLE : CENTS).format(n),
};

function money(raw: unknown): number | undefined {
  const n =
    typeof raw === "number" ? raw : Number(str(raw)?.replace(/[$,]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// Known interval codes, used only when the API supplies no Description.
const INTERVAL_FALLBACK: Record<string, string> = {
  PA: "per year",
  PH: "per hour",
};

function intervalLabel(r: UsajobsRemuneration): string | undefined {
  const description = str(r.Description);
  if (description) return description.toLowerCase();
  const code = str(r.RateIntervalCode)?.toUpperCase();
  return code ? (INTERVAL_FALLBACK[code] ?? code) : undefined;
}

export function formatUsajobsSalary(remuneration: unknown): string | undefined {
  const parts: string[] = [];
  for (const r of list<UsajobsRemuneration>(remuneration)) {
    if (!r || typeof r !== "object") continue;
    const min = money(r.MinimumRange);
    const max = money(r.MaximumRange);
    if (min === undefined && max === undefined) continue;
    const range =
      min !== undefined && max !== undefined && min !== max
        ? `${MONEY.format(min)} - ${MONEY.format(max)}`
        : MONEY.format((min ?? max) as number);
    const interval = intervalLabel(r);
    parts.push(interval ? `${range} ${interval}` : range);
  }
  return parts.length ? parts.join("; ") : undefined;
}

// Annual range in dollars for the client-side salary filter. Only rows quoted
// per year are comparable; anything else yields undefined (kept, not dropped).
export function annualSalaryRange(
  remuneration: unknown,
): { min: number; max: number } | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (const r of list<UsajobsRemuneration>(remuneration)) {
    if (str(r?.RateIntervalCode)?.toUpperCase() !== "PA") continue;
    const lo = money(r.MinimumRange);
    const hi = money(r.MaximumRange);
    if (lo === undefined && hi === undefined) continue;
    min = Math.min(min, lo ?? (hi as number));
    max = Math.max(max, hi ?? (lo as number));
  }
  return Number.isFinite(min) && Number.isFinite(max)
    ? { min, max }
    : undefined;
}

// Feeds normalizeJobType (Full-time / Part-time / Temporary ...). A temporary
// appointment is the one case where the offering type beats the schedule.
function employmentType(d: UsajobsDescriptor): string | undefined {
  if (names(d.PositionOfferingType).some((n) => /temporary/i.test(n))) {
    return "Temporary";
  }
  return names(d.PositionSchedule)[0];
}

function gradeRange(d: UsajobsDescriptor): string | undefined {
  const details = d.UserArea?.Details;
  const plan = str(list<UsajobsNamedCode>(d.JobGrade)[0]?.Code);
  const low = str(details?.LowGrade);
  const high = str(details?.HighGrade);
  const range = low && high && low !== high ? `${low}-${high}` : (low ?? high);
  if (!range) return plan;
  return plan ? `${plan} ${range}` : range;
}

function series(d: UsajobsDescriptor): string | undefined {
  const out = list<UsajobsNamedCode>(d.JobCategory)
    .map((c) => [str(c?.Code), str(c?.Name)].filter(Boolean).join(" "))
    .filter(Boolean);
  return out.length ? out.join(", ") : undefined;
}

function locationOf(d: UsajobsDescriptor): string {
  const display = str(d.PositionLocationDisplay);
  if (display) return display;
  const seen = new Set<string>();
  for (const loc of list<{ LocationName?: string | null }>(d.PositionLocation)) {
    const name = str(loc?.LocationName);
    if (name) seen.add(name);
  }
  return [...seen].join("; ");
}

function applyUri(d: UsajobsDescriptor): string | undefined {
  return Array.isArray(d.ApplyURI) ? str(d.ApplyURI[0]) : str(d.ApplyURI);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Single-line display value: collapse every run of whitespace.
function inline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Display form of a URL: the URL parser drops a default port (https :443,
// http :80). Non-http(s) or unparseable values are omitted rather than shown.
// Display only; the stored job url (the dedupe key) is never passed through it.
function displayUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:"
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}

// "2099-12-31" -> "Dec 31, 2099" (date-fns "PP", the app's date convention).
// Built from the calendar parts so the result does not depend on the server TZ.
function displayDate(iso: string | undefined): string | undefined {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? format(new Date(+m[1], +m[2] - 1, +m[3]), "PP") : undefined;
}

function hiringPathLabel(code: string): string {
  return Object.prototype.hasOwnProperty.call(HIRING_PATH_LABELS, code)
    ? HIRING_PATH_LABELS[code as UsajobsHiringPath]
    : code;
}

const same = (a?: string, b?: string) =>
  !!a && !!b && inline(a).toLowerCase() === inline(b).toLowerCase();

// Non-empty cleaned lines of a text field, plus whether the source was an
// array (array elements are real item boundaries; a string's lines are not).
function textLines(raw: unknown): { lines: string[]; isList: boolean } {
  const text = cleanText(raw);
  return {
    lines: text ? text.split("\n") : [],
    isList: Array.isArray(raw) && raw.length > 1,
  };
}

function section(heading: string, raw: unknown): string {
  const { lines, isList } = textLines(raw);
  if (!lines.length) return "";
  const body = isList
    ? `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
    : lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("");
  return `<h3>${escapeHtml(heading)}</h3>${body}`;
}

// Stored as HTML like the Greenhouse/Ashby descriptions: the job details view
// renders it through TipTap (StarterKit), which keeps headings, lists, bold and
// paragraphs but not line breaks inside plain text. All source text is escaped.
// Absent fields are omitted, never invented.
function buildDescription(d: UsajobsDescriptor, controlNumber?: string): string {
  const details = d.UserArea?.Details;
  const agency = str(d.OrganizationName);
  const department = str(d.DepartmentName);
  const subAgency = str(details?.SubAgencyName);
  const hiringCodes = [
    ...new Set(
      (Array.isArray(details?.HiringPath)
        ? details.HiringPath
        : [details?.HiringPath]
      )
        .map((h) => str(h))
        .filter((h): h is string => !!h),
    ),
  ];
  const telework = flag(details?.TeleworkEligible);
  const closes = displayDate(parseUsajobsDate(d.ApplicationCloseDate));
  const applyHref = displayUrl(applyUri(d));

  const facts: [string, string | undefined][] = [
    ["Announcement number", str(d.PositionID)],
    ["Control number", controlNumber],
    ["Agency", agency],
    ["Department", same(department, agency) ? undefined : department],
    [
      "Sub-agency",
      same(subAgency, agency) || same(subAgency, department)
        ? undefined
        : subAgency,
    ],
    ["Grade", gradeRange(d)],
    ["Series", series(d)],
    ["Schedule", names(d.PositionSchedule).join(", ") || undefined],
    ["Appointment type", names(d.PositionOfferingType).join(", ") || undefined],
    ["Hiring path", hiringCodes.map(hiringPathLabel).join(", ") || undefined],
    ["Who may apply", str(details?.WhoMayApply?.Name)],
    ["Security clearance", str(details?.SecurityClearance)],
    [
      "Telework eligible",
      telework === undefined ? undefined : telework ? "Yes" : "No",
    ],
    ["Closes", closes],
  ];
  const items = facts
    .map(([label, value]) => [label, value ? inline(value) : ""] as const)
    .filter(([, value]) => value)
    .map(
      ([label, value]) =>
        `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`,
    );
  if (applyHref) {
    const safe = escapeHtml(applyHref);
    items.push(`<li><strong>Apply:</strong> <a href="${safe}">${safe}</a></li>`);
  }

  return [
    items.length ? `<ul>${items.join("")}</ul>` : "",
    section("Summary", details?.JobSummary),
    section("Major duties", details?.MajorDuties),
    section("Qualifications", d.QualificationSummary),
  ]
    .filter(Boolean)
    .join("");
}

// Returns null for an item that cannot be saved meaningfully (no title, no
// agency, or no link — the URL is the dedupe identity). The caller skips it.
export function mapUsajobsItem(item: UsajobsSearchItem): JobDetails | null {
  const d = item?.MatchedObjectDescriptor;
  if (!d || typeof d !== "object") return null;

  const title = str(d.PositionTitle);
  const company = str(d.OrganizationName) ?? str(d.DepartmentName);
  // PositionURI is the stable announcement URL (.../job/<control number>); the
  // apply link is a fallback only.
  const url = str(d.PositionURI) ?? applyUri(d);
  if (!title || !company || !url) return null;

  return {
    title: decodeHtml(title),
    company: decodeHtml(company),
    location: locationOf(d),
    description: buildDescription(d, str(item.MatchedObjectId)),
    url,
    postedDate: parseUsajobsDate(d.PublicationStartDate),
    salary: formatUsajobsSalary(d.PositionRemuneration),
    employmentType: employmentType(d),
    isRemote: flag(d.UserArea?.Details?.RemoteIndicator),
    dueDate: parseUsajobsDate(d.ApplicationCloseDate),
  };
}
