"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { UsajobsSearchFields } from "./ats-search-step/UsajobsSearchFields";
import { TargetingFields } from "./ats-search-step/TargetingFields";
import { RunOptionsFields } from "./ats-search-step/RunOptionsFields";
import { useUsajobsCredentialsMissing } from "./ats-search-step/useUsajobsCredentials";
import {
  cleanUsajobsConfig,
  usajobsIssues,
} from "./ats-search-step/usajobsConfig";
import { USAJOBS_REGISTRATION_URL } from "./ats-search-step/usajobsOptions";
import type { UsajobsConfigValue } from "./ats-search-step/types";

interface UsajobsSearchStepProps {
  value: UsajobsConfigValue;
  onChange: (next: UsajobsConfigValue) => void;
}

// Search step for the query-based USAJOBS board: no company picker, a search
// form instead, plus the same ranking/run-option fields as the other boards.
export function UsajobsSearchStep({ value, onChange }: UsajobsSearchStepProps) {
  const credentialsMissing = useUsajobsCredentialsMissing(true);
  const issues = usajobsIssues(value);

  // Every edit is normalized so cleared filters are absent, not "" / [].
  const update = (next: UsajobsConfigValue) =>
    onChange(cleanUsajobsConfig(next));

  return (
    <div className="space-y-5">
      {credentialsMissing && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
        >
          <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            USAJOBS API key and registration email are not saved. Add them
            under{" "}
            <Link
              href="/dashboard/settings#api-keys"
              className="underline hover:text-foreground"
            >
              Settings → API Keys
            </Link>{" "}
            (get a key at{" "}
            <a
              href={USAJOBS_REGISTRATION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              developer.usajobs.gov
            </a>
            ), or ignore this if your server provides them as environment
            variables. Runs fail until credentials are configured.
          </span>
        </div>
      )}

      <UsajobsSearchFields value={value} onChange={update} />

      {issues.length > 0 && (
        <ul
          role="alert"
          className="list-disc space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 pl-7 text-sm text-amber-700 dark:text-amber-400"
        >
          {issues.map((issue) => (
            <li key={issue.message}>{issue.message}</li>
          ))}
        </ul>
      )}

      <TargetingFields value={value} onChange={update} />
      <RunOptionsFields value={value} onChange={update} />
    </div>
  );
}
