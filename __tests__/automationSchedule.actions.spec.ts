import { createAutomation, updateAutomation } from "@/actions/automation.actions";
import { getCurrentUser } from "@/utils/user.utils";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

vi.mock("@prisma/client", () => {
  const mPrismaClient = {
    automation: {
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    resume: {
      findFirst: vi.fn(),
    },
  };
  return {
    PrismaClient: vi.fn(function () {
      return mPrismaClient;
    }),
  };
});

vi.mock("@/utils/user.utils", () => ({
  getCurrentUser: vi.fn(),
}));

// syncSchedulerState boots node-cron and hits the DB; stub it out.
vi.mock("@/lib/scheduler", () => ({
  syncSchedulerState: vi.fn(),
}));

const RESUME_ID = "11111111-1111-4111-8111-111111111111";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test Automation",
    jobBoard: "greenhouse",
    keywords: "engineer",
    location: "New York",
    sourceConfig: {
      greenhouse: { companies: [{ name: "Anthropic", token: "anthropic" }] },
    },
    resumeId: RESUME_ID,
    matchThreshold: 80,
    scheduleHour: 8,
    ...overrides,
  } as any;
}

describe("createAutomation schedule-hour uniqueness", () => {
  const mockUser = { id: "user-1" };

  beforeEach(() => {
    vi.clearAllMocks();
    (getCurrentUser as any).mockResolvedValue(mockUser);
    (prisma.automation.count as any).mockResolvedValue(1);
    (prisma.resume.findFirst as any).mockResolvedValue({ id: RESUME_ID });
    (prisma.automation.create as any).mockResolvedValue({ id: "auto-1" });
  });

  it("rejects a create when another automation already uses the same hour", async () => {
    (prisma.automation.findFirst as any).mockResolvedValue({ id: "other" });

    const result = await createAutomation(baseInput());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/08:00/);
    expect(prisma.automation.create).not.toHaveBeenCalled();
  });

  it("scopes the clash check to the current user and chosen hour", async () => {
    (prisma.automation.findFirst as any).mockResolvedValue(null);

    await createAutomation(baseInput({ scheduleHour: 14 }));

    const where = (prisma.automation.findFirst as any).mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: "user-1", scheduleHour: 14 });
  });

  it("creates the automation when the hour is free", async () => {
    (prisma.automation.findFirst as any).mockResolvedValue(null);

    const result = await createAutomation(baseInput());

    expect(result.success).toBe(true);
    expect(prisma.automation.create).toHaveBeenCalled();
  });
});

describe("updateAutomation schedule-hour uniqueness", () => {
  const mockUser = { id: "user-1" };
  const AUTO_ID = "auto-1";

  beforeEach(() => {
    vi.clearAllMocks();
    (getCurrentUser as any).mockResolvedValue(mockUser);
    (prisma.resume.findFirst as any).mockResolvedValue({ id: RESUME_ID });
    (prisma.automation.update as any).mockResolvedValue({ id: AUTO_ID });
  });

  it("rejects when another automation already uses the target hour", async () => {
    (prisma.automation.findFirst as any)
      .mockResolvedValueOnce({ id: AUTO_ID, scheduleHour: 8 }) // ownership lookup
      .mockResolvedValueOnce({ id: "sibling" }); // clash check

    const result = await updateAutomation(AUTO_ID, baseInput({ scheduleHour: 9 }));

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/09:00/);
    expect(prisma.automation.update).not.toHaveBeenCalled();
  });

  it("excludes the automation being edited from the clash query", async () => {
    (prisma.automation.findFirst as any)
      .mockResolvedValueOnce({ id: AUTO_ID, scheduleHour: 8 })
      .mockResolvedValueOnce(null);

    await updateAutomation(AUTO_ID, baseInput({ scheduleHour: 8 }));

    const clashWhere = (prisma.automation.findFirst as any).mock.calls[1][0].where;
    expect(clashWhere).toMatchObject({
      userId: "user-1",
      scheduleHour: 8,
      id: { not: AUTO_ID },
    });
  });

  it("updates when no other automation uses the hour", async () => {
    (prisma.automation.findFirst as any)
      .mockResolvedValueOnce({ id: AUTO_ID, scheduleHour: 8 })
      .mockResolvedValueOnce(null);

    const result = await updateAutomation(AUTO_ID, baseInput({ scheduleHour: 10 }));

    expect(result.success).toBe(true);
    expect(prisma.automation.update).toHaveBeenCalled();
  });
});

