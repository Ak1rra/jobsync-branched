import page1 from "./fixtures/usajobs-search-page1.json";
import page2 from "./fixtures/usajobs-search-page2.json";
import empty from "./fixtures/usajobs-search-empty.json";

const mockResolveApiKey = vi.fn();
vi.mock("@/lib/api-key-resolver", () => ({
  resolveApiKey: (...args: unknown[]) => mockResolveApiKey(...args),
}));

import {
  buildUsajobsHeaders,
  buildUsajobsParams,
  buildUsajobsUrl,
  fetchUsajobsJobs,
  resolveUsajobsCredentials,
  searchUsajobsJobs,
  USAJOBS_NOT_CONFIGURED,
} from "@/lib/scraper/usajobs";
import { APP_CONSTANTS } from "@/lib/constants";
import type { UsajobsCredentials } from "@/lib/scraper/usajobs/types";

const KEY = "SECRET-KEY-1234567890";
const EMAIL = "jane.doe@example.com";
const creds: UsajobsCredentials = { apiKey: KEY, userAgentEmail: EMAIL };
const FILTERS = { keyword: "information technology" };
const PAGE_SIZE = APP_CONSTANTS.USAJOBS_PAGE_SIZE;

function res(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(init.headers),
    json: async () => body,
  } as Response;
}

function badJson(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  } as unknown as Response;
}

// A full page of n distinct, mappable items.
function fullPage(start: number, n: number, numberOfPages: number | string = 999) {
  return {
    SearchResult: {
      SearchResultCount: n,
      SearchResultCountAll: 100000,
      SearchResultItems: Array.from({ length: n }, (_, i) => ({
        MatchedObjectId: String(start + i),
        MatchedObjectDescriptor: {
          PositionTitle: `Job ${start + i}`,
          OrganizationName: "Agency",
          PositionURI: `https://www.usajobs.gov:443/job/${start + i}`,
        },
      })),
      UserArea: { NumberOfPages: numberOfPages },
    },
  };
}

// Deterministic, instant seams.
function seams() {
  return {
    sleep: vi.fn().mockResolvedValue(undefined),
    random: () => 0.5,
  };
}

