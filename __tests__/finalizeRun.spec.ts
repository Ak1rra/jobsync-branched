import { finalizeRun } from "@/lib/scraper/automation-run/finalize";
import { recordRunNotifications } from "@/lib/notifications/record";
import prisma from "@/lib/db";

vi.mock("@/lib/db", () => ({
  default: {
    automationRun: { update: vi.fn() },
    automation: { update: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/notifications/record", () => ({
  recordRunNotifications: vi.fn(),
}));

const db = prisma as any;
const data = {
  status: "completed" as const,
  jobsSearched: 1,
  jobsDeduplicated: 1,
  jobsProcessed: 1,
  jobsMatched: 1,
  jobsSaved: 1,
  boardErrors: [{ token: "t", name: "T", reason: "Board 't' returned 404" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.automationRun.update.mockResolvedValue({ id: "run-1", automationId: "a" });
  db.automation.findUnique.mockResolvedValue({ scheduleHour: 8 });
});

it("records notifications before the run row turns terminal", async () => {
  const order: string[] = [];
  (recordRunNotifications as any).mockImplementation(async () => {
    order.push("notify");
  });
  db.automationRun.update.mockImplementation(async () => {
    order.push("run");
    return { id: "run-1", automationId: "a" };
  });

  await finalizeRun("run-1", data);

  expect(order).toEqual(["notify", "run"]);
  expect(recordRunNotifications).toHaveBeenCalledWith("run-1", data);
});

it("does not persist boardErrors on the run row", async () => {
  await finalizeRun("run-1", data);
  expect(db.automationRun.update.mock.calls[0][0].data).not.toHaveProperty(
    "boardErrors",
  );
});

it("does not return boardErrors in the RunnerResult", async () => {
  const result = await finalizeRun("run-1", data);
  expect(result).not.toHaveProperty("boardErrors");
});

describe("next run after a run", () => {
  const nextRunAt = () => db.automation.update.mock.calls[0][0].data.nextRunAt;

  it("schedules the next day for a daily automation", async () => {
    db.automation.findUnique.mockResolvedValue({
      scheduleHour: 8,
      scheduleFrequency: "daily",
      scheduleDayOfWeek: null,
    });
    await finalizeRun("run-1", data);
    const ms = nextRunAt().getTime() - Date.now();
    expect(nextRunAt().getHours()).toBe(8);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(25 * 3600 * 1000);
  });

  it("schedules the next chosen weekday for a weekly automation", async () => {
    db.automation.findUnique.mockResolvedValue({
      scheduleHour: 8,
      scheduleFrequency: "weekly",
      scheduleDayOfWeek: 2,
    });
    await finalizeRun("run-1", data);
    expect(nextRunAt().getDay()).toBe(2);
    expect(nextRunAt().getHours()).toBe(8);
    expect(nextRunAt().getTime()).toBeGreaterThan(Date.now());
    expect(nextRunAt().getTime() - Date.now()).toBeLessThanOrEqual(
      7 * 24 * 3600 * 1000 + 3600 * 1000,
    );
  });

  it("treats a row without frequency fields as daily", async () => {
    db.automation.findUnique.mockResolvedValue({ scheduleHour: 8 });
    await finalizeRun("run-1", data);
    expect(nextRunAt().getTime() - Date.now()).toBeLessThanOrEqual(
      25 * 3600 * 1000,
    );
  });

  it("keeps a midnight schedule at hour 0", async () => {
    db.automation.findUnique.mockResolvedValue({ scheduleHour: 0 });
    await finalizeRun("run-1", data);
    expect(nextRunAt().getHours()).toBe(0);
  });
});
