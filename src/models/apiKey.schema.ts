import { z } from "zod";
// Pure module (no runtime imports) - safe for the client bundle.
import {
  USAJOBS_EMAIL_REGEX,
  USAJOBS_KEY_REGEX,
} from "@/lib/scraper/usajobs/types";

export const apiKeySaveSchema = z
  .object({
    // "usajobs" is the Authorization-Key; "usajobs_email" is the registration
    // email USAJOBS requires as the User-Agent (stored like the Ollama URL:
    // a non-sensitive value in the same ApiKey table, no schema change).
    provider: z.enum([
      "openai",
      "deepseek",
      "openrouter",
      "ollama",
      "gemini",
      "usajobs",
      "usajobs_email",
    ]),
    key: z.string().min(1, "API key is required"),
    label: z.string().optional(),
    sensitive: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    // Same checks the run applies, so a value that would later read as "not
    // configured" is rejected here instead. Surrounding whitespace is trimmed
    // at run time, so only the trimmed value is checked.
    const value = data.key.trim();
    if (data.provider === "usajobs" && !USAJOBS_KEY_REGEX.test(value)) {
      ctx.addIssue({
        code: "custom",
        path: ["key"],
        message:
          "The USAJOBS API key must be plain ASCII characters with no spaces",
      });
    }
    if (
      data.provider === "usajobs_email" &&
      (!z.string().email().safeParse(value).success ||
        !USAJOBS_EMAIL_REGEX.test(value))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["key"],
        message: "Enter the email address you registered with USAJOBS",
      });
    }
  });

export type ApiKeySaveInput = z.infer<typeof apiKeySaveSchema>;
