import type {
  UsajobsSortDirection,
  UsajobsSortField,
  UsajobsWhoMayApply,
} from "@/lib/scraper/usajobs/types";

// Display labels for the USAJOBS option lists. The codes themselves live in
// lib/scraper/usajobs/types.ts (shared with the schema); keying these records
// by those unions makes a newly added code a compile error here.

// Lives with the codes (the job-description mapper uses it too).
export { HIRING_PATH_LABELS } from "@/lib/scraper/usajobs/types";

export const WHO_MAY_APPLY_LABELS: Record<UsajobsWhoMayApply, string> = {
  public: "Public",
  status: "Status (federal employees)",
  all: "All",
};

export const SCHEDULE_LABELS: Record<number, string> = {
  1: "Full-time",
  2: "Part-time",
  3: "Shift work",
  4: "Intermittent",
  5: "Job sharing",
  6: "Multiple schedules",
};

export const CLEARANCE_LABELS: Record<number, string> = {
  0: "Not required",
  1: "Confidential",
  2: "Secret",
  3: "Top Secret",
  4: "SCI",
  5: "Q",
  7: "L",
  8: "Other",
};

export const SORT_FIELD_LABELS: Record<UsajobsSortField, string> = {
  opendate: "Open date",
  closedate: "Close date",
  organizationname: "Organization name",
  jobtitle: "Job title",
  positiontitle: "Position title",
  openingdate: "Opening date",
  closingdate: "Closing date",
  honame: "Hiring office name",
  salarymin: "Minimum salary",
  location: "Location",
  department: "Department",
  title: "Title",
  agency: "Agency",
  salary: "Salary",
};

export const SORT_DIRECTION_LABELS: Record<UsajobsSortDirection, string> = {
  asc: "Ascending",
  desc: "Descending",
};

// GS pay grades 01-15, as the API expects them.
export const PAY_GRADES = Array.from({ length: 15 }, (_, i) =>
  String(i + 1).padStart(2, "0"),
);

export const USAJOBS_REGISTRATION_URL =
  "https://developer.usajobs.gov/apirequest/";
