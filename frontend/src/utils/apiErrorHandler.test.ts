import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import { classifyError, withRetry, safeFetch } from "./apiErrorHandler";

// ---------------------------------------------------------------------------
// Mock react-hot-toast so toast.error() doesn't blow up in jsdom
// ---------------------------------------------------------------------------
vi.mock("react-hot-toast", () => ({
  default: { error: vi.fn(), success: vi.fn() },
  toast: { error: vi.fn(), success: vi.fn() },
}));

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

describe("classifyError", () => {
  let onlineSpy: MockInstance;

  beforeEach(() => {
    // Default: navigator is online
    onlineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  afterEach(() => {
    onlineSpy.mockRestore();
  });

  it("returns NETWORK_OFFLINE when navigator.onLine is false", () => {
    onlineSpy.mockReturnValue(false);
    const err = classifyError(new Error("anything"));
    expect(err.code).toBe("NETWORK_OFFLINE");
    expect(err.retryable).toBe(true);
    expect(err.temporary).toBe(true);
  });

  it("returns NETWORK_ERROR for TypeError('Failed to fetch')", () => {
    const err = classifyError(new TypeError("Failed to fetch"));
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.retryable).toBe(true);
  });

  it("returns BAD_REQUEST for status 400", () => {
    const err = classifyError({ status: 400 });
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.retryable).toBe(false);
  });

  it("returns UNAUTHORIZED for status 401", () => {
    const err = classifyError({ status: 401 });
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.retryable).toBe(false);
  });

  it("returns FORBIDDEN for status 403", () => {
    const err = classifyError({ status: 403 });
    expect(err.code).toBe("FORBIDDEN");
    expect(err.retryable).toBe(false);
  });

  it("returns NOT_FOUND for status 404", () => {
    const err = classifyError({ status: 404 });
    expect(err.code).toBe("NOT_FOUND");
    expect(err.retryable).toBe(false);
  });

  it("returns REQUEST_TIMEOUT for status 408", () => {
    const err = classifyError({ status: 408 });
    expect(err.code).toBe("REQUEST_TIMEOUT");
    expect(err.retryable).toBe(true);
    expect(err.temporary).toBe(true);
  });

  it("returns RATE_LIMITED for status 429", () => {
    const err = classifyError({ status: 429 });
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryable).toBe(true);
  });

  it("returns SERVER_ERROR for status 500", () => {
    const err = classifyError({ status: 500 });
    expect(err.code).toBe("SERVER_ERROR");
    expect(err.retryable).toBe(true);
    expect(err.temporary).toBe(true);
  });

  it("returns SERVER_ERROR for status 503", () => {
    const err = classifyError({ status: 503 });
    expect(err.code).toBe("SERVER_ERROR");
    expect(err.retryable).toBe(true);
  });

  it("returns PARSE_ERROR for SyntaxError", () => {
    const err = classifyError(new SyntaxError("unexpected token"));
    expect(err.code).toBe("PARSE_ERROR");
    expect(err.retryable).toBe(true);
  });

  it("returns CANCELLED for AbortError", () => {
    const err = classifyError({ name: "AbortError", message: "cancelled" });
    expect(err.code).toBe("CANCELLED");
    expect(err.retryable).toBe(true);
  });

  it("returns UNKNOWN_ERROR for generic unknown errors", () => {
    const err = classifyError({ message: "something weird" });
    expect(err.code).toBe("UNKNOWN_ERROR");
    expect(err.retryable).toBe(false);
  });

  it("includes the error message when available", () => {
    const err = classifyError({ status: 400, message: "Bad input" });
    expect(err.message).toContain("Bad input");
  });
});

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe("withRetry", () => {
  it("returns the result immediately on first-attempt success", async () => {
    const apiCall = vi.fn().mockResolvedValue("data");
    const result = await withRetry(apiCall, { maxRetries: 2 });
    expect(result).toBe("data");
    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it("retries once on a retryable error and succeeds on the second attempt", async () => {
    const apiCall = vi
      .fn()
      .mockRejectedValueOnce({ status: 503, code: "SERVER_ERROR" })
      .mockResolvedValueOnce("recovered");

    // Use fast delays so the test doesn't time out
    const result = await withRetry(apiCall, {
      maxRetries: 2,
      initialDelay: 1,
      maxDelay: 10,
      backoffMultiplier: 1,
    });

    expect(result).toBe("recovered");
    expect(apiCall).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all retries", async () => {
    const apiCall = vi
      .fn()
      .mockRejectedValue({ status: 500, retryable: true });

    await expect(
      withRetry(apiCall, {
        maxRetries: 3,
        initialDelay: 1,
        maxDelay: 10,
        backoffMultiplier: 1,
      })
    ).rejects.toMatchObject({ status: 500 });
    // Initial attempt + 3 retries = 4 total calls
    expect(apiCall).toHaveBeenCalledTimes(4);
  });

  it("does NOT retry on non-retryable errors (e.g., 401)", async () => {
    const apiCall = vi.fn().mockRejectedValue({ status: 401 });

    await expect(
      withRetry(apiCall, { maxRetries: 3, initialDelay: 1, maxDelay: 10, backoffMultiplier: 1 })
    ).rejects.toMatchObject({ status: 401 });
    // Only called once — no retries
    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it("calls the onRetry callback with the correct attempt number", async () => {
    const apiCall = vi
      .fn()
      .mockRejectedValueOnce({ status: 500 })
      .mockResolvedValueOnce("ok");

    const onRetry = vi.fn();
    await withRetry(
      apiCall,
      { maxRetries: 2, initialDelay: 1, maxDelay: 10, backoffMultiplier: 1 },
      onRetry
    );

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Object));
  });

  it("applies exponential backoff — attempt 2 delay is 2x attempt 1", async () => {
    const delays: number[] = [];

    // Override sleep by capturing setTimeout calls via fake timers
    // withRetry uses `const sleep = (ms) => new Promise(r => setTimeout(r, ms))`
    const apiCall = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce("done");

    // Wrap setTimeout to record delay values and still execute instantly
    const orig = global.setTimeout;
    global.setTimeout = ((fn: any, delay: number, ...args: any[]) => {
      if (typeof delay === "number" && delay > 10) delays.push(delay);
      return orig(fn, 0, ...args);
    }) as any;

    try {
      await withRetry(apiCall, {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 60000,
        backoffMultiplier: 2,
      });
    } finally {
      global.setTimeout = orig;
    }

    expect(delays[0]).toBe(1000); // first retry delay
    expect(delays[1]).toBe(2000); // second retry delay (2×)
  });
});

// ---------------------------------------------------------------------------
// safeFetch
// ---------------------------------------------------------------------------

describe("safeFetch", () => {
  it("returns the Response on a successful fetch", async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const response = await safeFetch("https://api.example.com/data");
    expect(response).toBe(mockResponse);
  });

  it("throws a classified error when the response is not ok", async () => {
    const notOkResponse = new Response("", { status: 500, statusText: "Server Error" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(notOkResponse));

    await expect(
      safeFetch("https://api.example.com/data", {}, {
        showErrorToast: false,
        retryConfig: { maxRetries: 0, initialDelay: 0, maxDelay: 0, backoffMultiplier: 1 },
      })
    ).rejects.toBeDefined();
  });

  it("aborts the request after the timeout ms", async () => {
    // Simulate a fetch that rejects with AbortError (what AbortController produces)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }))
    );

    await expect(
      safeFetch("https://api.example.com/slow", {}, { timeout: 50, showErrorToast: false })
    ).rejects.toBeDefined();
  });
});
