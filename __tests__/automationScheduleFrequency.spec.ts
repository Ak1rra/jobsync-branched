import {
  calculateNextRunAt,
  calculateNextRunAtFor,
  formatSchedule,
} from "@/lib/scraper/schedule";
import {
  CreateAutomationSchema,
  UpdateAutomationSchema,
} from "@/models/automation.schema";

// Local-time constructors throughout: the schedule runs on the process clock,
// so these hold in whatever TZ the suite runs under.
// 2026-03-04 is a Wednesday (getDay() === 3).
const wed = (h: number, m = 0) => new Date(2026, 2, 4, h, m, 0, 0);

describe("calculateNextRunAt - daily", () => {
  it("runs later today when the hour has not passed", () => {
    const next = calculateNextRunAt(14, "daily", null, wed(9));
    expect(next).toEqual(wed(14));
  });

  it("runs tomorrow when the hour has passed", () => {
    const next = calculateNextRunAt(8, "daily", null, wed(9));
    expect(next).toEqual(new Date(2026, 2, 5, 8));
  });

  it("runs tomorrow when now is exactly the scheduled hour", () => {
    expect(calculateNextRunAt(9, "daily", null, wed(9))).toEqual(
      new Date(2026, 2, 5, 9),
    );
  });

  it("is the default when only the hour is given", () => {
    const before = Date.now();
    const next = calculateNextRunAt(5);
    expect(next.getHours()).toBe(5);
    expect(next.getTime()).toBeGreaterThan(before);
    expect(next.getTime() - before).toBeLessThanOrEqual(25 * 3600 * 1000);
  });

  it("ignores a stray day of week", () => {
    expect(calculateNextRunAt(14, "daily", 5, wed(9))).toEqual(wed(14));
  });

  it("keeps the hour at midnight", () => {
    expect(calculateNextRunAt(0, "daily", null, wed(9))).toEqual(
      new Date(2026, 2, 5, 0),
    );
  });
});

describe("calculateNextRunAt - weekly", () => {
  it("runs later today on the chosen weekday when the hour has not passed", () => {
    expect(calculateNextRunAt(14, "weekly", 3, wed(9))).toEqual(wed(14));
  });

  it("rolls a full week when the chosen weekday's hour has passed", () => {
    expect(calculateNextRunAt(8, "weekly", 3, wed(9))).toEqual(
      new Date(2026, 2, 11, 8),
    );
  });

  it("rolls a full week when now is exactly the scheduled hour", () => {
    expect(calculateNextRunAt(9, "weekly", 3, wed(9))).toEqual(
      new Date(2026, 2, 11, 9),
    );
  });

  it("picks the next occurrence later in the same week", () => {
    // Friday
    expect(calculateNextRunAt(9, "weekly", 5, wed(20))).toEqual(
      new Date(2026, 2, 6, 9),
    );
  });

  it("wraps into next week for a weekday earlier than today", () => {
    // Monday after Wednesday the 4th
    expect(calculateNextRunAt(9, "weekly", 1, wed(20))).toEqual(
      new Date(2026, 2, 9, 9),
    );
  });

  it("handles Sunday (0) as the last day of the week", () => {
    expect(calculateNextRunAt(9, "weekly", 0, wed(20))).toEqual(
      new Date(2026, 2, 8, 9),
    );
  });

  it("rolls over a month boundary", () => {
    // Tue 2026-03-31, next Monday is 2026-04-06
    expect(
      calculateNextRunAt(9, "weekly", 1, new Date(2026, 2, 31, 12)),
    ).toEqual(new Date(2026, 3, 6, 9));
  });

  it("keeps the wall-clock hour across a DST change", () => {
    // US DST began Sun 2026-03-08. Where the zone observes it, a Monday 09:00
    // run set on the 3rd is still 09:00 local on the 9th.
    const next = calculateNextRunAt(9, "weekly", 1, new Date(2026, 2, 3, 10));
    expect(next).toEqual(new Date(2026, 2, 9, 9));
    expect(next.getHours()).toBe(9);
  });

  it("falls back to daily for a weekly row with no day", () => {
    expect(calculateNextRunAt(14, "weekly", null, wed(9))).toEqual(wed(14));
  });
});

