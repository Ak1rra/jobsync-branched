import { z } from "zod";
import { APP_CONSTANTS } from "@/lib/constants";
// Deep-import (NOT the barrel) — utils.ts is pure; the barrel pulls scraper
// network code into the client bundle via this file's client consumers.
import { ATS_TOKEN_REGEX } from "@/lib/scraper/utils";
// Pure option lists (no runtime imports) — safe for the client bundle.
import {
  USAJOBS_CLEARANCE_CODES,
  USAJOBS_FIELDS,
  USAJOBS_HIRING_PATHS,
  USAJOBS_MAX_LOCATIONS,
  USAJOBS_MAX_TITLES,
  USAJOBS_SCHEDULE_CODES,
  USAJOBS_SORT_DIRECTIONS,
  USAJOBS_SORT_FIELDS,
  USAJOBS_WHO_MAY_APPLY,
} from "@/lib/scraper/usajobs/types";

export const JobBoardSchema = z.enum(["greenhouse", "lever", "ashby", "usajobs"]);

export const AutomationStatusSchema = z.enum(["active", "paused"]);

export const AutomationRunStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "completed_with_errors",
  "blocked",
  "rate_limited",
]);

export const DiscoveryStatusSchema = z.enum(["new", "accepted", "dismissed"]);

export const GreenhouseCompanySchema = z.object({
  name: z.string().min(1).max(200),
  token: z.string().min(1).max(80),
});

export const GreenhouseSourceConfigSchema = z.object({
  companies: z
    .array(GreenhouseCompanySchema)
    .max(APP_CONSTANTS.ATS_MAX_COMPANIES),
  targetTitles: z.array(z.string().min(1).max(100)).optional(),
  keywords: z.array(z.string().min(1).max(100)).optional(),
  locations: z.array(z.string().min(1).max(100)).optional(),
  strictLocation: z.boolean().optional(),
  topK: z.number().int().min(1).max(APP_CONSTANTS.ATS_LISTING_CAP).optional(),
  saveUnanalyzed: z.boolean().optional(),
});

// Override `token` with the allowlist regex so a directly-POSTed Lever config
// can't smuggle a malformed token past the save boundary.
export const LeverCompanySchema = GreenhouseCompanySchema.extend({
  token: z.string().regex(ATS_TOKEN_REGEX),
  host: z.enum(["default", "eu"]).optional(),
});

// Same fields/MAX/cap as Greenhouse, `companies` swapped to LeverCompanySchema.
export const LeverSourceConfigSchema = GreenhouseSourceConfigSchema.extend({
  companies: z
    .array(LeverCompanySchema)
    .max(APP_CONSTANTS.ATS_MAX_COMPANIES),
});

// Same token allowlist as Lever (rejects path/query injection at the save
// boundary); no `host` — Ashby is single-host.
export const AshbyCompanySchema = GreenhouseCompanySchema.extend({
  token: z.string().regex(ATS_TOKEN_REGEX),
});

export const AshbySourceConfigSchema = GreenhouseSourceConfigSchema.extend({
  companies: z
    .array(AshbyCompanySchema)
    .max(APP_CONSTANTS.ATS_MAX_COMPANIES),
});

// Values interpolated into the query string are allowlisted here so a
// directly-POSTed config cannot smuggle ';' / '&' separators past the save
// boundary. Enum/range checks mirror the documented API value lists.
const usajobsText = (max: number) => z.string().trim().min(1).max(max);
const usajobsList = <T extends z.ZodType>(item: T) => z.array(item).min(1).max(10);
const intOf = <T extends readonly number[]>(allowed: T) =>
  z
    .number()
    .int()
    .refine((n) => (allowed as readonly number[]).includes(n), "Unsupported code");
const PAY_GRADE = z.string().regex(/^(0[1-9]|1[0-5])$/, "Pay grade must be 01-15");

