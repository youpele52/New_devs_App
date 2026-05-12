import { describe, it, expect, vi, beforeEach } from "vitest";
import { profileService } from "./profileService";
import { mockFetchResponse } from "../test/helpers";

// ---------------------------------------------------------------------------
// Mock supabase auth — profileService uses it to get the access token
// ---------------------------------------------------------------------------
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

// Mock apiBase so we have a predictable base URL in tests
vi.mock("../lib/apiBase", () => ({
  getApiBase: vi.fn(() => "http://localhost:8000"),
}));

import { supabase } from "../lib/supabase";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSession(token = "mock-token") {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: { access_token: token } },
  } as any);
}

function noSession() {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: null },
  } as any);
}

const PROFILE_RESPONSE = {
  profile: {
    id: "profile-1",
    user_id: "user-123",
    display_name: "Test User",
    timezone: "UTC",
    language: "en",
    theme: "light",
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
  },
  preferences: {
    id: "pref-1",
    user_id: "user-123",
    notification_email: true,
    notification_push: false,
    notification_desktop: false,
    notification_sound: false,
    auto_refresh: true,
    compact_view: false,
    sidebar_collapsed: false,
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
  },
  notification_preferences: [],
  unread_count: 0,
};

// ---------------------------------------------------------------------------
// getAuthHeaders (tested via behaviour of public methods)
// ---------------------------------------------------------------------------

describe("profileService — getAuthHeaders", () => {
  it("throws 'No active session' when there is no session", async () => {
    noSession();
    await expect(profileService.getProfile()).rejects.toThrow(
      "No active session"
    );
  });
});

// ---------------------------------------------------------------------------
// getProfile
// ---------------------------------------------------------------------------

describe("profileService.getProfile", () => {
  beforeEach(() => {
    mockSession();
  });

  it("makes a GET request to /api/v1/profile with the auth header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse(PROFILE_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);

    await profileService.getProfile();

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/profile");
    expect(opts.method).toBe("GET");
    expect(opts.headers["Authorization"]).toBe("Bearer mock-token");
  });

  it("returns the parsed ProfileResponse on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockFetchResponse(PROFILE_RESPONSE))
    );
    const result = await profileService.getProfile();
    expect(result.profile.display_name).toBe("Test User");
    expect(result.unread_count).toBe(0);
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not found", { status: 404, statusText: "Not Found" }))
    );
    await expect(profileService.getProfile()).rejects.toThrow(
      "Failed to fetch profile"
    );
  });
});

// ---------------------------------------------------------------------------
// updateProfile
// ---------------------------------------------------------------------------

describe("profileService.updateProfile", () => {
  beforeEach(() => {
    mockSession();
  });

  it("makes a PUT request to /api/v1/profile with the correct body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse(PROFILE_RESPONSE.profile));
    vi.stubGlobal("fetch", fetchMock);

    await profileService.updateProfile({ display_name: "New Name" });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/profile");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body)).toMatchObject({ display_name: "New Name" });
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 400, statusText: "Bad Request" }))
    );
    await expect(
      profileService.updateProfile({ display_name: "x" })
    ).rejects.toThrow("Failed to update profile");
  });
});

// ---------------------------------------------------------------------------
// updatePreferences
// ---------------------------------------------------------------------------

describe("profileService.updatePreferences", () => {
  beforeEach(() => {
    mockSession();
  });

  it("makes a PUT request to /api/v1/profile/preferences", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse(PROFILE_RESPONSE.preferences));
    vi.stubGlobal("fetch", fetchMock);

    await profileService.updatePreferences({ notification_email: false });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/profile/preferences");
    expect(opts.method).toBe("PUT");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 500, statusText: "Internal Server Error" }))
    );
    await expect(
      profileService.updatePreferences({ auto_refresh: true })
    ).rejects.toThrow("Failed to update preferences");
  });
});

// ---------------------------------------------------------------------------
// uploadAvatar
// ---------------------------------------------------------------------------

describe("profileService.uploadAvatar", () => {
  beforeEach(() => {
    mockSession();
  });

  it("makes a POST request to /api/v1/profile/avatar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockFetchResponse({ avatar_url: "https://cdn.example.com/avatar.png", message: "ok" })
      );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["data"], "avatar.png", { type: "image/png" });
    await profileService.uploadAvatar(file);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/profile/avatar");
    expect(opts.method).toBe("POST");
    // Should use FormData (multipart), NOT application/json
    expect(opts.headers?.["Content-Type"]).toBeUndefined();
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it("returns AvatarUploadResponse with avatar_url on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse({ avatar_url: "https://cdn.example.com/avatar.png", message: "ok" })
      )
    );
    const file = new File(["data"], "avatar.png", { type: "image/png" });
    const result = await profileService.uploadAvatar(file);
    expect(result.avatar_url).toBe("https://cdn.example.com/avatar.png");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 413, statusText: "Too Large" }))
    );
    const file = new File(["data"], "big.png", { type: "image/png" });
    await expect(profileService.uploadAvatar(file)).rejects.toThrow();
  });
});
