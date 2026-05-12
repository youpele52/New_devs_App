import { describe, it, expect, vi, beforeEach } from "vitest";
import { signIn, signOut, getCurrentUser, changePassword, createUser } from "./auth";
import { makeUser, makeSession, makeQueryBuilder, mockFetchResponse } from "../test/helpers";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}));

vi.mock("./secureApi", () => ({
  SecureAPI: {
    getAuthMe: vi.fn(),
    createLog: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../utils/robustBootstrapFetcher", () => ({
  fetchBootstrapDataRobust: vi.fn(),
}));

vi.mock("./logging", () => ({
  createLog: vi.fn().mockResolvedValue(null),
}));

vi.mock("./fetchUserById", () => ({
  fetchUserById: vi.fn(),
  getUserInfoSafely: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { supabase } from "./supabase";
import { SecureAPI } from "./secureApi";
import { fetchBootstrapDataRobust } from "../utils/robustBootstrapFetcher";
import { createLog } from "./logging";

const mockGetSession = vi.mocked(supabase.auth.getSession);
const mockSignIn = vi.mocked(supabase.auth.signInWithPassword);
const mockSignOut = vi.mocked(supabase.auth.signOut);
const mockUpdateUser = vi.mocked(supabase.auth.updateUser);
const mockGetAuthMe = vi.mocked(SecureAPI.getAuthMe);
const mockBootstrap = vi.mocked(fetchBootstrapDataRobust);

// ---------------------------------------------------------------------------
// signIn
// ---------------------------------------------------------------------------

describe("signIn", () => {
  const MOCK_USER = makeUser({ email: "user@example.com" });
  const MOCK_SESSION = makeSession({ user: MOCK_USER });

  beforeEach(() => {
    mockSignIn.mockResolvedValue({
      user: MOCK_USER,
      session: MOCK_SESSION,
      error: null,
    } as any);

    mockBootstrap.mockResolvedValue({
      data: {
        user: { is_admin: false, cities: ["london", "paris"] },
        permissions: [{ section: "properties", action: "read" }],
        metadata: { tenant_id: "tenant-abc" },
      },
      source: "api",
      responseTime: 100,
    });
  });

  it("calls supabase.auth.signInWithPassword with trimmed credentials", async () => {
    await signIn("  user@example.com  ", "  secret123  ");
    expect(mockSignIn).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret123",
    });
  });

  it("returns enriched user with permissions, cities, tenantId on success", async () => {
    const result = await signIn("user@example.com", "secret");
    expect(result.error).toBeNull();
    expect(result.user.permissions).toEqual([{ section: "properties", action: "read" }]);
    expect(result.user.cities).toEqual(["london", "paris"]);
    expect(result.user.tenant_id).toBe("tenant-abc");
  });

  it("lowercases cities from bootstrap data", async () => {
    mockBootstrap.mockResolvedValue({
      data: {
        user: { is_admin: false, cities: ["LONDON", "Paris"] },
        permissions: [],
        metadata: { tenant_id: "t1" },
      },
      source: "api",
      responseTime: 10,
    });
    const result = await signIn("user@example.com", "pass");
    expect(result.user.cities).toEqual(["london", "paris"]);
  });

  it("marks isAdmin as true for a hardcoded admin email", async () => {
    const adminUser = makeUser({ email: "sid@theflexliving.com" });
    mockSignIn.mockResolvedValue({ user: adminUser, session: makeSession({ user: adminUser }), error: null } as any);
    const result = await signIn("sid@theflexliving.com", "pass");
    expect(result.user.isAdmin).toBe(true);
  });

  it("falls back to SecureAPI.getAuthMe when bootstrap fails", async () => {
    mockBootstrap.mockRejectedValue(new Error("bootstrap down"));
    mockGetAuthMe.mockResolvedValue({
      is_admin: false,
      permissions: [{ section: "cleaning", action: "read" }],
      cities: ["berlin"],
    } as any);

    const result = await signIn("user@example.com", "pass");
    expect(result.error).toBeNull();
    expect(result.user.permissions).toEqual([{ section: "cleaning", action: "read" }]);
  });

  it("returns { user: null, error: message } when supabase returns an error", async () => {
    mockSignIn.mockResolvedValue({
      user: null,
      session: null,
      error: new Error("Invalid login credentials"),
    } as any);

    const result = await signIn("bad@email.com", "wrong");
    expect(result.user).toBeNull();
    expect(result.error).toBe("Invalid login credentials");
  });

  it("returns forcePasswordChange: true when user_metadata flag is set", async () => {
    const forcedUser = makeUser({
      user_metadata: { force_password_change: true, tenant_id: "t1" },
    });
    mockSignIn.mockResolvedValue({
      user: forcedUser,
      session: makeSession({ user: forcedUser }),
      error: null,
    } as any);
    const result = await signIn("user@example.com", "pass");
    expect(result.forcePasswordChange).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// signOut
// ---------------------------------------------------------------------------

describe("signOut", () => {
  it("calls supabase.auth.signOut", async () => {
    mockSignOut.mockResolvedValue({ error: null } as any);
    await signOut();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("re-throws when supabase.auth.signOut returns an error", async () => {
    mockSignOut.mockResolvedValue({ error: new Error("Sign out failed") } as any);
    await expect(signOut()).rejects.toThrow("Sign out failed");
  });
});

// ---------------------------------------------------------------------------
// getCurrentUser
// ---------------------------------------------------------------------------

describe("getCurrentUser", () => {
  const SESSION = makeSession();

  it("returns null when there is no active session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } } as any);
    const user = await getCurrentUser();
    expect(user).toBeNull();
  });

  it("returns enriched user with permissions and cities from getAuthMe", async () => {
    mockGetSession.mockResolvedValue({ data: { session: SESSION } } as any);
    mockGetAuthMe.mockResolvedValue({
      is_admin: false,
      permissions: [{ section: "reservations", action: "read" }],
      cities: ["Madrid"],
    } as any);

    const user = await getCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.permissions).toEqual([{ section: "reservations", action: "read" }]);
    expect(user!.cities).toEqual(["madrid"]); // lowercased
  });

  it("returns null when an error is thrown (does not propagate)", async () => {
    mockGetSession.mockRejectedValue(new Error("network error"));
    const user = await getCurrentUser();
    expect(user).toBeNull();
  });

  it("adds extra key permissions for admin emails", async () => {
    const adminSession = makeSession({
      user: makeUser({ email: "sid@theflexliving.com" }),
    });
    mockGetSession.mockResolvedValue({ data: { session: adminSession } } as any);
    mockGetAuthMe.mockResolvedValue({
      is_admin: true,
      permissions: [],
      cities: [],
    } as any);

    const user = await getCurrentUser();
    const sections = user!.permissions.map((p: any) => p.section);
    expect(sections).toContain("lockbox");
    expect(sections).toContain("internal_keys");
    expect(sections).toContain("keynest");
  });
});

// ---------------------------------------------------------------------------
// changePassword
// ---------------------------------------------------------------------------

describe("changePassword", () => {
  it("calls supabase.auth.updateUser with the new password and clears the force-change flag", async () => {
    mockUpdateUser.mockResolvedValue({
      data: { user: makeUser() },
      error: null,
    } as any);

    const result = await changePassword("NewSecure123!");

    expect(mockUpdateUser).toHaveBeenCalledWith({
      password: "NewSecure123!",
      data: { force_password_change: false },
    });
    expect(result.error).toBeNull();
  });

  it("returns { error: message } on failure", async () => {
    mockUpdateUser.mockResolvedValue({
      data: { user: null },
      error: new Error("Weak password"),
    } as any);

    const result = await changePassword("weak");
    expect(result.error).toBe("Weak password");
  });

  it("calls createLog on success", async () => {
    mockUpdateUser.mockResolvedValue({
      data: { user: makeUser() },
      error: null,
    } as any);
    vi.mocked(createLog).mockResolvedValue(null);

    await changePassword("StrongPass1!");
    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "update", section: "auth" })
    );
  });
});

// ---------------------------------------------------------------------------
// createUser
// ---------------------------------------------------------------------------

describe("createUser", () => {
  const BASE_ARGS = {
    email: "new@example.com",
    password: "SecureP@ss1",
    name: "New User",
    permissions: [{ section: "properties", action: "read" as const }],
    cities: ["london"],
  };

  beforeEach(() => {
    mockGetSession.mockResolvedValue({ data: { session: makeSession() } } as any);
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(mockFetchResponse({ userId: "new-user-456" }))   // POST /api/v1/users
        .mockResolvedValueOnce(new Response("", { status: 200 }))                // welcome email
    );
  });

  it("throws when cities is not an array", async () => {
    await expect(
      createUser({ ...BASE_ARGS, cities: "london" as any })
    ).resolves.toMatchObject({ error: expect.stringContaining("Cities") });
  });

  it("rejects an invalid phone format", async () => {
    const result = await createUser({ ...BASE_ARGS, phone: "07911123456" });
    expect(result.error).toContain("valid phone number");
  });

  it("accepts a valid E.164 phone number", async () => {
    const result = await createUser({ ...BASE_ARGS, phone: "+447911123456" });
    expect(result.error).toBeNull();
  });

  it("forces isAdmin = true for hardcoded admin emails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse({ userId: "admin-id" }));
    vi.stubGlobal("fetch", fetchMock);

    await createUser({ ...BASE_ARGS, email: "sid@theflexliving.com" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.isAdmin).toBe(true);
  });

  it("throws 'No active session' when there is no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } } as any);
    const result = await createUser(BASE_ARGS);
    expect(result.error).toContain("No active session");
  });

  it("returns { userId, error: null } on success", async () => {
    const result = await createUser(BASE_ARGS);
    expect(result.userId).toBe("new-user-456");
    expect(result.error).toBeNull();
  });

  it("propagates error detail from backend response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Email already registered" }), {
          status: 400,
        })
      )
    );
    const result = await createUser(BASE_ARGS);
    expect(result.error).toContain("Email already registered");
  });

  it("still returns success even if the welcome email fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(mockFetchResponse({ userId: "u1" }))
        .mockRejectedValueOnce(new Error("email service down"))
    );
    const result = await createUser(BASE_ARGS);
    expect(result.userId).toBe("u1");
    expect(result.error).toBeNull();
  });
});
