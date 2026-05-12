import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CityAccessService,
  CityAccessError,
} from "./CityAccessService";
import { mockFetchResponse } from "../test/helpers";

// ---------------------------------------------------------------------------
// Mock supabase — CityAccessService dynamically imports it for the token
// ---------------------------------------------------------------------------
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "mock-token" } },
      }),
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTEXT = {
  userId: "user-123",
  tenantId: "tenant-abc",
  email: "user@example.com",
};

function makeCityList(names = ["London", "Paris"]): any[] {
  return names;
}

function getFreshInstance(): CityAccessService {
  // Reset the singleton so each test starts clean
  (CityAccessService as any).instance = undefined;
  return CityAccessService.getInstance();
}

// ---------------------------------------------------------------------------
// CityAccessError
// ---------------------------------------------------------------------------

describe("CityAccessError", () => {
  it("has the name 'CityAccessError'", () => {
    const err = new CityAccessError("FETCH_FAILED", "Something went wrong");
    expect(err.name).toBe("CityAccessError");
  });

  it("stores the code, message and optional details", () => {
    const details = { status: 403 };
    const err = new CityAccessError("NO_ACCESS", "No cities", details);
    expect(err.code).toBe("NO_ACCESS");
    expect(err.message).toBe("No cities");
    expect(err.details).toBe(details);
  });

  it("is an instance of Error", () => {
    expect(new CityAccessError("NETWORK_ERROR", "net")).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// getInstance — singleton
// ---------------------------------------------------------------------------

describe("CityAccessService.getInstance", () => {
  it("returns the same instance on multiple calls", () => {
    const a = CityAccessService.getInstance();
    const b = CityAccessService.getInstance();
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// getCachedCities
// ---------------------------------------------------------------------------

describe("getCachedCities", () => {
  it("returns an empty array when cache is empty", () => {
    const svc = getFreshInstance();
    expect(svc.getCachedCities()).toEqual([]);
  });

  it("returns a copy so mutations do not affect internal state", async () => {
    const svc = getFreshInstance();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse({ cities: ["London", "Paris"] })
      )
    );
    await svc.getCities(CONTEXT);
    const cities = svc.getCachedCities();
    cities.push("Tokyo" as any);
    // Internal array must be unchanged
    expect(svc.getCachedCities()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// isFetching
// ---------------------------------------------------------------------------

describe("isFetching", () => {
  it("returns false when no fetch is in-flight", () => {
    const svc = getFreshInstance();
    expect(svc.isFetching()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clearCache
// ---------------------------------------------------------------------------

describe("clearCache", () => {
  it("resets cities, currentTenantId, fetchPromise, lastFetchTime", async () => {
    const svc = getFreshInstance();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockFetchResponse({ cities: ["London"] }))
    );
    await svc.getCities(CONTEXT);
    expect(svc.getCachedCities()).toHaveLength(1);

    svc.clearCache();

    expect(svc.getCachedCities()).toEqual([]);
    expect(svc.isFetching()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// onTenantSwitch
// ---------------------------------------------------------------------------

describe("onTenantSwitch", () => {
  it("clears cache when the new tenant differs from the current one", async () => {
    const svc = getFreshInstance();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockFetchResponse({ cities: ["London"] }))
    );
    await svc.getCities(CONTEXT);
    expect(svc.getCachedCities()).toHaveLength(1);

    svc.onTenantSwitch("different-tenant");
    expect(svc.getCachedCities()).toEqual([]);
  });

  it("does NOT clear cache when the same tenant is provided", async () => {
    const svc = getFreshInstance();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockFetchResponse({ cities: ["London"] }))
    );
    await svc.getCities(CONTEXT);
    svc.onTenantSwitch(CONTEXT.tenantId); // same tenant
    expect(svc.getCachedCities()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getCities — full flow
// ---------------------------------------------------------------------------

describe("getCities", () => {
  beforeEach(() => {
    // Always start with a fresh instance so singleton cache doesn't leak
    (CityAccessService as any).instance = undefined;
  });

  it("throws CityAccessError(MISSING_TENANT) when tenantId is empty", async () => {
    const svc = CityAccessService.getInstance();
    await expect(
      svc.getCities({ ...CONTEXT, tenantId: "" })
    ).rejects.toMatchObject({ code: "MISSING_TENANT" });
  });

  it("returns cached cities when cache is still valid", async () => {
    const svc = CityAccessService.getInstance();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse({ cities: ["London"] }));
    vi.stubGlobal("fetch", fetchMock);

    await svc.getCities(CONTEXT);
    await svc.getCities(CONTEXT); // second call

    // fetch should only be called once — second call uses cache
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when the tenantId changes between calls", async () => {
    const svc = CityAccessService.getInstance();
    // Return a new Response each time so the body isn't exhausted
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(mockFetchResponse({ cities: ["London"] }))
      );
    vi.stubGlobal("fetch", fetchMock);

    await svc.getCities(CONTEXT);
    // Second call with different tenant — cache should be invalidated
    await svc.getCities({ ...CONTEXT, tenantId: "new-tenant" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("includes correct auth and tenant headers in the fetch call", async () => {
    const svc = CityAccessService.getInstance();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse({ cities: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await svc.getCities(CONTEXT);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers["Authorization"]).toBe("Bearer mock-token");
    expect(options.headers["X-Tenant-ID"]).toBe(CONTEXT.tenantId);
    expect(options.headers["X-User-ID"]).toBe(CONTEXT.userId);
  });

  it("stores the fetched cities and updates lastFetchTime", async () => {
    const svc = CityAccessService.getInstance();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockFetchResponse({ cities: ["London", "Paris"] }))
    );

    const result = await svc.getCities(CONTEXT);
    expect(result).toHaveLength(2);
    expect(svc.getCachedCities()).toHaveLength(2);
  });

  it("throws CityAccessError(MISSING_TENANT) on 400 response", async () => {
    const svc = CityAccessService.getInstance();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("bad", { status: 400 }))
    );

    await expect(svc.getCities(CONTEXT)).rejects.toMatchObject({
      code: "MISSING_TENANT",
    });
  });

  it("throws CityAccessError(NO_ACCESS) on 403 response", async () => {
    const svc = CityAccessService.getInstance();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 }))
    );

    await expect(svc.getCities(CONTEXT)).rejects.toMatchObject({
      code: "NO_ACCESS",
    });
  });

  it("throws CityAccessError(FETCH_FAILED) on other non-ok responses", async () => {
    const svc = CityAccessService.getInstance();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 502 }))
    );

    await expect(svc.getCities(CONTEXT)).rejects.toMatchObject({
      code: "FETCH_FAILED",
    });
  });

  it("wraps network errors in CityAccessError(NETWORK_ERROR)", async () => {
    const svc = CityAccessService.getInstance();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"))
    );

    await expect(svc.getCities(CONTEXT)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("deduplicates concurrent requests — only one fetch is made", async () => {
    const svc = CityAccessService.getInstance();

    let resolveFirst: (v: any) => void;
    const pendingResponse = new Promise<Response>((res) => {
      resolveFirst = res;
    });
    const fetchMock = vi.fn().mockReturnValue(pendingResponse);
    vi.stubGlobal("fetch", fetchMock);

    // Fire two concurrent calls
    const p1 = svc.getCities(CONTEXT);
    const p2 = svc.getCities(CONTEXT);

    // Resolve the pending fetch
    resolveFirst!(mockFetchResponse({ cities: ["London"] }));

    const [r1, r2] = await Promise.all([p1, p2]);

    // Both should get the same data
    expect(r1).toEqual(r2);
    // But only one HTTP request was made
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
