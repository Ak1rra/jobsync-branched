import path from "path";
import { APP_CONSTANTS } from "@/lib/constants";
import { sniffFileType } from "@/lib/ai/import/extract-text";
import { calculateNextRunAtFor } from "@/lib/scraper/schedule";

const NON_TERMINAL_RUN_STATUSES = new Set(["running", "cancelling"]);

const IMPORT_MIME: Record<"pdf" | "docx", string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

// Basename of the entry only, with both separators handled — a zip written on
// Windows carries backslashes that posix path.basename would keep.
export function safeEntryName(entryName: string): string {
  const flattened = entryName.replace(/\\/g, "/");
  const base = path.posix.basename(flattened);
  if (!base || base === "." || base === "..") return "file";
  return base;
}

// The column is always rebuilt server-side. The path in the backup is read only
// to locate the zip entry: UPLOADS_DIR differs between dev and prod, and the
// resume download route reads whatever path it is handed. The extension comes
// from the sniffed bytes rather than the carried name, so a payload cannot pick
// what lands in the uploads directory — resume.pdf.exe becomes <id>-resume.pdf.
export function importedFilePath(
  newFileId: string,
  entryName: string,
  kind: "pdf" | "docx",
): string {
  const base = safeEntryName(entryName).replace(/\.[^.]+$/, "");
  return path.join(
    APP_CONSTANTS.UPLOADS_DIR,
    "files",
    "resumes",
    `${newFileId}-${base}.${kind}`,
  );
}

// The same gate the upload route applies, on the same helper: size, then magic
// bytes. Returns null for anything that is not really a resume, so the caller
// can drop the bytes and keep going instead of failing the whole import. The
// mimeType is what File.fileType is set to — never the value in the payload.
export function checkImportedFile(
  bytes: Buffer,
): { kind: "pdf" | "docx"; mimeType: string } | null {
  if (bytes.length === 0 || bytes.length > APP_CONSTANTS.MAX_RESUME_FILE_SIZE_BYTES) {
    return null;
  }
  const kind = sniffFileType(bytes);
  if (!kind) return null;
  return { kind, mimeType: IMPORT_MIME[kind] };
}

// A run restored as running or cancelling holds the single-active slot forever:
// runDueAutomations skips the automation and reapStaleRuns only reaps running.
export function normalizeAutomationRun<
  T extends { status: string; errorMessage: string | null; completedAt: Date | null },
>(row: T): T {
  if (!NON_TERMINAL_RUN_STATUSES.has(row.status)) return row;
  return {
    ...row,
    status: "failed",
    errorMessage: "interrupted",
    completedAt: new Date(),
  };
}

// Imported automations arrive with a nextRunAt in the past, so every one of
// them would fire on the next hourly tick. Recompute forward instead.
export function normalizeAutomation<
  T extends {
    status: string;
    scheduleHour: number;
    scheduleFrequency?: string;
    scheduleDayOfWeek?: number | null;
    nextRunAt: Date | null;
  },
>(row: T): T {
  // A weekly row needs a valid weekday and a daily row carries none. A backup
  // that breaks either is stored as daily so the label, the next run and a
  // later edit all agree.
  const day = row.scheduleDayOfWeek;
  const weekly =
    row.scheduleFrequency === "weekly" &&
    typeof day === "number" &&
    Number.isInteger(day) &&
    day >= 0 &&
    day <= 6;
  const schedule = {
    scheduleFrequency: weekly ? "weekly" : "daily",
    scheduleDayOfWeek: weekly ? day : null,
  };
  const normalized = { ...row, ...schedule };
  if (row.status !== "active") return { ...normalized, nextRunAt: null };
  return { ...normalized, nextRunAt: calculateNextRunAtFor(normalized) };
}
