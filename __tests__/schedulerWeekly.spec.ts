import db from "@/lib/db";
import { runAutomation } from "@/lib/scraper";
import { startScheduler, stopScheduler } from "@/lib/scheduler";
import cron from "node-cron";

vi.mock("@/lib/db", () => ({
  default: {
    automation: { findMany: vi.fn(), count: vi.fn() },
    automationRun: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/scraper", () => ({
  runAutomation: vi.fn(),
  AutomationAlreadyRunningError: class extends Error {},
}));
vi.mock("node-cron", () => ({
  default: { schedule: vi.fn(() => ({ stop: vi.fn() })), validate: vi.fn(() => true) },
}));
vi.mock("@/lib/notifications/prune", () => ({ pruneNotifications: vi.fn() }));
vi.mock("@/lib/aiUsage/prune", () => ({ pruneAiCalls: vi.fn() }));

const mdb = db as any;

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "auto-1",
  userId: "u1",
  name: "Weekly sweep",
  jobBoard: "greenhouse",
  keywords: "",
  location: "",
  sourceConfig: null,
  resumeId: "r1",
  resume: { id: "r1", title: "Resume" },
  matchThreshold: 80,
  scheduleHour: 9,
  scheduleFrequency: "weekly",
  scheduleDayOfWeek: 1,
  nextRunAt: new Date("2026-03-02T09:00:00"),
  lastRunAt: null,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// Fires the hourly tick the way node-cron would.
async function tick() {
  stopScheduler();
  startScheduler();
  const callback = (cron.schedule as any).mock.calls[0][1] as () => Promise<void>;
  await callback();
}

describe("scheduler with weekly automations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mdb.automationRun.findFirst.mockResolvedValue(null);
    (runAutomation as any).mockResolvedValue({ status: "completed", jobsSaved: 0 });
  });

  afterEach(() => stopScheduler());

  it("selects due rows by nextRunAt, not by frequency", async () => {
    mdb.automation.findMany.mockResolvedValue([]);

    await tick();

    const where = mdb.automation.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("active");
    expect(where.nextRunAt.lte).toBeInstanceOf(Date);
    expect(where).not.toHaveProperty("scheduleFrequency");
  });

  it("runs a due weekly row with its frequency and weekday intact", async () => {
    mdb.automation.findMany.mockResolvedValue([row()]);

    await tick();

    expect(runAutomation).toHaveBeenCalledTimes(1);
    expect((runAutomation as any).mock.calls[0][0]).toMatchObject({
      id: "auto-1",
      scheduleHour: 9,
      scheduleFrequency: "weekly",
      scheduleDayOfWeek: 1,
    });
  });

  it("runs daily and weekly rows in the same tick", async () => {
    mdb.automation.findMany.mockResolvedValue([
      row(),
      row({
        id: "auto-2",
        scheduleHour: 10,
        scheduleFrequency: "daily",
        scheduleDayOfWeek: null,
      }),
    ]);

    await tick();

    const ids = (runAutomation as any).mock.calls.map((c: any) => c[0].id);
    expect(ids).toEqual(["auto-1", "auto-2"]);
  });
});
