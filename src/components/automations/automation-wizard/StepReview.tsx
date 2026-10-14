"use client";

import { APP_CONSTANTS } from "@/lib/constants";
import type { CreateAutomationInput } from "@/models/automation.schema";
import type { AtsConfigValue } from "../AtsSearchStep";
import { boardName, type UsajobsConfigValue } from "../ats-search-step/types";
import { summarizeUsajobsFilters } from "../ats-search-step/usajobsConfig";
import type { WizardResume } from "./wizardConfig";

export function StepReview({
  formValues,
  atsConfig,
  usajobsConfig,
  selectedResume,
}: {
  formValues: CreateAutomationInput;
  atsConfig: AtsConfigValue;
  // Present only for the query-based USAJOBS board, which has no companies.
  usajobsConfig?: UsajobsConfigValue;
  selectedResume?: WizardResume;
}) {
  const ranking = usajobsConfig ?? atsConfig;
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Name</span>
        <span className="font-medium">{formValues.name || "-"}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Job Board</span>
        <span className="font-medium capitalize">
          {boardName(formValues.jobBoard) || "-"}
        </span>
      </div>
      {usajobsConfig ? (
        summarizeUsajobsFilters(usajobsConfig).map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-medium text-right">{row.value}</span>
          </div>
        ))
      ) : (
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Companies</span>
          <span className="font-medium text-right">
            {atsConfig.companies?.length
              ? atsConfig.companies.map((c) => c.name).join(", ")
              : "-"}
          </span>
        </div>
      )}
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">
          {usajobsConfig ? "Position titles" : "Target titles"}
        </span>
        <span className="font-medium text-right">
          {ranking.targetTitles?.length
            ? ranking.targetTitles.join(", ")
            : "Any"}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Locations</span>
        <span className="font-medium text-right">
          {ranking.locations?.length
            ? `${ranking.locations.join(", ")}${
                ranking.strictLocation ? " (strict)" : ""
              }`
            : "Any location"}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Jobs analyzed per run</span>
        <span className="font-medium text-right">
          {ranking.topK ?? APP_CONSTANTS.MAX_JOBS_PER_RUN}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Save additional listings</span>
        <span className="font-medium text-right">
          {ranking.saveUnanalyzed !== false ? "Yes" : "No"}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Resume</span>
        <span className="font-medium">
          {selectedResume?.title || "Not selected"}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Match Threshold</span>
        <span className="font-medium">{formValues.matchThreshold ?? 80}%</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Schedule</span>
        <span className="font-medium">
          Daily at{" "}
          {(formValues.scheduleHour ?? 8).toString().padStart(2, "0")}:00
        </span>
      </div>
    </div>
  );
}