describe("calculateNextRunAtFor", () => {
  it("treats a row without the new fields as daily", () => {
    expect(calculateNextRunAtFor({ scheduleHour: 8 }, wed(9))).toEqual(
      new Date(2026, 2, 5, 8),
    );
  });

  it("applies frequency and day from the row", () => {
    expect(
      calculateNextRunAtFor(
        { scheduleHour: 8, scheduleFrequency: "weekly", scheduleDayOfWeek: 3 },
        wed(9),
      ),
    ).toEqual(new Date(2026, 2, 11, 8));
  });
});

describe("formatSchedule", () => {
  it("describes a daily schedule", () => {
    expect(formatSchedule({ scheduleHour: 9, scheduleFrequency: "daily" })).toBe(
      "Daily at 09:00",
    );
  });

  it("defaults to daily when the frequency is missing", () => {
    expect(formatSchedule({ scheduleHour: 14 })).toBe("Daily at 14:00");
  });

  it("names the weekday for a weekly schedule", () => {
    expect(
      formatSchedule({
        scheduleHour: 9,
        scheduleFrequency: "weekly",
        scheduleDayOfWeek: 1,
      }),
    ).toBe("Weekly on Monday at 09:00");
    expect(
      formatSchedule({
        scheduleHour: 18,
        scheduleFrequency: "weekly",
        scheduleDayOfWeek: 0,
      }),
    ).toBe("Weekly on Sunday at 18:00");
  });
});

describe("automation schema - schedule frequency", () => {
  const base = {
    name: "Weekly sweep",
    jobBoard: "greenhouse" as const,
    sourceConfig: {
      greenhouse: { companies: [{ name: "Anthropic", token: "anthropic" }] },
    },
    resumeId: "11111111-1111-4111-8111-111111111111",
    matchThreshold: 80,
    scheduleHour: 9,
  };

  it("accepts a create without the new fields (daily)", () => {
    expect(CreateAutomationSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a weekly create with a day", () => {
    const res = CreateAutomationSchema.safeParse({
      ...base,
      scheduleFrequency: "weekly",
      scheduleDayOfWeek: 6,
    });
    expect(res.success).toBe(true);
  });

  it("rejects a weekly create without a day", () => {
    const res = CreateAutomationSchema.safeParse({
      ...base,
      scheduleFrequency: "weekly",
    });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0].path).toEqual(["scheduleDayOfWeek"]);
  });

  it("rejects a weekly create whose day is null", () => {
    const res = CreateAutomationSchema.safeParse({
      ...base,
      scheduleFrequency: "weekly",
      scheduleDayOfWeek: null,
    });
    expect(res.success).toBe(false);
  });

  it("accepts a daily create with a null day", () => {
    const res = CreateAutomationSchema.safeParse({
      ...base,
      scheduleFrequency: "daily",
      scheduleDayOfWeek: null,
    });
    expect(res.success).toBe(true);
  });

  it("rejects an unknown frequency", () => {
    const res = CreateAutomationSchema.safeParse({
      ...base,
      scheduleFrequency: "monthly",
    });
    expect(res.success).toBe(false);
  });

  it.each([-1, 7, 1.5])("rejects day of week %s", (day) => {
    const res = CreateAutomationSchema.safeParse({
      ...base,
      scheduleFrequency: "weekly",
      scheduleDayOfWeek: day,
    });
    expect(res.success).toBe(false);
  });

  it("lets an update change just the frequency fields", () => {
    const res = UpdateAutomationSchema.safeParse({
      scheduleFrequency: "weekly",
      scheduleDayOfWeek: 2,
    });
    expect(res.success).toBe(true);
  });

  it("rejects an update with an out-of-range day", () => {
    expect(
      UpdateAutomationSchema.safeParse({ scheduleDayOfWeek: 9 }).success,
    ).toBe(false);
  });
});