function stubFetch(...responses: (Response | Error)[]) {
  const queue = [...responses];
  return vi.spyOn(global, "fetch").mockImplementation(() => {
    const next = queue.shift();
    if (!next) throw new Error("fetch called more times than stubbed");
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
}

afterEach(() => vi.restoreAllMocks());

describe("header construction", () => {
  it("sends Host, User-Agent (the email) and Authorization-Key", () => {
    expect(buildUsajobsHeaders(creds)).toEqual({
      Host: "data.usajobs.gov",
      "User-Agent": EMAIL,
      "Authorization-Key": KEY,
      Accept: "application/json",
    });
  });

  it("passes the headers to fetch and never puts the key in the URL", async () => {
    const spy = stubFetch(res(empty));
    await fetchUsajobsJobs(creds, FILTERS, seams());
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization-Key"]).toBe(KEY);
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(EMAIL);
    expect(url).not.toContain(KEY);
    expect(url).not.toContain("example.com");
    expect(url.startsWith("https://data.usajobs.gov/api/search?")).toBe(true);
  });
});

describe("param translation + URL encoding", () => {
  it("emits only the defaults for a bare keyword", () => {
    expect(buildUsajobsUrl({ keyword: "nurse" }, 1)).toBe(
      `https://data.usajobs.gov/api/search?Keyword=nurse&Fields=Full&ResultsPerPage=${PAGE_SIZE}&Page=1`,
    );
  });

  it("translates every filter to its documented parameter name and format", () => {
    const params = buildUsajobsParams(
      {
        keyword: "software",
        positionTitle: "Electrical Engineer",
        locationName: ["Atlanta, Georgia", "Norfolk Virginia"],
        radius: 75,
        organization: ["TR", "AF"],
        jobCategoryCode: ["2210", "0830"],
        remunerationMinimumAmount: 26000,
        remunerationMaximumAmount: 85000,
        payGradeLow: "7",
        payGradeHigh: "09",
        hiringPath: ["public", "fed-competitive"],
        whoMayApply: "public",
        remoteIndicator: true,
        positionScheduleTypeCode: [1, 2],
        positionOfferingTypeCode: ["15317"],
        securityClearanceRequired: [0, 1],
        datePosted: 30,
        sortField: "opendate",
        sortDirection: "desc",
        fields: "Min",
      },
      3,
      100,
    );
    expect(params).toEqual([
      ["Keyword", "software"],
      ["PositionTitle", "Electrical Engineer"],
      ["LocationName", "Atlanta, Georgia;Norfolk Virginia"],
      ["Radius", "75"],
      ["Organization", "TR;AF"],
      ["JobCategoryCode", "2210;0830"],
      ["RemunerationMinimumAmount", "26000"],
      ["RemunerationMaximumAmount", "85000"],
      ["PayGradeLow", "07"],
      ["PayGradeHigh", "09"],
      ["HiringPath", "public;fed-competitive"],
      ["WhoMayApply", "Public"],
      ["RemoteIndicator", "True"],
      ["PositionScheduleTypeCode", "1;2"],
      ["PositionOfferingTypeCode", "15317"],
      ["SecurityClearanceRequired", "0;1"],
      ["DatePosted", "30"],
      ["SortField", "opendate"],
      ["SortDirection", "Desc"],
      ["Fields", "Min"],
      ["ResultsPerPage", "100"],
      ["Page", "3"],
    ]);
  });

  it("sends RemoteIndicator=False to exclude remote jobs, and omits it when unset", () => {
    expect(buildUsajobsParams({ remoteIndicator: false }, 1, 50)).toContainEqual([
      "RemoteIndicator",
      "False",
    ]);
    expect(
      buildUsajobsParams({ keyword: "x" }, 1, 50).some(([k]) => k === "RemoteIndicator"),
    ).toBe(false);
  });

  it("percent-encodes spaces, separators and reserved characters", () => {
    const url = buildUsajobsUrl(
      { positionTitle: "R&D Engineer", locationName: ["Washington DC, District of Columbia", "Reno"] },
      1,
      50,
    );
    expect(url).toContain("PositionTitle=R%26D%20Engineer");
    expect(url).toContain(
      "LocationName=Washington%20DC%2C%20District%20of%20Columbia%3BReno",
    );
    expect(url).not.toContain("+");
    // Exactly one '?' and no stray raw separators inside values.
    expect(url.split("?")).toHaveLength(2);
    expect(url.split("&").length).toBe(5); // title, location, Fields, per-page, page
  });
});

describe("pagination", () => {
  it("fetches page 1 then 2 and stops at NumberOfPages", async () => {
    const spy = stubFetch(res(page1), res(page2));
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toContain("Page=1");
    expect(spy.mock.calls[1][0]).toContain("Page=2");
    expect(out.failure).toBeUndefined();
    expect(out.pagesFetched).toBe(2);
    expect(out.totalAvailable).toBe(5);
    expect(out.truncated).toBe(false);
    expect(out.jobs.map((j) => j.title)).toEqual([
      "IT Specialist (APPSW)",
      "Biological Science Technician",
      "Management Analyst",
      "Cybersecurity Specialist",
    ]);
    expect(out.skipped).toBe(1); // the item without a link
  });

  it("an empty result is a clean success with no further requests", async () => {
    const spy = stubFetch(res(empty));
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.jobs).toEqual([]);
    expect(out.failure).toBeUndefined();
  });

  it("stops when page >= NumberOfPages even though the page is full", async () => {
    const spy = stubFetch(res(fullPage(0, PAGE_SIZE, 1)));
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.jobs).toHaveLength(PAGE_SIZE);
    expect(out.truncated).toBe(false);
  });

  it("stops on a short page when NumberOfPages is absent", async () => {
    const body = fullPage(0, 3);
    delete (body.SearchResult as any).UserArea;
    (body.SearchResult as any).SearchResultCountAll = undefined;
    const spy = stubFetch(res(body));
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.jobs).toHaveLength(3);
  });

  it("stops at the page ceiling and flags the result truncated", async () => {
    let n = 0;
    const spy = vi.spyOn(global, "fetch").mockImplementation(() => {
      const body = fullPage(n * PAGE_SIZE, PAGE_SIZE);
      n++;
      return Promise.resolve(res(body));
    });
    const s = seams();
    const out = await fetchUsajobsJobs(creds, FILTERS, s);
    expect(spy).toHaveBeenCalledTimes(APP_CONSTANTS.USAJOBS_MAX_PAGES);
    expect(out.jobs.length).toBeLessThanOrEqual(APP_CONSTANTS.USAJOBS_MAX_RESULTS);
    expect(out.truncated).toBe(true);
    expect(out.failure).toBeUndefined();
    // Politeness delay between pages, not after the last.
    expect(s.sleep).toHaveBeenCalledTimes(APP_CONSTANTS.USAJOBS_MAX_PAGES - 1);
  });

  it("repeat-page guard: a server that ignores Page is cut off after the second identical page", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockImplementation(() => Promise.resolve(res(fullPage(0, PAGE_SIZE))));
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out.jobs).toHaveLength(PAGE_SIZE); // not doubled
  });
});

