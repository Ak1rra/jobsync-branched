export type ScheduleFrequency = "daily" | "weekly";

// Weekday numbers follow Date#getDay: 0 is Sunday. Listed Monday first for the
// picker.
export const WEEKDAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

export interface ScheduleFields {
  scheduleHour: number;
  scheduleFrequency?: string | null;
  scheduleDayOfWeek?: number | null;
}

// Local time (the process TZ), the same clock the cron scheduler runs on. Each
// step moves the calendar date with setDate and then pins the hour, so a DST
// change between now and the run keeps the wall-clock hour.
export function calculateNextRunAt(
  scheduleHour: number,
  scheduleFrequency: string | null = "daily",
  scheduleDayOfWeek: number | null = null,
  now: Date = new Date(),
): Date {
  const next = new Date(now);

  if (scheduleFrequency === "weekly" && scheduleDayOfWeek !== null) {
    next.setDate(next.getDate() + ((scheduleDayOfWeek - next.getDay() + 7) % 7));
    next.setHours(scheduleHour, 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 7);
      next.setHours(scheduleHour, 0, 0, 0);
    }
    return next;
  }

  next.setHours(scheduleHour, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
    next.setHours(scheduleHour, 0, 0, 0);
  }
  return next;
}

export function calculateNextRunAtFor(
  fields: ScheduleFields,
  now: Date = new Date(),
): Date {
  return calculateNextRunAt(
    fields.scheduleHour,
    fields.scheduleFrequency ?? "daily",
    fields.scheduleDayOfWeek ?? null,
    now,
  );
}

// "Daily at 09:00" / "Weekly on Monday at 09:00"
export function formatSchedule(fields: ScheduleFields): string {
  const time = `${fields.scheduleHour.toString().padStart(2, "0")}:00`;
  const day = WEEKDAYS.find((d) => d.value === fields.scheduleDayOfWeek);
  if (fields.scheduleFrequency === "weekly" && day) {
    return `Weekly on ${day.label} at ${time}`;
  }
  return `Daily at ${time}`;
}

export function isAutomationDue(nextRunAt: Date | null): boolean {
  if (!nextRunAt) return false;
  return new Date() >= nextRunAt;
}
