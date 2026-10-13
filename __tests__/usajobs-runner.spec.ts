import { PrismaClient } from "@prisma/client";
import page1 from "./fixtures/usajobs-search-page1.json";
import page2 from "./fixtures/usajobs-search-page2.json";
import empty from "./fixtures/usajobs-search-empty.json";

const prisma = new PrismaClient();

vi.mock("@prisma/client", () => {
  const m = {
    automationRun: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    automation: { findUnique: vi.fn(), update: vi.fn() },
    resume: { findUnique: vi.fn() },
    userSettings: { findUnique: vi.fn() },
    job: { findMany: vi.fn(), create: vi.fn() },
    jobTitle: { findUnique: vi.fn(), create: vi.fn() },
    location: { findUnique: vi.fn(), create: vi.fn() },
    company: { findUnique: vi.fn(), create: vi.fn() },
    jobSource: { findUnique: vi.fn(), create: vi.fn() },
    jobStatus: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    jobStage: { create: vi.fn() },
    jobStageType: { findUnique: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
  };
  return {
    PrismaClient: vi.fn(function () {
      return m;
    }),
  };
});

vi.mock("@/lib/scraper/greenhouse", () => ({ searchGreenhouseJobs: vi.fn() }));
vi.mock("@/lib/scraper/lever", () => ({ searchLeverJobs: vi.fn() }));
vi.mock("@/lib/scraper/ashby", () => ({ searchAshbyJobs: vi.fn() }));

const mockResolveApiKey = vi.fn();
vi.mock("@/lib/api-key-resolver", () => ({
  resolveApiKey: (...args: unknown[]) => mockResolveApiKey(...args),
}));

vi.mock("@/lib/ai/provider-registry.server", () => ({
  PROVIDER_VERIFIERS: { ollama: vi.fn().mockResolvedValue({ success: true }) },
}));

vi.mock("ai", () => ({ generateText: vi.fn() }));

vi.mock("@/lib/notifications/record", () => ({
  recordRunNotifications: vi.fn(),
}));

vi.mock("@/lib/ai", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, getModel: vi.fn().mockResolvedValue({}) };
});

import { runAutomation } from "@/lib/scraper/runner";
import { searchGreenhouseJobs } from "@/lib/scraper/greenhouse";
import { searchLeverJobs } from "@/lib/scraper/lever";
import { searchAshbyJobs } from "@/lib/scraper/ashby";
import { ATS_PROVIDERS } from "@/lib/scraper/ats/registry";
import { isQueryProvider } from "@/lib/scraper/ats/types";
import { generateText } from "ai";
import { recordRunNotifications } from "@/lib/notifications/record";
import { automationLogger } from "@/lib/automation-logger";
import { APP_CONSTANTS } from "@/lib/constants";
import type { Automation } from "@/models/automation.model";

const KEY = "SECRET-KEY-1234567890";
const EMAIL = "jane.doe@example.com";

const usajobsConfig = {
  keyword: "information technology",
  targetTitles: [
    "IT Specialist",
    "Cybersecurity Specialist",
    "Management Analyst",
    "Biological Science Technician",
  ],
  keywords: [],
  locations: [],
  strictLocation: false,
};