export const UsajobsSourceConfigSchema = z
  .object({
    // Shared with the other boards (client-side ranking pipeline). For
    // USAJOBS they are ALSO the server-side search: each title is one
    // PositionTitle search (hence the low cap) and the locations are sent
    // joined by ';' as LocationName (hence no ';' inside one).
    targetTitles: z
      .array(z.string().min(1).max(100))
      .max(USAJOBS_MAX_TITLES)
      .optional(),
    keywords: z.array(z.string().min(1).max(100)).optional(),
    locations: z
      .array(
        z
          .string()
          .min(1)
          .max(100)
          .refine((v) => !v.includes(";"), "No ';' allowed"),
      )
      .max(USAJOBS_MAX_LOCATIONS)
      .optional(),
    strictLocation: z.boolean().optional(),
    topK: z.number().int().min(1).max(APP_CONSTANTS.ATS_LISTING_CAP).optional(),
    saveUnanalyzed: z.boolean().optional(),
    // Server-side filters (documented GET /api/Search parameters).
    keyword: usajobsText(200).optional(),
    // The docs give no unit or ceiling; 500 is a conservative bound.
    radius: z.number().int().min(1).max(500).optional(),
    organization: usajobsList(z.string().regex(/^[A-Za-z0-9]{1,10}$/)).optional(),
    jobCategoryCode: usajobsList(z.string().regex(/^\d{4}$/)).optional(),
    remunerationMinimumAmount: z.number().int().min(0).max(1_000_000).optional(),
    remunerationMaximumAmount: z.number().int().min(0).max(1_000_000).optional(),
    payGradeLow: PAY_GRADE.optional(),
    payGradeHigh: PAY_GRADE.optional(),
    hiringPath: usajobsList(z.enum(USAJOBS_HIRING_PATHS)).optional(),
    whoMayApply: z.enum(USAJOBS_WHO_MAY_APPLY).optional(),
    remoteIndicator: z.boolean().optional(),
    positionScheduleTypeCode: usajobsList(intOf(USAJOBS_SCHEDULE_CODES)).optional(),
    positionOfferingTypeCode: usajobsList(
      z.string().regex(/^[A-Za-z0-9]{1,10}$/),
    ).optional(),
    securityClearanceRequired: usajobsList(
      intOf(USAJOBS_CLEARANCE_CODES),
    ).optional(),
    datePosted: z.number().int().min(0).max(60).optional(),
    sortField: z.enum(USAJOBS_SORT_FIELDS).optional(),
    sortDirection: z.enum(USAJOBS_SORT_DIRECTIONS).optional(),
    fields: z.enum(USAJOBS_FIELDS).optional(),
  })
  .superRefine((cfg, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    // A query with no narrowing criterion would pull an arbitrary slice of
    // every open federal job and truncate it at the fetch ceiling.
    if (
      !cfg.keyword &&
      !cfg.targetTitles?.length &&
      !cfg.locations?.length &&
      !cfg.organization?.length &&
      !cfg.jobCategoryCode?.length
    ) {
      issue(
        "keyword",
        "Add at least one search criterion (keyword, title, location, agency or series)",
      );
    }
    if (cfg.radius !== undefined && !cfg.locations?.length) {
      issue("radius", "Radius requires a location");
    }
    if (
      cfg.remunerationMinimumAmount !== undefined &&
      cfg.remunerationMaximumAmount !== undefined &&
      cfg.remunerationMinimumAmount > cfg.remunerationMaximumAmount
    ) {
      issue("remunerationMinimumAmount", "Minimum pay exceeds maximum pay");
    }
    if (cfg.payGradeLow && cfg.payGradeHigh && cfg.payGradeLow > cfg.payGradeHigh) {
      issue("payGradeLow", "Low pay grade exceeds high pay grade");
    }
  });

export const SourceConfigSchema = z.object({
  greenhouse: GreenhouseSourceConfigSchema.optional(),
  lever: LeverSourceConfigSchema.optional(),
  ashby: AshbySourceConfigSchema.optional(),
  usajobs: UsajobsSourceConfigSchema.optional(),
});

type SourceConfigData = z.infer<typeof SourceConfigSchema>;

// Watchlist boards need >= 1 company; USAJOBS (query-based) needs its config
// block, whose own refinement enforces a search criterion.
function addMissingSourceIssue(
  data: { jobBoard: z.infer<typeof JobBoardSchema>; sourceConfig?: SourceConfigData },
  ctx: z.RefinementCtx,
) {
  if (data.jobBoard === "usajobs") {
    if (!data.sourceConfig?.usajobs) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceConfig", "usajobs"],
        message: "Add at least one USAJOBS search criterion",
      });
    }
    return;
  }
  const companies = data.sourceConfig?.[data.jobBoard]?.companies ?? [];
  if (companies.length < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceConfig", data.jobBoard, "companies"],
      message: "Select at least one company",
    });
  }
}

export const CreateAutomationSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(100),
    jobBoard: JobBoardSchema,
    keywords: z.string().max(200).optional(),
    location: z.string().max(100).optional(),
    sourceConfig: SourceConfigSchema.optional(),
    resumeId: z.string().uuid("Invalid resume"),
    matchThreshold: z.number().min(0).max(100),
    scheduleHour: z.number().min(0).max(23),
  })
  .superRefine((data, ctx) => addMissingSourceIssue(data, ctx));

export const UpdateAutomationSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    jobBoard: JobBoardSchema.optional(),
    keywords: z.string().max(200).optional(),
    location: z.string().max(100).optional(),
    sourceConfig: SourceConfigSchema.optional(),
    resumeId: z.string().uuid("Invalid resume").optional(),
    matchThreshold: z.number().min(0).max(100).optional(),
    scheduleHour: z.number().min(0).max(23).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.jobBoard) return;
    addMissingSourceIssue({ ...data, jobBoard: data.jobBoard }, ctx);
  });

export type CreateAutomationInput = z.infer<typeof CreateAutomationSchema>;
export type UpdateAutomationInput = z.infer<typeof UpdateAutomationSchema>;
export type SourceConfigInput = z.infer<typeof SourceConfigSchema>;
export type GreenhouseSourceConfigInput = z.infer<
  typeof GreenhouseSourceConfigSchema
>;
