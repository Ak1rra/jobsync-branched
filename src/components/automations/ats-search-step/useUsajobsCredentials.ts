"use client";

import { useEffect, useState } from "react";
import { getUserApiKeys } from "@/actions/apiKey.actions";

// Whether the user has saved both USAJOBS credentials in Settings. The server
// environment variables (USAJOBS_API_KEY / USAJOBS_USER_AGENT_EMAIL) are not
// visible to the client, so "missing" means "not saved per-user"; the hint
// copy accounts for that. `null` while loading or if the lookup failed, so the
// hint never flashes or appears on an error.
export function useUsajobsCredentialsMissing(enabled: boolean): boolean | null {
  const [missing, setMissing] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getUserApiKeys()
      .then((result) => {
        if (cancelled || !result.success || !result.data) return;
        const saved = new Set(result.data.map((k) => k.provider));
        setMissing(!(saved.has("usajobs") && saved.has("usajobs_email")));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return missing;
}
