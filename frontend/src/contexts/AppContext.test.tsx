import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  AppProvider,
  useAppContext,
  usePermissions,
  useCompanySettings,
} from "./AppContext";
import { makeUser, makePermission } from "../test/helpers";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./AuthContext.new", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../lib/secureApi", () => ({
  SecureAPI: {
    getAuthMe: vi.fn(),
    getDepartments: vi.fn().mockResolvedValue([]),
    getCompanySettings: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../utils/StorageManager", () => ({
  storageManager: {
    setContext: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { useAuth } from "./AuthContext.new";
import { SecureAPI } from "../lib/secureApi";

const mockUseAuth = vi.mocked(useAuth);
const mockGetAuthMe = vi.mocked(SecureAPI.getAuthMe);
const mockGetDepartments = vi.mocked(SecureAPI.getDepartments);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAuthState(overrides: Record<string, any> = {}) {
  return {
    user: null,
    isLoading: false,
    isAuthenticated: false,
    refreshSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function AppConsumer() {
  const ctx = useAppContext();
  return (
    <div>
      <span data-testid="loading">{String(ctx.isLoading)}</span>
      <span data-testid="is-admin">{String(ctx.isAdmin)}</span>
      <span data-testid="perm-count">{ctx.permissions.length}</span>
      <span data-testid="tenant-id">{ctx.tenant?.id ?? "none"}</span>
      <span data-testid="error">{ctx.error ?? "none"}</span>
    </div>
  );
}

function renderAppProvider() {
  return render(
    <MemoryRouter>
      <AppProvider>
        <AppConsumer />
      </AppProvider>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// useAppContext — outside provider
// ---------------------------------------------------------------------------

describe("useAppContext outside AppProvider", () => {
  it("throws 'useAppContext must be used within AppProvider'", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <MemoryRouter>
          <AppConsumer />
        </MemoryRouter>
      )
    ).toThrow("useAppContext must be used within AppProvider");
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Unauthenticated state
// ---------------------------------------------------------------------------

describe("AppProvider when unauthenticated", () => {
  it("has isLoading:false, permissions:[], isAdmin:false when not authenticated", async () => {
    mockUseAuth.mockReturnValue(makeAuthState({ isLoading: false, isAuthenticated: false }) as any);

    renderAppProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("perm-count").textContent).toBe("0");
    expect(screen.getByTestId("is-admin").textContent).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// Authenticated — fresh permissions hydration
// ---------------------------------------------------------------------------

describe("AppProvider hydration on authentication", () => {
  beforeEach(() => {
    const user = makeUser({ email: "user@test.com" });
    mockUseAuth.mockReturnValue(
      makeAuthState({
        user,
        isLoading: false,
        isAuthenticated: true,
      }) as any
    );
  });

  it("calls SecureAPI.getAuthMe and populates permissions", async () => {
    mockGetAuthMe.mockResolvedValue({
      permissions: [{ section: "properties", action: "read" }],
      is_admin: false,
      tenant_id: "tenant-abc",
      departments: [],
    } as any);

    renderAppProvider();

    await waitFor(() => {
      expect(screen.getByTestId("perm-count").textContent).toBe("1");
    });
    expect(mockGetAuthMe).toHaveBeenCalled();
  });

  it("resolves the tenant ID from the /me response", async () => {
    mockGetAuthMe.mockResolvedValue({
      permissions: [],
      is_admin: false,
      tenant_id: "tenant-from-api",
      departments: [],
    } as any);

    renderAppProvider();

    await waitFor(() => {
      expect(screen.getByTestId("tenant-id").textContent).toBe("tenant-from-api");
    });
  });

  it("sets isAdmin:true when me.is_admin is true", async () => {
    mockGetAuthMe.mockResolvedValue({
      permissions: [],
      is_admin: true,
      tenant_id: "t1",
      departments: [],
    } as any);

    renderAppProvider();

    await waitFor(() => {
      expect(screen.getByTestId("is-admin").textContent).toBe("true");
    });
  });

  it("calls getDepartments() for admin users", async () => {
    mockGetAuthMe.mockResolvedValue({
      permissions: [],
      is_admin: true,
      tenant_id: "t1",
      departments: [],
    } as any);
    mockGetDepartments.mockResolvedValue([{ id: "dept-1", name: "Operations" }] as any);

    renderAppProvider();

    await waitFor(() => {
      expect(mockGetDepartments).toHaveBeenCalled();
    });
  });

  it("uses me.departments for non-admin users instead of getDepartments()", async () => {
    mockGetAuthMe.mockResolvedValue({
      permissions: [],
      is_admin: false,
      tenant_id: "t1",
      departments: [{ id: "d1", name: "Cleaning" }],
    } as any);

    renderAppProvider();

    await waitFor(() => {
      // getDepartments should NOT be called for non-admins
      expect(mockGetDepartments).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// isAdmin detection
// ---------------------------------------------------------------------------

describe("AppProvider isAdmin computation", () => {
  it("sets isAdmin:true for hardcoded admin emails", async () => {
    mockUseAuth.mockReturnValue(
      makeAuthState({
        user: makeUser({ email: "sid@theflexliving.com" }),
        isAuthenticated: true,
      }) as any
    );
    mockGetAuthMe.mockResolvedValue({
      permissions: [],
      is_admin: false, // even if API says false, email rule wins
      tenant_id: "t1",
      departments: [],
    } as any);

    renderAppProvider();

    await waitFor(() => {
      expect(screen.getByTestId("is-admin").textContent).toBe("true");
    });
  });

  it("sets isAdmin:true when permissions contain wildcard { section:'*', action:'*' }", async () => {
    mockUseAuth.mockReturnValue(
      makeAuthState({
        user: makeUser(),
        isAuthenticated: true,
      }) as any
    );
    mockGetAuthMe.mockResolvedValue({
      permissions: [{ section: "*", action: "*" }],
      is_admin: false,
      tenant_id: "t1",
      departments: [],
    } as any);

    renderAppProvider();

    await waitFor(() => {
      expect(screen.getByTestId("is-admin").textContent).toBe("true");
    });
  });
});

// ---------------------------------------------------------------------------
// hasPermission helper
// ---------------------------------------------------------------------------

describe("AppContext hasPermission", () => {
  function PermConsumer({ section, action }: { section: string; action: string }) {
    const { hasPermission } = useAppContext();
    return (
      <span data-testid="result">{String(hasPermission(section, action))}</span>
    );
  }

  it("returns true for a permission in the list", async () => {
    mockUseAuth.mockReturnValue(
      makeAuthState({ user: makeUser(), isAuthenticated: true }) as any
    );
    mockGetAuthMe.mockResolvedValue({
      permissions: [{ section: "cleaning", action: "read" }],
      is_admin: false,
      tenant_id: "t1",
      departments: [],
    } as any);

    render(
      <MemoryRouter>
        <AppProvider>
          <PermConsumer section="cleaning" action="read" />
        </AppProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("result").textContent).toBe("true");
    });
  });

  it("returns false for a permission not in the list", async () => {
    mockUseAuth.mockReturnValue(
      makeAuthState({ user: makeUser(), isAuthenticated: true }) as any
    );
    mockGetAuthMe.mockResolvedValue({
      permissions: [{ section: "cleaning", action: "read" }],
      is_admin: false,
      tenant_id: "t1",
      departments: [],
    } as any);

    render(
      <MemoryRouter>
        <AppProvider>
          <PermConsumer section="properties" action="delete" />
        </AppProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      // Wait for permissions to load
      expect(screen.getByTestId("result").textContent).toBeDefined();
    });
    // After loading, should be false for a non-matching section
    expect(screen.getByTestId("result").textContent).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// useCompanySettings hook
// ---------------------------------------------------------------------------

describe("useCompanySettings", () => {
  function SettingsConsumer() {
    const { companySettings, isLoading } = useCompanySettings();
    return (
      <div>
        <span data-testid="has-settings">{String(!!companySettings)}</span>
        <span data-testid="loading">{String(isLoading)}</span>
      </div>
    );
  }

  it("returns null companySettings when none are loaded", async () => {
    mockUseAuth.mockReturnValue(
      makeAuthState({ user: makeUser(), isAuthenticated: true }) as any
    );
    mockGetAuthMe.mockResolvedValue({
      permissions: [],
      is_admin: false,
      tenant_id: "t1",
      departments: [],
    } as any);
    vi.mocked(SecureAPI.getCompanySettings).mockResolvedValue(null);

    render(
      <MemoryRouter>
        <AppProvider>
          <SettingsConsumer />
        </AppProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("has-settings").textContent).toBe("false");
  });
});
