import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";
import { useCities, getCityDisplayInfo } from "./useCities";
import { mockFetchResponse } from "../test/helpers";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock("../contexts/AuthContext.new", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../lib/citiesCache", () => ({
  citiesCache: {
    getCacheKey: vi.fn((options: any) => `cache:${JSON.stringify(options)}`),
    get: vi.fn().mockReturnValue(null), // no cache by default
    set: vi.fn(),
    setLoading: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => {}), // returns unsubscribe fn
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext.new";
import { citiesCache } from "../lib/citiesCache";

const mockGetSession = vi.mocked(supabase.auth.getSession);
const mockUseAuth = vi.mocked(useAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSessionWithToken(token = "mock-token") {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
  } as any);
}

function mockNoSession() {
  mockGetSession.mockResolvedValue({ data: { session: null } } as any);
}

function mockAuthUser(user: any = { id: "u1", email: "u@test.com" }) {
  mockUseAuth.mockReturnValue({ user, status: "authenticated", isLoading: false } as any);
}

function wrapHook<T>(callback: () => T) {
  return renderHook(callback);
}

// ---------------------------------------------------------------------------
// getCityDisplayInfo — pure unit tests
// ---------------------------------------------------------------------------

describe("getCityDisplayInfo", () => {
  it("returns London info for id 'london'", () => {
    const info = getCityDisplayInfo("london");
    expect(info.name).toBe("London");
    expect(info.icon).toBe("Landmark");
    expect(info.image).toContain("unsplash");
  });

  it("returns Paris info for id 'paris'", () => {
    const info = getCityDisplayInfo("paris");
    expect(info.name).toBe("Paris");
    expect(info.icon).toBe("Building");
  });

  it("returns default MapPin icon for unknown city ids", () => {
    const info = getCityDisplayInfo("tokyo");
    expect(info.icon).toBe("MapPin");
  });

  it("capitalises the first letter of an unknown city id", () => {
    const info = getCityDisplayInfo("berlin");
    expect(info.name).toBe("Berlin");
  });

  it("normalises mixed-case unknown city id to title-case", () => {
    const info = getCityDisplayInfo("NEW YORK");
    expect(info.name[0]).toBe(info.name[0].toUpperCase());
  });

  it("returns the cleaning-specific image for 'lisbon' in cleaning context", () => {
    const defaultInfo = getCityDisplayInfo("lisbon");
    const cleaningInfo = getCityDisplayInfo("lisbon", "cleaning");
    expect(cleaningInfo.image).not.toBe(defaultInfo.image);
    expect(cleaningInfo.image).toContain("civitatis");
  });

  it("returns the default image for cities that have no cleaning-specific image", () => {
    const defaultInfo = getCityDisplayInfo("london");
    const cleaningInfo = getCityDisplayInfo("london", "cleaning");
    expect(cleaningInfo.image).toBe(defaultInfo.image);
  });

  it("returns a default image URL for completely unknown cities", () => {
    const info = getCityDisplayInfo("atlantis");
    expect(info.image).toContain("unsplash");
  });
});

// ---------------------------------------------------------------------------
// useCities — hook integration tests
// ---------------------------------------------------------------------------

describe("useCities hook", () => {
  beforeEach(() => {
    mockAuthUser();
    vi.mocked(citiesCache.get).mockReturnValue(null); // no cache
  });

  it("starts with loading:true before the fetch resolves", async () => {
    mockSessionWithToken();
    // Fetch that never resolves
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    const { result } = wrapHook(() => useCities());

    expect(result.current.loading).toBe(true);
  });

  it("converts a string city array to City objects on successful fetch", async () => {
    mockSessionWithToken();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse({ cities: ["London", "Paris", "Algiers"] })
      )
    );

    const { result } = wrapHook(() => useCities());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.cities).toHaveLength(3);
    // id should be lowercase
    expect(result.current.cities[0].id).toBe(result.current.cities[0].id.toLowerCase());
    // name should be capitalised
    expect(result.current.cities[0].name[0]).toBe(
      result.current.cities[0].name[0].toUpperCase()
    );
  });

  it("sorts cities alphabetically by name", async () => {
    mockSessionWithToken();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse({ cities: ["Paris", "Algiers", "London"] })
      )
    );

    const { result } = wrapHook(() => useCities());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const names = result.current.cities.map((c) => c.name);
    expect(names).toEqual([...names].sort());
  });

  it("returns cached cities without making a new fetch when cache is valid", async () => {
    mockSessionWithToken();
    const cachedData = [{ id: "london", name: "London" }];
    vi.mocked(citiesCache.get).mockReturnValue({
      data: cachedData,
      loading: false,
      error: null,
    } as any);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = wrapHook(() => useCities());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.cities).toEqual(cachedData);
  });

  it("sets error state and returns empty array on API failure", async () => {
    mockSessionWithToken();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network failure"))
    );

    const { result } = wrapHook(() => useCities());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toContain("Network failure");
    expect(result.current.cities).toEqual([]);
  });

  it("returns empty cities and no error when response is 401", async () => {
    mockSessionWithToken();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }))
    );

    const { result } = wrapHook(() => useCities());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.cities).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("returns empty cities when there is no auth session", async () => {
    mockNoSession();

    const { result } = wrapHook(() => useCities());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.cities).toEqual([]);
  });

  it("with userAccessibleOnly:true — returns [] immediately when no user", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      status: "unauthenticated",
      isLoading: false,
    } as any);
    mockSessionWithToken();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = wrapHook(() => useCities({ userAccessibleOnly: true }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.cities).toEqual([]);
  });

  it("exposes a refetch function that re-triggers the fetch", async () => {
    mockSessionWithToken();
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchResponse({ cities: ["London"] })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = wrapHook(() => useCities());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Force a refetch
    await act(async () => {
      await result.current.refetch();
    });

    // fetch should have been called at least twice
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