describe("client-side filters", () => {
  const withDates = (close: string | undefined, range?: [string, string]) => ({
    SearchResult: {
      SearchResultItems: [
        {
          MatchedObjectId: "1",
          MatchedObjectDescriptor: {
            PositionTitle: "T",
            OrganizationName: "O",
            PositionURI: "https://www.usajobs.gov/job/1",
            ApplicationCloseDate: close,
            PositionRemuneration: range
              ? [{ MinimumRange: range[0], MaximumRange: range[1], RateIntervalCode: "PA" }]
              : undefined,
          },
        },
      ],
      UserArea: { NumberOfPages: 1 },
    },
  });

  it("drops announcements whose close date has already passed", async () => {
    stubFetch(res(withDates("2026-01-01T00:00:00.0000")));
    const out = await fetchUsajobsJobs(creds, FILTERS, {
      ...seams(),
      now: () => Date.parse("2026-06-01T00:00:00Z"),
    });
    expect(out.jobs).toHaveLength(0);
    expect(out.skipped).toBe(1);
  });

  it("keeps an announcement with no close date", async () => {
    stubFetch(res(withDates(undefined)));
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());
    expect(out.jobs).toHaveLength(1);
  });

  it("re-checks the salary bounds against the actual annual range (buckets are coarse)", async () => {
    const f = { ...FILTERS, remunerationMinimumAmount: 90000 };
    stubFetch(res(withDates(undefined, ["40000", "60000"])));
    expect((await fetchUsajobsJobs(creds, f, seams())).jobs).toHaveLength(0);

    stubFetch(res(withDates(undefined, ["40000", "95000"])));
    expect((await fetchUsajobsJobs(creds, f, seams())).jobs).toHaveLength(1);

    const g = { ...FILTERS, remunerationMaximumAmount: 50000 };
    stubFetch(res(withDates(undefined, ["60000", "80000"])));
    expect((await fetchUsajobsJobs(creds, g, seams())).jobs).toHaveLength(0);
  });

  it("keeps jobs whose pay is unknown or not annual when a salary bound is set", async () => {
    const f = { ...FILTERS, remunerationMinimumAmount: 90000 };
    stubFetch(res(withDates(undefined)));
    expect((await fetchUsajobsJobs(creds, f, seams())).jobs).toHaveLength(1);
  });
});

