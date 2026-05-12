import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TenantIsolationError, SecureAPIClient } from "./secureApi";
import { makeJWT, mockFetchResponse } from "../test/helpers";

// ---------------------------------------------------------------------------
// Mocks — must happen before the module is imported
// ---------------------------------------------------------------------------

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "mock-token" } },
      }),
    },
    from: vi.fn(),
  },
}));

vi.mock("../utils/sessionManager", () => ({
  sessionManager: {
    ensureValidSession: vi.fn().mockResolvedValue({ access_token: "mock-token" }),
    validateSession: vi.fn().mockResolvedValue({ isValid: true, session: { access_token: "mock-token" } }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a fresh SecureAPIClient instance (resets singleton between tests). */
function getFreshClient(): SecureAPIClient {
  (SecureAPIClient as any).instance = undefined;
  const instance = SecureAPIClient.getInstance();
  // Inject a known token so auth-header tests don't need a real session
  instance.setAccessToken(
    makeJWT({ sub: "user-1", email: "user@example.com", tenant_id: "11111111-1111-1111-1111-111111111111" })
  );
  return instance;
}

// ---------------------------------------------------------------------------
// TenantIsolationError
// ---------------------------------------------------------------------------

describe("TenantIsolationError", () => {
  it("has name === 'TenantIsolationError'", () => {
    const err = new TenantIsolationError("Direct query blocked");
    expect(err.name).toBe("TenantIsolationError");
  });

  it("is an instance of Error", () => {
    expect(new TenantIsolationError("x")).toBeInstanceOf(Error);
  });

  it("stores the message correctly", () => {
    const err = new TenantIsolationError("No direct DB access");
    expect(err.message).toBe("No direct DB access");
  });
});

// ---------------------------------------------------------------------------
// getInstance — singleton
// ---------------------------------------------------------------------------

describe("SecureAPIClient.getInstance", () => {
  beforeEach(() => {
    (SecureAPIClient as any).instance = undefined;
  });

  it("returns the same instance on multiple calls", () => {
    const a = SecureAPIClient.getInstance();
    const b = SecureAPIClient.getInstance();
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// clearCache
// ---------------------------------------------------------------------------

describe("clearCache", () => {
  it("empties requestCache and pendingRequests", () => {
    const client = getFreshClient();
    // Inject a fake cache entry so we can verify it's cleared
    (client as any).requestCache.set("key1", { data: {}, timestamp: Date.now() });
    (client as any).pendingRequests.set("key2", Promise.resolve());

    client.clearCache();

    expect((client as any).requestCache.size).toBe(0);
    expect((client as any).pendingRequests.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// clearEndpointCache
// ---------------------------------------------------------------------------

describe("clearEndpointCache", () => {
  it("removes only entries whose key contains the given pattern", () => {
    const client = getFreshClient();
    (client as any).requestCache.set("/api/v1/cleaning/list", { data: {}, timestamp: 0 });
    (client as any).requestCache.set("/api/v1/reservations/list", { data: {}, timestamp: 0 });

    const count = client.clearEndpointCache("cleaning");

    expect(count).toBe(1);
    expect((client as any).requestCache.has("/api/v1/cleaning/list")).toBe(false);
    expect((client as any).requestCache.has("/api/v1/reservations/list")).toBe(true);
  });

  it("returns 0 when no entries match the pattern", () => {
    const client = getFreshClient();
    (client as any).requestCache.set("/api/v1/properties", { data: {}, timestamp: 0 });

    expect(client.clearEndpointCache("non-existent-route")).toBe(0);
  });

  it("also clears matching pendingRequests entries", () => {
    const client = getFreshClient();
    (client as any).pendingRequests.set("/api/v1/cleaning", Promise.resolve());
    (client as any).pendingRequests.set("/api/v1/users", Promise.resolve());

    client.clearEndpointCache("cleaning");

    expect((client as any).pendingRequests.has("/api/v1/cleaning")).toBe(false);
    expect((client as any).pendingRequests.has("/api/v1/users")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setAccessToken — clears cache when token changes
// ---------------------------------------------------------------------------

describe("setAccessToken", () => {
  it("clears the cache when the token changes", () => {
    const client = getFreshClient();
    (client as any).requestCache.set("cached", { data: {}, timestamp: 0 });

    client.setAccessToken("different-token");

    expect((client as any).requestCache.size).toBe(0);
  });

  it("clears the cachedTenantId when the token changes", () => {
    const client = getFreshClient();
    (client as any).cachedTenantId = "tenant-abc";

    client.setAccessToken("new-token");

    expect((client as any).cachedTenantId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getAuthMe — integration (mocked fetch)
// ---------------------------------------------------------------------------

describe("SecureAPI.getAuthMe", () => {
  let client: SecureAPIClient;

  beforeEach(() => {
    client = getFreshClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes a GET request to /auth/me and returns parsed JSON", async () => {
    const me = { id: "user-1", email: "user@example.com", permissions: [], tenant_id: "t1" };
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(me));
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.getAuthMe();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/auth/me");
    expect(result.email).toBe("user@example.com");
  });

  it("includes an Authorization Bearer header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse({ id: "u1", permissions: [], tenant_id: "t1" })
      )
    );

    await client.getAuthMe();

    const [, opts] = vi.mocked(fetch).mock.calls[0];
    expect((opts as RequestInit).headers).toMatchObject(
      expect.objectContaining({ Authorization: expect.stringContaining("Bearer ") })
    );
  });
});

// ---------------------------------------------------------------------------
// Request deduplication
// ---------------------------------------------------------------------------

describe("request deduplication", () => {
  it("makes only one HTTP request when two concurrent GETs target the same endpoint", async () => {
    const client = getFreshClient();

    // Use a promise that we resolve manually to hold the fetch open
    let resolveRequest: (v: any) => void;
    const pendingResponse = new Promise<Response>((res) => {
      resolveRequest = res;
    });

    const fetchMock = vi.fn().mockReturnValue(pendingResponse);
    vi.stubGlobal("fetch", fetchMock);

    const p1 = client.getAuthMe();
    const p2 = client.getAuthMe();

    // Now resolve the single pending fetch
    resolveRequest!(mockFetchResponse({ id: "u1", permissions: [], tenant_id: "t1" }));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
  });
});
