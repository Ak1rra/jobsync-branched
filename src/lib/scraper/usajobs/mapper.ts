import type { JobDetails } from "../types";
import { decodeHtml, flattenHtml } from "../html";
import type {
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

// Compact factual header; absent fields are omitted, never invented.
function buildDescription(d: UsajobsDescriptor, controlNumber?: string): string {
  const details = d.UserArea?.Details;
  const hiringPath = Array.isArray(details?.HiringPath)
    ? details.HiringPath.map((h) => str(h)).filter(Boolean).join(", ")
    : str(details?.HiringPath);
  const telework = flag(details?.TeleworkEligible);
  const closes = parseUsajobsDate(d.ApplicationCloseDate);

  const facts: [string, string | undefined][] = [
    ["Announcement number", str(d.PositionID)],
    ["Control number", controlNumber],
    ["Agency", str(d.OrganizationName)],
    ["Department", str(d.DepartmentName)],
    ["Sub-agency", str(details?.SubAgencyName)],
    ["Grade", gradeRange(d)],
    ["Series", series(d)],
    ["Schedule", names(d.PositionSchedule).join(", ") || undefined],
    ["Appointment type", names(d.PositionOfferingType).join(", ") || undefined],
    ["Hiring path", hiringPath || undefined],
    ["Who may apply", str(details?.WhoMayApply?.Name)],
    ["Security clearance", str(details?.SecurityClearance)],
    [
      "Telework eligible",
      telework === undefined ? undefined : telework ? "Yes" : "No",
    ],
    ["Closes", closes?.slice(0, 10)],
    ["Apply", applyUri(d)],
  ];
  const header = facts
    .filter((f): f is [string, string] => !!f[1])
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");

  const sections: [string, string][] = [
    ["Summary", cleanText(details?.JobSummary)],
    ["Major duties", cleanText(details?.MajorDuties)],
    ["Qualifications", cleanText(d.QualificationSummary)],
  ];
  const body = sections
    .filter(([, text]) => text)
    .map(([label, text]) => `${label}\n${text}`);

  return [header, ...body].filter(Boolean).join("\n\n");
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