describe("error classification and retries", () => {
  it.each([401, 403])("%i -> auth failure, not retried, not an empty success", async (status) => {
    const spy = stubFetch(res({}, { status }));
    const s = seams();
    const out = await fetchUsajobsJobs(creds, FILTERS, s);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(s.sleep).not.toHaveBeenCalled();
    expect(out.failure?.kind).toBe("auth");
    expect(out.failure?.status).toBe(status);
    expect(out.jobs).toEqual([]);
  });

  it("400 -> invalid_request, not retried", async () => {
    const spy = stubFetch(res({}, { status: 400 }));
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.failure?.kind).toBe("invalid_request");
  });

  it("other 4xx (404) -> invalid_request, not retried", async () => {
    const spy = stubFetch(res({}, { status: 404 }));
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.failure?.kind).toBe("invalid_request");
  });

  it("5xx then success -> retried once with jittered backoff, clean result", async () => {
    const spy = stubFetch(res({}, { status: 503 }), res(empty));
    const s = seams();
    const out = await fetchUsajobsJobs(creds, FILTERS, s);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out.failure).toBeUndefined();
    // base 500ms, equal jitter with random=0.5 -> 250 + 125
    expect(s.sleep).toHaveBeenCalledTimes(1);
    expect(s.sleep.mock.calls[0][0]).toBe(375);
  });

  it("persistent 5xx -> bounded attempts, exponential delays capped, server failure", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockImplementation(() => Promise.resolve(res({}, { status: 502 })));
    const s = seams();
    const out = await fetchUsajobsJobs(creds, FILTERS, { ...s, maxAttempts: 4 });
    expect(spy).toHaveBeenCalledTimes(4);
    const delays = s.sleep.mock.calls.map((c) => c[0] as number);
    expect(delays).toEqual([375, 750, 1500]);
    expect(delays.every((d) => d <= APP_CONSTANTS.USAJOBS_RETRY_MAX_DELAY_MS)).toBe(true);
    expect(out.failure).toMatchObject({ kind: "server", status: 502 });
    expect(out.jobs).toEqual([]);
  });

  it("429 with a short Retry-After waits that long and retries", async () => {
    const spy = stubFetch(res({}, { status: 429, headers: { "Retry-After": "2" } }), res(empty));
    const s = seams();
    const out = await fetchUsajobsJobs(creds, FILTERS, s);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(s.sleep.mock.calls[0][0]).toBe(2000);
    expect(out.failure).toBeUndefined();
  });

  it("429 with a long Retry-After is not waited out: rate_limited with retryAfterSeconds", async () => {
    const spy = stubFetch(res({}, { status: 429, headers: { "Retry-After": "120" } }));
    const s = seams();
    const out = await fetchUsajobsJobs(creds, FILTERS, s);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(s.sleep).not.toHaveBeenCalled();
    expect(out.failure).toMatchObject({ kind: "rate_limited", retryAfterSeconds: 120 });
  });

  it("parses an HTTP-date Retry-After", async () => {
    const now = Date.parse("2026-10-12T00:00:00Z");
    stubFetch(
      res({}, { status: 429, headers: { "Retry-After": "Mon, 12 Oct 2026 00:00:03 GMT" } }),
      res(empty),
    );
    const s = seams();
    await fetchUsajobsJobs(creds, FILTERS, { ...s, now: () => now });
    expect(s.sleep.mock.calls[0][0]).toBe(3000);
  });

  it("persistent 429 without Retry-After exhausts attempts as rate_limited", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockImplementation(() => Promise.resolve(res({}, { status: 429 })));
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());
    expect(spy).toHaveBeenCalledTimes(APP_CONSTANTS.USAJOBS_MAX_ATTEMPTS);
    expect(out.failure?.kind).toBe("rate_limited");
  });

  it("network errors are retried, then reported without the raw error text", async () => {
    const boom = () => new Error(`connect failed using ${KEY} for ${EMAIL}`);
    const spy = stubFetch(boom(), boom(), boom());
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());
    expect(spy).toHaveBeenCalledTimes(3);
    expect(out.failure?.kind).toBe("network");
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(JSON.stringify(out)).not.toContain(EMAIL);
  });

  it("network error then success recovers", async () => {
    stubFetch(new Error("ECONNRESET"), res(empty));
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());
    expect(out.failure).toBeUndefined();
  });

  it("malformed JSON -> parse failure, not retried", async () => {
    const spy = stubFetch(badJson());
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.failure?.kind).toBe("parse");
  });

  it.each([
    ["no SearchResult", {}],
    ["null body", null],
    ["items not an array", { SearchResult: { SearchResultItems: "nope" } }],
    ["items missing", { SearchResult: { SearchResultCount: 1 } }],
  ])("unexpected shape (%s) -> parse failure", async (_label, body) => {
    stubFetch(res(body));
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());
    expect(out.failure?.kind).toBe("parse");
    expect(out.jobs).toEqual([]);
  });

  it("overall deadline: a hung request ends as a timeout failure", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal!.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );
    const out = await fetchUsajobsJobs(creds, FILTERS, { random: () => 0.5, timeoutMs: 20 });
    expect(out.failure?.kind).toBe("timeout");
  });

  it("overall deadline also bounds backoff waits (real sleep is abortable)", async () => {
    vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve(res({}, { status: 503 })),
    );
    const started = Date.now();
    const out = await fetchUsajobsJobs(creds, FILTERS, { random: () => 1, timeoutMs: 30 });
    expect(out.failure?.kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(400); // backoff would be 500-1000ms
  });
});

