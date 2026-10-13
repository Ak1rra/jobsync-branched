import "server-only";

import db from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { PROVIDER_REGISTRY } from "@/lib/ai/provider-registry";

// Credentials outside the AI provider registry that still resolve per-user
// first, then from the environment.
const EXTRA_ENV_VARS: Record<string, string> = {
  usajobs: "USAJOBS_API_KEY",
  usajobs_email: "USAJOBS_USER_AGENT_EMAIL",
};

// envFallback: false returns only a value the user saved, so callers that need
// to treat several credentials as a pair can tell "user's own" from "server's".
export async function resolveApiKey(
  userId: string | undefined,
  provider: string,
  options?: { envFallback?: boolean },
): Promise<string | undefined> {
  if (userId) {
    try {
      const apiKey = await db.apiKey.findUnique({
        where: { userId_provider: { userId, provider } },
      });
      if (apiKey) {
        db.apiKey
          .update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() },
          })
          .catch(() => {});

        if (apiKey.iv === "") return apiKey.encryptedKey;
        return decrypt(apiKey.encryptedKey, apiKey.iv);
      }
    } catch {
      // Fall through to env var
    }
  }

  if (options?.envFallback === false) return undefined;

  const entry = PROVIDER_REGISTRY[provider];
  if (entry?.envVar) {
    const value = process.env[entry.envVar];
    if (value) return value;
  }

  const extraEnvVar = EXTRA_ENV_VARS[provider];
  if (extraEnvVar) {
    const value = process.env[extraEnvVar];
    if (value) return value;
  }

  if (entry?.defaultCredential) return entry.defaultCredential;

  return undefined;
}
