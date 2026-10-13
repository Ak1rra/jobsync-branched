import { UsajobsSourceConfigSchema } from "@/models/automation.schema";
import type { UsajobsSourceConfig } from "@/models/automation.model";
import {
  CLEARANCE_LABELS,
  HIRING_PATH_LABELS,
  SCHEDULE_LABELS,
  SORT_DIRECTION_LABELS,
  SORT_FIELD_LABELS,
  WHO_MAY_APPLY_LABELS,
} from "./usajobsOptions";

// Ranking fields shared with the other boards. Kept as-is (including empty
// arrays) so the stored shape matches what the watchlist boards save.
const RANKING_KEYS = new Set<string>([
  "targetTitles",
  "keywords",
  "locations",
  "strictLocation",
  "topK",
  "saveUnanalyzed",
]);

// Drops cleared filters so a blanked text box or an emptied list is absent
// rather than "" / [] (which the schema rejects). A radius without a location
// is dropped too: the UI disables it then, and a stale value would otherwise
// fail validation with no visible field.
export function cleanUsajobsConfig(cfg: UsajobsSourceConfig): UsajobsSourceConfig {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cfg)) {
    if (RANKING_KEYS.has(key)) {
      out[key] = value;
      continue;
    }
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "number" && Number.isNaN(value)) continue;
    out[key] = value;
  }
  if (!Array.isArray(out.locationName)) delete out.radius;
  return out as UsajobsSourceConfig;
}

const FIELD_LABELS: Record<string, string> = {
  keyword: "Search criteria",
  positionTitle: "Position title",
  locationName: "Search locations",
  radius: "Radius",
  organization: "Agency codes",
  jobCategoryCode: "Occupational series",
  remunerationMinimumAmount: "Minimum salary",
  remunerationMaximumAmount: "Maximum salary",
  payGradeLow: "Pay grade (low)",
  payGradeHigh: "Pay grade (high)",
  hiringPath: "Hiring path",
  positionOfferingTypeCode: "Appointment type",
  datePosted: "Date posted",
  topK: "Jobs analyzed per run",
};

export interface UsajobsIssue {
  field: string;
  message: string;
}

// Validation uses the same schema the save boundary enforces (including the
// "at least one search criterion" rule), so the wizard cannot disagree with
// the server about what is savable.
export function usajobsIssues(cfg: UsajobsSourceConfig): UsajobsIssue[] {
  const result = UsajobsSourceConfigSchema.safeParse(cfg);
  if (result.success) return [];
  const seen = new Set<string>();
  const issues: UsajobsIssue[] = [];
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "");
    const field = FIELD_LABELS[key] ?? key;
    const id = `${field}:${issue.message}`;
    if (seen.has(id)) continue;
    seen.add(id);
    // The criterion message already names the whole rule; others get a prefix.
    issues.push({
      field,
      message: key === "keyword" ? issue.message : `${field}: ${issue.message}`,
    });
  }
  return issues;
}

export function isUsajobsConfigValid(cfg: UsajobsSourceConfig): boolean {
  return UsajobsSourceConfigSchema.safeParse(cfg).success;
}

// True when any server-side filter beyond the main query block is set; the
// form uses it to open the secondary filter group on edit.
const PRIMARY_KEYS = new Set<string>([
  ...RANKING_KEYS,
  "keyword",
  "positionTitle",
  "locationName",
  "radius",
  "organization",
  "jobCategoryCode",
]);
export function hasSecondaryUsajobsFilters(cfg: UsajobsSourceConfig): boolean {
  return Object.entries(cfg).some(
    ([key, value]) =>
      !PRIMARY_KEYS.has(key) &&
      value !== undefined &&
      !(Array.isArray(value) && value.length === 0),
  );
}

export interface UsajobsSummaryRow {
  label: string;
  value: string;
}

const list = (values?: (string | number)[]) =>
  values && values.length > 0 ? values.map(String).join(", ") : undefined;

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

// Read-only description of the server-side filters, for the review step, the
// automation list and the detail page. Only filters that are set appear.
// Tolerates a partial / hand-edited stored config.
export function summarizeUsajobsFilters(
  cfg: Partial<UsajobsSourceConfig>,
): UsajobsSummaryRow[] {
  const rows: UsajobsSummaryRow[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value) rows.push({ label, value });
  };

  add("Keyword", cfg.keyword);
  add("Position title", cfg.positionTitle);
  add(
    "Search locations",
    cfg.locationName?.length
      ? `${list(cfg.locationName)}${cfg.radius ? ` (within ${cfg.radius})` : ""}`
      : undefined,
  );
  add("Agency codes", list(cfg.organization));
  add("Occupational series", list(cfg.jobCategoryCode));

  const min = cfg.remunerationMinimumAmount;
  const max = cfg.remunerationMaximumAmount;
  add(
    "Salary",
    min !== undefined && max !== undefined
      ? `${money(min)} - ${money(max)}`
      : min !== undefined
        ? `From ${money(min)}`
        : max !== undefined
          ? `Up to ${money(max)}`
          : undefined,
  );
  add(
    "Pay grade",
    cfg.payGradeLow && cfg.payGradeHigh
      ? `${cfg.payGradeLow} - ${cfg.payGradeHigh}`
      : cfg.payGradeLow
        ? `${cfg.payGradeLow} and up`
        : cfg.payGradeHigh
          ? `Up to ${cfg.payGradeHigh}`
          : undefined,
  );
  add(
    "Hiring path",
    list(cfg.hiringPath?.map((h) => HIRING_PATH_LABELS[h] ?? h)),
  );
  add(
    "Who may apply",
    cfg.whoMayApply ? WHO_MAY_APPLY_LABELS[cfg.whoMayApply] : undefined,
  );
  add(
    "Remote",
    cfg.remoteIndicator === undefined
      ? undefined
      : cfg.remoteIndicator
        ? "Remote only"
        : "Exclude remote",
  );
  add(
    "Schedule",
    list(cfg.positionScheduleTypeCode?.map((c) => SCHEDULE_LABELS[c] ?? c)),
  );
  add("Appointment type", list(cfg.positionOfferingTypeCode));
  add(
    "Security clearance",
    list(cfg.securityClearanceRequired?.map((c) => CLEARANCE_LABELS[c] ?? c)),
  );
  add(
    "Posted within",
    cfg.datePosted !== undefined ? `${cfg.datePosted} days` : undefined,
  );
  add(
    "Sort",
    cfg.sortField
      ? `${SORT_FIELD_LABELS[cfg.sortField] ?? cfg.sortField}${
          cfg.sortDirection
            ? ` (${SORT_DIRECTION_LABELS[cfg.sortDirection] ?? cfg.sortDirection})`
            : ""
        }`
      : undefined,
  );
  return rows;
}