describe("weekly schedules", () => {
  const mockUser = { id: "user-1" };
  const AUTO_ID = "auto-1";

  beforeEach(() => {
    vi.clearAllMocks();
    (getCurrentUser as any).mockResolvedValue(mockUser);
    (prisma.automation.count as any).mockResolvedValue(1);
    (prisma.resume.findFirst as any).mockResolvedValue({ id: RESUME_ID });
    (prisma.automation.create as any).mockResolvedValue({ id: AUTO_ID });
    (prisma.automation.update as any).mockResolvedValue({ id: AUTO_ID });
  });

  it("stores a daily schedule with no day when frequency is omitted", async () => {
    (prisma.automation.findFirst as any).mockResolvedValue(null);

    await createAutomation(baseInput());

    const data = (prisma.automation.create as any).mock.calls[0][0].data;
    expect(data).toMatchObject({
      scheduleHour: 8,
      scheduleFrequency: "daily",
      scheduleDayOfWeek: null,
    });
    expect(data.nextRunAt.getHours()).toBe(8);
  });

  it("stores a weekly schedule and computes nextRunAt on that weekday", async () => {
    (prisma.automation.findFirst as any).mockResolvedValue(null);

    const result = await createAutomation(
      baseInput({ scheduleFrequency: "weekly", scheduleDayOfWeek: 2 }),
    );

    expect(result.success).toBe(true);
    const data = (prisma.automation.create as any).mock.calls[0][0].data;
    expect(data).toMatchObject({
      scheduleFrequency: "weekly",
      scheduleDayOfWeek: 2,
    });
    expect(data.nextRunAt.getDay()).toBe(2);
    expect(data.nextRunAt.getHours()).toBe(8);
    expect(data.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("drops a stray day when the create is daily", async () => {
    (prisma.automation.findFirst as any).mockResolvedValue(null);

    await createAutomation(
      baseInput({ scheduleFrequency: "daily", scheduleDayOfWeek: 4 }),
    );

    const data = (prisma.automation.create as any).mock.calls[0][0].data;
    expect(data.scheduleDayOfWeek).toBeNull();
  });

  it("rejects a weekly create with no day", async () => {
    (prisma.automation.findFirst as any).mockResolvedValue(null);

    const result = await createAutomation(
      baseInput({ scheduleFrequency: "weekly" }),
    );

    expect(result.success).toBe(false);
    expect(prisma.automation.create).not.toHaveBeenCalled();
  });

  it("recomputes nextRunAt when an edit switches daily to weekly", async () => {
    (prisma.automation.findFirst as any)
      .mockResolvedValueOnce({
        id: AUTO_ID,
        scheduleHour: 8,
        scheduleFrequency: "daily",
        scheduleDayOfWeek: null,
      })
      .mockResolvedValueOnce(null);

    await updateAutomation(
      AUTO_ID,
      baseInput({ scheduleFrequency: "weekly", scheduleDayOfWeek: 5 }),
    );

    const data = (prisma.automation.update as any).mock.calls[0][0].data;
    expect(data).toMatchObject({
      scheduleFrequency: "weekly",
      scheduleDayOfWeek: 5,
    });
    expect(data.nextRunAt.getDay()).toBe(5);
  });

  it("clears the day and recomputes when an edit switches weekly to daily", async () => {
    (prisma.automation.findFirst as any)
      .mockResolvedValueOnce({
        id: AUTO_ID,
        scheduleHour: 8,
        scheduleFrequency: "weekly",
        scheduleDayOfWeek: 5,
      })
      .mockResolvedValueOnce(null);

    await updateAutomation(
      AUTO_ID,
      baseInput({ scheduleFrequency: "daily", scheduleDayOfWeek: null }),
    );

    const data = (prisma.automation.update as any).mock.calls[0][0].data;
    expect(data).toMatchObject({
      scheduleFrequency: "daily",
      scheduleDayOfWeek: null,
    });
    const msUntil = data.nextRunAt.getTime() - Date.now();
    expect(msUntil).toBeGreaterThan(0);
    expect(msUntil).toBeLessThanOrEqual(25 * 3600 * 1000);
  });

  it("recomputes from the stored schedule when only the day changes", async () => {
    (prisma.automation.findFirst as any).mockResolvedValueOnce({
      id: AUTO_ID,
      scheduleHour: 11,
      scheduleFrequency: "weekly",
      scheduleDayOfWeek: 1,
    });

    await updateAutomation(AUTO_ID, { scheduleDayOfWeek: 4 } as any);

    const data = (prisma.automation.update as any).mock.calls[0][0].data;
    expect(data.nextRunAt.getDay()).toBe(4);
    expect(data.nextRunAt.getHours()).toBe(11);
  });

  it("refuses to make a daily automation weekly without a day", async () => {
    (prisma.automation.findFirst as any).mockResolvedValueOnce({
      id: AUTO_ID,
      scheduleHour: 8,
      scheduleFrequency: "daily",
      scheduleDayOfWeek: null,
    });

    const result = await updateAutomation(AUTO_ID, {
      scheduleFrequency: "weekly",
    } as any);

    expect(result.success).toBe(false);
    expect(prisma.automation.update).not.toHaveBeenCalled();
  });

  it("leaves nextRunAt alone when no schedule field changes", async () => {
    (prisma.automation.findFirst as any).mockResolvedValueOnce({
      id: AUTO_ID,
      scheduleHour: 8,
      scheduleFrequency: "daily",
      scheduleDayOfWeek: null,
    });

    await updateAutomation(AUTO_ID, { name: "Renamed" } as any);

    const data = (prisma.automation.update as any).mock.calls[0][0].data;
    expect(data).not.toHaveProperty("nextRunAt");
    expect(data).not.toHaveProperty("scheduleFrequency");
  });
});

describe("frequency-aware schedule clash", () => {
  const mockUser = { id: "user-1" };
  const AUTO_ID = "auto-1";
  const clashWhere = (call: number) =>
    (prisma.automation.findFirst as any).mock.calls[call][0].where;

  beforeEach(() => {
    vi.clearAllMocks();
    (getCurrentUser as any).mockResolvedValue(mockUser);
    (prisma.automation.count as any).mockResolvedValue(1);
    (prisma.resume.findFirst as any).mockResolvedValue({ id: RESUME_ID });
    (prisma.automation.create as any).mockResolvedValue({ id: AUTO_ID });
    (prisma.automation.update as any).mockResolvedValue({ id: AUTO_ID });
  });

  it("a daily create clashes with any automation in that hour", async () => {
    (prisma.automation.findFirst as any).mockResolvedValue(null);

    await createAutomation(baseInput());

    expect(clashWhere(0)).toEqual({ userId: "user-1", scheduleHour: 8 });
  });

  it("a weekly create clashes only with daily rows or the same weekday", async () => {
    (prisma.automation.findFirst as any).mockResolvedValue(null);

    await createAutomation(
      baseInput({ scheduleFrequency: "weekly", scheduleDayOfWeek: 1 }),
    );

    expect(clashWhere(0)).toEqual({
      userId: "user-1",
      scheduleHour: 8,
      OR: [
        { scheduleFrequency: "daily" },
        { scheduleFrequency: "weekly", scheduleDayOfWeek: 1 },
      ],
    });
  });

  it("rejects a weekly create when a clashing row is found", async () => {
    (prisma.automation.findFirst as any).mockResolvedValue({ id: "other" });

    const result = await createAutomation(
      baseInput({ scheduleFrequency: "weekly", scheduleDayOfWeek: 1 }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/08:00/);
    expect(prisma.automation.create).not.toHaveBeenCalled();
  });

  it("an edit that only changes the frequency checks the stored hour and day", async () => {
    (prisma.automation.findFirst as any)
      .mockResolvedValueOnce({
        id: AUTO_ID,
        scheduleHour: 14,
        scheduleFrequency: "daily",
        scheduleDayOfWeek: null,
      })
      .mockResolvedValueOnce(null);

    await updateAutomation(AUTO_ID, {
      scheduleFrequency: "weekly",
      scheduleDayOfWeek: 2,
    } as any);

    expect(clashWhere(1)).toEqual({
      userId: "user-1",
      scheduleHour: 14,
      OR: [
        { scheduleFrequency: "daily" },
        { scheduleFrequency: "weekly", scheduleDayOfWeek: 2 },
      ],
      id: { not: AUTO_ID },
    });
  });

  it("an edit that only changes the day checks the stored hour and frequency", async () => {
    (prisma.automation.findFirst as any)
      .mockResolvedValueOnce({
        id: AUTO_ID,
        scheduleHour: 11,
        scheduleFrequency: "weekly",
        scheduleDayOfWeek: 1,
      })
      .mockResolvedValueOnce(null);

    await updateAutomation(AUTO_ID, { scheduleDayOfWeek: 4 } as any);

    expect(clashWhere(1)).toMatchObject({
      scheduleHour: 11,
      OR: [
        { scheduleFrequency: "daily" },
        { scheduleFrequency: "weekly", scheduleDayOfWeek: 4 },
      ],
      id: { not: AUTO_ID },
    });
  });

  it("rejects an edit that moves a weekly row onto a clashing day", async () => {
    (prisma.automation.findFirst as any)
      .mockResolvedValueOnce({
        id: AUTO_ID,
        scheduleHour: 11,
        scheduleFrequency: "weekly",
        scheduleDayOfWeek: 1,
      })
      .mockResolvedValueOnce({ id: "sibling" });

    const result = await updateAutomation(AUTO_ID, {
      scheduleDayOfWeek: 4,
    } as any);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/11:00/);
    expect(prisma.automation.update).not.toHaveBeenCalled();
  });

  it("an edit to daily drops the weekday filter", async () => {
    (prisma.automation.findFirst as any)
      .mockResolvedValueOnce({
        id: AUTO_ID,
        scheduleHour: 11,
        scheduleFrequency: "weekly",
        scheduleDayOfWeek: 1,
      })
      .mockResolvedValueOnce(null);

    await updateAutomation(AUTO_ID, { scheduleFrequency: "daily" } as any);

    expect(clashWhere(1)).toEqual({
      userId: "user-1",
      scheduleHour: 11,
      id: { not: AUTO_ID },
    });
  });

  it("skips the clash query when no schedule field changes", async () => {
    (prisma.automation.findFirst as any).mockResolvedValueOnce({
      id: AUTO_ID,
      scheduleHour: 8,
      scheduleFrequency: "daily",
      scheduleDayOfWeek: null,
    });

    await updateAutomation(AUTO_ID, { name: "Renamed" } as any);

    expect(prisma.automation.findFirst).toHaveBeenCalledTimes(1);
  });
});
