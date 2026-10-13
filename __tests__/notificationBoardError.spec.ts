import {
  classifyBoardError,
  describeRunFailure,
} from "@/lib/notifications/boardError";

describe("classifyBoardError", () => {
  it.each([
    ["Board 'northwind' returned 404", "not_found"],
    ["Board 'northwind' returned 410", "not_found"],
    ["Board 'contoso' timed out", "timeout"],
    ["rate limited", "rate_limited"],
    ["rate limited (partial: kept 3 job(s) from 1 page(s))", "rate_limited"],
    ["USAJOBS returned 401 - the API key or registration email was rejected", "http_error"],
    ["USAJOBS returned 503", "http_error"],
    ["USAJOBS search timed out", "timeout"],
    ["USAJOBS returned a malformed response", "parse"],
    ["USAJOBS network error (ECONNRESET)", "network"],
    ["Board 'acme' returned 429", "rate_limited"],
    ["Board 'acme' returned 503", "http_error"],
    ["Board 'acme' malformed payload", "parse"],
    ["fetch failed", "network"],
  ])("%s -> %s", (reason, code) => {
    expect(classifyBoardError(reason)).toBe(code);
  });
});

describe("describeRunFailure", () => {
  it("translates the runner's error codes", () => {
    expect(describeRunFailure("resume_missing", null)).toMatch(/resume/i);
    expect(describeRunFailure("no_companies", null)).toMatch(/watchlist/i);
    expect(describeRunFailure(null, "source_removed")).toMatch(/removed/i);
    expect(describeRunFailure("usajobs_not_configured", null)).toMatch(
      /USAJOBS_API_KEY/,
    );
    expect(describeRunFailure("usajobs_invalid_config", null)).toMatch(/invalid/i);
  });

  it("passes a human message through unchanged", () => {
    expect(describeRunFailure("AI provider timed out", null)).toBe(
      "AI provider timed out",
    );
  });

  it("never returns an empty string", () => {
    expect(describeRunFailure(null, null)).toBe("Unknown error");
  });
});