const usajobsAutomation: Automation = {
  id: "auto-usajobs",
  userId: "user1",
  name: "Federal IT",
  jobBoard: "usajobs",
  keywords: "",
  location: "",
  sourceConfig: JSON.stringify({ usajobs: usajobsConfig }),
  resumeId: "resume1",
  matchThreshold: 80,
  scheduleHour: 8,
  nextRunAt: null,
  lastRunAt: null,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function res(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as Response;
}

// Routes a fetch by its Page query parameter.
function stubPages(pages: Record<number, () => Response>) {
  return vi.spyOn(global, "fetch").mockImplementation((url) => {
    const page = Number(new URL(String(url)).searchParams.get("Page"));
    const make = pages[page];
    if (!make) throw new Error(`unexpected page ${page}`);
    return Promise.resolve(make());
  });
}

const savedUrls = () =>
  (prisma.job.create as any).mock.calls.map((c: any[]) => c[0].data.jobUrl);

describe("runAutomation (usajobs)", () => {
  const originalDelays = {
    base: APP_CONSTANTS.USAJOBS_RETRY_BASE_DELAY_MS,
    page: APP_CONSTANTS.USAJOBS_PAGE_DELAY_MS,
  };

  beforeAll(() => {
    // Real timers throughout; just make the retry/politeness waits negligible.
    (APP_CONSTANTS as any).USAJOBS_RETRY_BASE_DELAY_MS = 1;
    (APP_CONSTANTS as any).USAJOBS_PAGE_DELAY_MS = 0;
  });
  afterAll(() => {
    (APP_CONSTANTS as any).USAJOBS_RETRY_BASE_DELAY_MS = originalDelays.base;
    (APP_CONSTANTS as any).USAJOBS_PAGE_DELAY_MS = originalDelays.page;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveApiKey.mockImplementation(async (_u: string, p: string) =>
      p === "usajobs" ? KEY : p === "usajobs_email" ? EMAIL : undefined,
    );

    (prisma.automationRun.create as any).mockResolvedValue({ id: "run1" });
    (prisma.automationRun.update as any).mockResolvedValue({
      id: "run1",
      automationId: "auto-usajobs",
    });
    (prisma.automationRun.findUnique as any).mockResolvedValue({ status: "running" });
    (prisma.automation.findUnique as any).mockResolvedValue({ scheduleHour: 8 });
    (prisma.automation.update as any).mockResolvedValue({});
    (prisma.userSettings.findUnique as any).mockResolvedValue(null);
    (prisma.resume.findUnique as any).mockResolvedValue({
      id: "resume1",
      title: "My Resume",
      ContactInfo: null,
      ResumeSections: [],
    });
    (prisma.job.findMany as any).mockResolvedValue([]);
    (prisma.job.create as any).mockResolvedValue({});
    (prisma.jobTitle.findUnique as any).mockResolvedValue({ id: "jt" });
    (prisma.location.findUnique as any).mockResolvedValue({ id: "loc" });
    (prisma.company.findUnique as any).mockResolvedValue({ id: "co" });
    (prisma.jobSource.findUnique as any).mockResolvedValue({ id: "src" });
    (prisma.jobStatus.findFirst as any).mockResolvedValue({ id: "st" });
    (prisma.jobStatus.findUnique as any).mockResolvedValue({ id: "st", label: "New" });
    (prisma.jobStageType.findUnique as any).mockResolvedValue({
      id: "stage-type-new",
      label: "New",
    });
    (prisma.jobStage.create as any).mockResolvedValue({ id: "stage-1" });

    (generateText as any).mockResolvedValue({
      text: "SCORES: match=90 recommendation=strong match\n\n## Summary\nGreat fit",
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("fetches both pages through the shared pipeline and saves the jobs", async () => {
    const spy = stubPages({ 1: () => res(page1), 2: () => res(page2) });

    const result = await runAutomation(usajobsAutomation);

    expect(result.status).toBe("completed");
    expect(result.errorMessage).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.jobsSearched).toBe(4);
    expect(result.jobsDeduplicated).toBe(4);
    expect(result.jobsSaved).toBe(4);
    expect(savedUrls().sort()).toEqual([
      "https://www.usajobs.gov/job/812345600",
      "https://www.usajobs.gov/job/812345601",
      "https://www.usajobs.gov/job/812345602",
      "https://www.usajobs.gov/job/812345603",
    ]);
    // Watchlist providers are never touched.
    expect((searchGreenhouseJobs as any).mock.calls.length).toBe(0);
    expect((searchLeverJobs as any).mock.calls.length).toBe(0);
    expect((searchAshbyJobs as any).mock.calls.length).toBe(0);
  });

  it("sends the credentials as headers on every request", async () => {
    const spy = stubPages({ 1: () => res(page1), 2: () => res(page2) });
    await runAutomation(usajobsAutomation);
    for (const [, init] of spy.mock.calls as [string, RequestInit][]) {
      const h = init.headers as Record<string, string>;
      expect(h["Authorization-Key"]).toBe(KEY);
      expect(h["User-Agent"]).toBe(EMAIL);
      expect(h.Host).toBe("data.usajobs.gov");
    }
    expect(String(spy.mock.calls[0][0])).toContain("Keyword=information%20technology");
  });

  it("persists type, workplace and the posting's close date on the job record", async () => {
    stubPages({ 1: () => res(page1), 2: () => res(page2) });
    await runAutomation(usajobsAutomation);

    const byUrl = Object.fromEntries(
      (prisma.job.create as any).mock.calls.map((c: any[]) => [c[0].data.jobUrl, c[0].data]),
    );
    const ft = byUrl["https://www.usajobs.gov/job/812345600"];
    expect(ft.jobType).toBe("FT");
    expect(ft.workplaceType).toBeNull();
    expect(ft.dueDate).toEqual(new Date("2099-12-31T23:59:59.997Z"));
    expect(ft.description).toContain("Announcement number: DE-12345678-26-ABC");

    const temp = byUrl["https://www.usajobs.gov/job/812345601"];
    expect(temp.jobType).toBe("C");
    expect(temp.workplaceType).toBe("REMOTE");

    // No close date reported -> the default due-date window, not NaN/undefined.
    const noClose = byUrl["https://www.usajobs.gov/job/812345602"];
    expect(noClose.dueDate).toBeInstanceOf(Date);
    expect(Number.isNaN(noClose.dueDate.getTime())).toBe(false);
  });

  it("repeated runs do not duplicate: already-saved announcements are skipped", async () => {
    stubPages({ 1: () => res(page1), 2: () => res(page2) });
    const first = await runAutomation(usajobsAutomation);
    expect(first.jobsSaved).toBe(4);

    // Second run sees the first run's rows (stored URLs are normalized).
    (prisma.job.findMany as any).mockResolvedValue(
      savedUrls().map((jobUrl: string, i: number) => ({
        id: `j${i}`,
        jobUrl,
        JobTitle: { label: "t" },
        Company: { label: "c" },
        Location: null,
      })),
    );
    (prisma.job.create as any).mockClear();
    (prisma.automationRun.create as any).mockResolvedValue({ id: "run2" });

    const second = await runAutomation(usajobsAutomation);

    expect(second.status).toBe("completed");
    expect(second.jobsSearched).toBe(4);
    expect(second.jobsDeduplicated).toBe(0);
    expect(second.jobsSaved).toBe(0);
    expect((prisma.job.create as any).mock.calls.length).toBe(0);
  });

  it("only saves the new announcement when one more appears", async () => {
    (prisma.job.findMany as any).mockResolvedValue(
      [812345600, 812345601, 812345602].map((n) => ({
        id: `j${n}`,
        jobUrl: `https://www.usajobs.gov/job/${n}`,
        JobTitle: { label: "t" },
        Company: { label: "c" },
        Location: null,
      })),
    );
    stubPages({ 1: () => res(page1), 2: () => res(page2) });

    const result = await runAutomation(usajobsAutomation);

    expect(result.jobsDeduplicated).toBe(1);
    expect(savedUrls()).toEqual(["https://www.usajobs.gov/job/812345603"]);
  });

  it("an empty search completes cleanly with nothing to process", async () => {
    stubPages({ 1: () => res(empty) });
    const result = await runAutomation(usajobsAutomation);
    expect(result.status).toBe("completed");
    expect(result.jobsSearched).toBe(0);
    expect(result.jobsSaved).toBe(0);
  });

  describe("failures never read as a completed run", () => {
    it("missing credentials -> failed usajobs_not_configured, no request made", async () => {
      mockResolveApiKey.mockResolvedValue(undefined);
      const spy = vi.spyOn(global, "fetch");

      const result = await runAutomation(usajobsAutomation);

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("usajobs_not_configured");
      expect(spy).not.toHaveBeenCalled();
      const finalizeData = (recordRunNotifications as any).mock.calls[0][1];
      expect(finalizeData.boardErrors).toEqual([
        { token: "usajobs", name: "USAJOBS search", reason: "usajobs_not_configured" },
      ]);
    });

    it("only the saved email present is not-configured, and the run log names the gap", async () => {
      mockResolveApiKey.mockImplementation(async (_u: string, p: string) =>
        p === "usajobs_email" ? EMAIL : undefined,
      );
      const logSpy = vi.spyOn(automationLogger, "log");
      const spy = vi.spyOn(global, "fetch");

      const result = await runAutomation(usajobsAutomation);

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("usajobs_not_configured");
      expect(spy).not.toHaveBeenCalled();
      const messages = logSpy.mock.calls.map((c) => String(c[2]));
      expect(messages.some((m) => /API key is not saved in Settings/.test(m))).toBe(true);
      expect(messages.join("\n")).not.toContain(EMAIL);
    });

    it("a saved key alone never borrows the server's email", async () => {
      process.env.USAJOBS_USER_AGENT_EMAIL = "server@example.com";
      process.env.USAJOBS_API_KEY = "SERVERKEY";
      mockResolveApiKey.mockImplementation(
        async (u: string | undefined, p: string, o?: { envFallback?: boolean }) => {
          if (u && p === "usajobs") return KEY;
          if (o?.envFallback === false) return undefined;
          return p === "usajobs" ? process.env.USAJOBS_API_KEY : process.env.USAJOBS_USER_AGENT_EMAIL;
        },
      );
      const spy = vi.spyOn(global, "fetch");
      try {
        const result = await runAutomation(usajobsAutomation);
        expect(result.status).toBe("failed");
        expect(result.errorMessage).toBe("usajobs_not_configured");
        expect(spy).not.toHaveBeenCalled();
      } finally {
        delete process.env.USAJOBS_USER_AGENT_EMAIL;
        delete process.env.USAJOBS_API_KEY;
      }
    });

    it("hitting the result ceiling logs a warning but the run stays completed", async () => {
      let n = 0;
      vi.spyOn(global, "fetch").mockImplementation(() => {
        const start = n++ * APP_CONSTANTS.USAJOBS_PAGE_SIZE;
        return Promise.resolve(
          res({
            SearchResult: {
              SearchResultCountAll: 9999,
              SearchResultItems: Array.from({ length: APP_CONSTANTS.USAJOBS_PAGE_SIZE }, (_, i) => ({
                MatchedObjectId: String(start + i),
                MatchedObjectDescriptor: {
                  PositionTitle: `IT Specialist ${start + i}`,
                  OrganizationName: "Agency",
                  PositionURI: `https://www.usajobs.gov/job/${start + i}`,
                },
              })),
              UserArea: { NumberOfPages: 999 },
            },
          }),
        );
      });
      const logSpy = vi.spyOn(automationLogger, "log");

      const result = await runAutomation(usajobsAutomation);

      expect(result.status).toBe("completed");
      expect(result.errorMessage).toBeUndefined();
      expect(result.jobsSearched).toBe(APP_CONSTANTS.USAJOBS_MAX_RESULTS);
      const warning = logSpy.mock.calls.find(
        (c) => c[1] === "warning" && /Result ceiling reached/.test(String(c[2])),
      );
      expect(warning).toBeDefined();
      expect(String(warning![2])).toMatch(/fetched 500 of 9999 matching announcements/);
    });

    it("401 -> failed (not completed, not an empty success), nothing saved", async () => {
      stubPages({ 1: () => res({}, 401) });

      const result = await runAutomation(usajobsAutomation);

      expect(result.status).toBe("failed");
      expect(result.status).not.toBe("completed");
      expect(result.errorMessage).toMatch(/returned 401/);
      expect(result.jobsSaved).toBe(0);
      expect((prisma.job.create as any).mock.calls.length).toBe(0);
    });

    it("partial fetch (page 2 keeps failing) -> completed_with_errors, page 1 still saved", async () => {
      stubPages({ 1: () => res(page1), 2: () => res({}, 503) });

      const result = await runAutomation(usajobsAutomation);

      expect(result.status).toBe("completed_with_errors");
      expect(result.jobsSearched).toBe(3);
      expect(result.jobsSaved).toBe(3);
      expect(result.errorMessage).toMatch(/search incomplete/);
      expect(result.errorMessage).toMatch(/partial/);
      const finalizeData = (recordRunNotifications as any).mock.calls[0][1];
      expect(finalizeData.boardErrors).toHaveLength(1);
      expect(finalizeData.boardErrors[0]).toMatchObject({
        token: "usajobs",
        name: "USAJOBS search",
      });
    });

    it("partial fetch with nothing new still ends completed_with_errors", async () => {
      (prisma.job.findMany as any).mockResolvedValue(
        [812345600, 812345601, 812345602].map((n) => ({
          id: `j${n}`,
          jobUrl: `https://www.usajobs.gov/job/${n}`,
          JobTitle: { label: "t" },
          Company: { label: "c" },
          Location: null,
        })),
      );
      stubPages({ 1: () => res(page1), 2: () => res({}, 500) });
      const result = await runAutomation(usajobsAutomation);
      expect(result.status).toBe("completed_with_errors");
    });

    it("malformed response -> failed", async () => {
      stubPages({ 1: () => res({ unexpected: true }) });
      const result = await runAutomation(usajobsAutomation);
      expect(result.status).toBe("failed");
      expect(result.errorMessage).toMatch(/malformed/);
    });

    it("an invalid stored config -> failed usajobs_invalid_config, no request", async () => {
      const spy = vi.spyOn(global, "fetch");
      const result = await runAutomation({
        ...usajobsAutomation,
        sourceConfig: JSON.stringify({ usajobs: {} }),
      });
      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("usajobs_invalid_config");
      expect(spy).not.toHaveBeenCalled();
    });

    it("a user cancel ends the run cancelled, not failed", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(res(page1));
      const controller = new AbortController();
      controller.abort();
      const result = await runAutomation(usajobsAutomation, controller.signal);
      expect(result.status).toBe("cancelled");
    });
  });

  it("never leaks the key or email into logs, notifications, DB writes or results", async () => {
    const logSpy = vi.spyOn(automationLogger, "log");
    const outputs: unknown[] = [];

    for (const pages of [
      { 1: () => res(page1), 2: () => res(page2) },
      { 1: () => res({}, 401) },
      { 1: () => res(page1), 2: () => res({}, 503) },
    ] as Record<number, () => Response>[]) {
      stubPages(pages);
      outputs.push(await runAutomation(usajobsAutomation));
      vi.restoreAllMocks();
    }
    mockResolveApiKey.mockResolvedValue(undefined);
    outputs.push(await runAutomation(usajobsAutomation));

    const dump = JSON.stringify([
      outputs,
      logSpy.mock.calls,
      (recordRunNotifications as any).mock.calls,
      (prisma.automationRun.update as any).mock.calls,
      (prisma.job.create as any).mock.calls,
    ]);
    expect(dump).not.toContain(KEY);
    expect(dump).not.toContain(EMAIL);
  });
});

describe("other providers are unaffected (regression)", () => {
  it("the three watchlist providers are not query providers; usajobs is", () => {
    for (const board of ["greenhouse", "lever", "ashby"] as const) {
      const provider = ATS_PROVIDERS[board]!;
      expect(isQueryProvider(provider)).toBe(false);
      expect(typeof (provider as any).search).toBe("function");
    }
    const usajobs = ATS_PROVIDERS.usajobs!;
    expect(isQueryProvider(usajobs)).toBe(true);
    expect((usajobs as any).search).toBeUndefined();
  });

  const watchlist = (board: "greenhouse" | "lever" | "ashby"): Automation => ({
    ...usajobsAutomation,
    id: `auto-${board}`,
    jobBoard: board,
    sourceConfig: JSON.stringify({
      [board]: {
        companies: [{ name: "Acme", token: "acme" }],
        targetTitles: ["Frontend Engineer"],
      },
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveApiKey.mockResolvedValue(undefined); // no USAJOBS config at all
    (prisma.automationRun.create as any).mockResolvedValue({ id: "run1" });
    (prisma.automationRun.update as any).mockResolvedValue({ id: "run1", automationId: "a" });
    (prisma.automationRun.findUnique as any).mockResolvedValue({ status: "running" });
    (prisma.automation.findUnique as any).mockResolvedValue({ scheduleHour: 8 });
    (prisma.automation.update as any).mockResolvedValue({});
    (prisma.userSettings.findUnique as any).mockResolvedValue(null);
    (prisma.resume.findUnique as any).mockResolvedValue({
      id: "resume1",
      title: "R",
      ContactInfo: null,
      ResumeSections: [],
    });
    (prisma.job.findMany as any).mockResolvedValue([]);
  });

  it.each([
    ["greenhouse", searchGreenhouseJobs],
    ["lever", searchLeverJobs],
    ["ashby", searchAshbyJobs],
  ] as const)(
    "%s still dispatches to its own search with the company list and completes without USAJOBS config",
    async (board, searchFn) => {
      (searchFn as any).mockResolvedValue({ jobs: [], errors: [] });

      const result = await runAutomation(watchlist(board));

      expect(result.status).toBe("completed");
      expect((searchFn as any).mock.calls[0][0]).toEqual([{ name: "Acme", token: "acme" }]);
      expect(mockResolveApiKey).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["greenhouse", searchGreenhouseJobs],
    ["lever", searchLeverJobs],
    ["ashby", searchAshbyJobs],
  ] as const)(
    "%s keeps its all-boards-unreachable failure and no_companies behaviour",
    async (board, searchFn) => {
      (searchFn as any).mockResolvedValue({
        jobs: [],
        errors: [{ token: "acme", reason: "Board 'acme' returned 404" }],
      });
      const failed = await runAutomation(watchlist(board));
      expect(failed.status).toBe("failed");
      expect(failed.errorMessage).toBe("All 1 boards unreachable");

      const none = await runAutomation({
        ...watchlist(board),
        sourceConfig: JSON.stringify({ [board]: { companies: [] } }),
      });
      expect(none.errorMessage).toBe("no_companies");
    },
  );
});