describe("partial failure mid-pagination", () => {
  it("returns the jobs fetched so far WITH a failure flag (never a clean fetch)", async () => {
    stubFetch(res(page1), res({}, { status: 500 }), res({}, { status: 500 }), res({}, { status: 500 }));
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());
    expect(out.jobs).toHaveLength(3);
    expect(out.pagesFetched).toBe(1);
    expect(out.failure).toMatchObject({ kind: "server", status: 500 });
  });

  it("an auth failure on page 2 also keeps page 1 flagged as partial", async () => {
    stubFetch(res(page1), res({}, { status: 401 }));
    const out = await fetchUsajobsJobs(creds, FILTERS, seams());
    expect(out.jobs).toHaveLength(3);
    expect(out.failure?.kind).toBe("auth");
  });

  it("a deadline during the inter-page delay keeps what was fetched, flagged as timeout", async () => {
    stubFetch(res(page1));
    const out = await fetchUsajobsJobs(creds, FILTERS, {
      random: () => 0.5,
      timeoutMs: 20,
      sleep: (_ms, signal) =>
        new Promise((_r, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    expect(out.jobs).toHaveLength(3);
    expect(out.failure?.kind).toBe("timeout");
  });
});

describe("external abort", () => {
  it("rejects with an AbortError when the caller's signal is already aborted", async () => {
    stubFetch(res(empty));
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchUsajobsJobs(creds, FILTERS, { ...seams(), signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts an in-flight request with an AbortError (not a timeout failure)", async () => {
    const controller = new AbortController();
    vi.spyOn(global, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal!.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
          setTimeout(() => controller.abort(), 5);
        }),
    );
    await expect(
      fetchUsajobsJobs(creds, FILTERS, { ...seams(), signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("WhoMayApply casing", () => {
  it.each([
    ["public", "Public"],
    ["status", "Status"],
    ["all", "All"],
  ] as const)("%s is sent as the documented %s", (value, wire) => {
    expect(buildUsajobsParams({ whoMayApply: value }, 1, 50)).toContainEqual([
      "WhoMayApply",
      wire,
    ]);
  });
});

describe("credentials", () => {
  beforeEach(() => mockResolveApiKey.mockReset());

  // Models resolveApiKey: a saved per-user row wins; envFallback:false stops
  // there; otherwise the env var answers (userId is undefined for env-only).
  function setup(
    own: { key?: string; email?: string },
    env: { key?: string; email?: string } = {},
  ) {
    mockResolveApiKey.mockImplementation(
      async (
        userId: string | undefined,
        provider: string,
        opts?: { envFallback?: boolean },
      ) => {
        const isKey = provider === "usajobs";
        const saved = userId ? (isKey ? own.key : own.email) : undefined;
        if (saved) return saved;
        if (opts?.envFallback === false) return undefined;
        return isKey ? env.key : env.email;
      },
    );
  }

  it("uses the pair the user saved, asking for saved values only", async () => {
    setup({ key: `  ${KEY} `, email: ` ${EMAIL}\n` }, { key: "ENVKEY", email: "env@example.com" });
    await expect(resolveUsajobsCredentials("u1")).resolves.toEqual({ credentials: creds });
    expect(mockResolveApiKey).toHaveBeenCalledWith("u1", "usajobs", { envFallback: false });
    expect(mockResolveApiKey).toHaveBeenCalledWith("u1", "usajobs_email", { envFallback: false });
  });

  it("uses the environment pair when the user saved neither", async () => {
    setup({}, { key: KEY, email: EMAIL });
    await expect(resolveUsajobsCredentials("u1")).resolves.toEqual({ credentials: creds });
  });

  it("never mixes sources: a saved key without a saved email ignores the server email", async () => {
    setup({ key: KEY }, { key: "ENVKEY", email: "env@example.com" });
    const out = await resolveUsajobsCredentials("u1");
    expect(out.credentials).toBeNull();
    expect(out.problem).toMatch(/registration email is not saved in Settings/);
  });

  it("names the missing saved API key when only the email was saved", async () => {
    setup({ email: EMAIL }, { key: "ENVKEY", email: "env@example.com" });
    const out = await resolveUsajobsCredentials("u1");
    expect(out.credentials).toBeNull();
    expect(out.problem).toMatch(/API key is not saved in Settings/);
  });

  it("requires both environment variables", async () => {
    setup({}, { key: KEY });
    const onlyKey = await resolveUsajobsCredentials("u1");
    expect(onlyKey.credentials).toBeNull();
    expect(onlyKey.problem).toMatch(/USAJOBS_USER_AGENT_EMAIL is missing/);

    setup({}, { email: EMAIL });
    const onlyEmail = await resolveUsajobsCredentials("u1");
    expect(onlyEmail.credentials).toBeNull();
    expect(onlyEmail.problem).toMatch(/USAJOBS_API_KEY is missing/);
  });

  it("reports nothing configured when neither source has anything", async () => {
    setup({}, {});
    const out = await resolveUsajobsCredentials("u1");
    expect(out.credentials).toBeNull();
    expect(out.problem).toMatch(/No USAJOBS credentials are configured/);
  });

  it.each([
    ["key with a space", "abc def", EMAIL, /API key saved in Settings is not valid/],
    ["key with a newline", "abc\ndef", EMAIL, /API key saved in Settings is not valid/],
    ["non-ASCII key", "k\u00e9y123", EMAIL, /API key saved in Settings is not valid/],
    ["non-email user agent", KEY, "not-an-email", /registration email saved in Settings is not a valid/],
  ])("rejects %s with a field-specific message that omits the value", async (_l, key, email, message) => {
    setup({ key, email });
    const out = await resolveUsajobsCredentials("u1");
    expect(out.credentials).toBeNull();
    expect(out.problem).toMatch(message);
    expect(out.problem).not.toContain(key);
  });

  it("names the environment as the source of an invalid environment key", async () => {
    setup({}, { key: "bad key", email: EMAIL });
    const out = await resolveUsajobsCredentials("u1");
    expect(out.problem).toMatch(/API key set in the server environment is not valid/);
  });

  it("searchUsajobsJobs without credentials reports usajobs_not_configured, a note, and never fetches", async () => {
    setup({}, {});
    const spy = vi.spyOn(global, "fetch");
    const out = await searchUsajobsJobs({ userId: "u1", config: FILTERS });
    expect(spy).not.toHaveBeenCalled();
    expect(out.jobs).toEqual([]);
    expect(out.errors).toEqual([{ token: "usajobs", reason: USAJOBS_NOT_CONFIGURED }]);
    expect(out.notes?.[0]).toMatch(/No USAJOBS credentials/);
  });

  it("searchUsajobsJobs surfaces a partial fetch as jobs + a credential-free error", async () => {
    setup({ key: KEY, email: EMAIL });
    stubFetch(
      res(page1),
      res({}, { status: 503 }),
      res({}, { status: 503 }),
      res({}, { status: 503 }),
    );
    const out = await searchUsajobsJobs({ userId: "u1", config: FILTERS });
    expect(out.jobs).toHaveLength(3);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].reason).toMatch(/returned 503/);
    expect(out.errors[0].reason).toMatch(/partial/);
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(JSON.stringify(out)).not.toContain(EMAIL);
  });

  it("searchUsajobsJobs on a 401 returns an error and no jobs (not an empty success)", async () => {
    setup({ key: KEY, email: EMAIL });
    stubFetch(res({}, { status: 401 }));
    const out = await searchUsajobsJobs({ userId: "u1", config: FILTERS });
    expect(out.jobs).toEqual([]);
    expect(out.errors[0].reason).toMatch(/returned 401/);
    expect(JSON.stringify(out)).not.toContain(KEY);
  });

  describe("result ceiling note", () => {
    const fillPages = () => {
      let n = 0;
      vi.spyOn(global, "fetch").mockImplementation(() => {
        const body = fullPage(n * PAGE_SIZE, PAGE_SIZE);
        n++;
        return Promise.resolve(res(body));
      });
    };

    it("is returned as a note (not an error) when the page ceiling is hit", async () => {
      setup({ key: KEY, email: EMAIL });
      fillPages();
      const prevDelay = APP_CONSTANTS.USAJOBS_PAGE_DELAY_MS;
      (APP_CONSTANTS as any).USAJOBS_PAGE_DELAY_MS = 0;
      try {
        const out = await searchUsajobsJobs({ userId: "u1", config: FILTERS });
        expect(out.errors).toEqual([]);
        expect(out.jobs.length).toBe(APP_CONSTANTS.USAJOBS_MAX_RESULTS);
        expect(out.notes).toHaveLength(1);
        expect(out.notes![0]).toMatch(
          /^Result ceiling reached: fetched 500 of 100000 matching announcements/,
        );
        expect(out.notes![0]).toMatch(/narrow your filters/);
      } finally {
        (APP_CONSTANTS as any).USAJOBS_PAGE_DELAY_MS = prevDelay;
      }
    });

    it("is absent when the search ended naturally", async () => {
      setup({ key: KEY, email: EMAIL });
      stubFetch(res(page1), res(page2));
      const prevDelay = APP_CONSTANTS.USAJOBS_PAGE_DELAY_MS;
      (APP_CONSTANTS as any).USAJOBS_PAGE_DELAY_MS = 0;
      try {
        const out = await searchUsajobsJobs({ userId: "u1", config: FILTERS });
        expect(out.notes).toEqual([]);
      } finally {
        (APP_CONSTANTS as any).USAJOBS_PAGE_DELAY_MS = prevDelay;
      }
    });
  });
});
