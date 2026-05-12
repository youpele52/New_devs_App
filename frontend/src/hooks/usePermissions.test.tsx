import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PermissionsProvider, usePermissions } from "./usePermissions";
import { makeUser, makePermission } from "../test/helpers";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../contexts/AuthContext.new", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../contexts/AppContext", () => ({
  useAppContext: vi.fn(),
}));

vi.mock("../lib/secureApi", () => ({
  SecureAPI: {
    getAuthMe: vi.fn().mockResolvedValue({ permissions: [], tenant_id: "t1" }),
  },
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { useAuth } from "../contexts/AuthContext.new";
import { useAppContext } from "../contexts/AppContext";

const mockUseAuth = vi.mocked(useAuth);
const mockUseAppContext = vi.mocked(useAppContext);

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

function makeDefaultAuth(overrides: Record<string, any> = {}) {
  return {
    user: makeUser(),
    tenantId: "tenant-abc",
    status: "authenticated",
    isLoading: false,
    isAuthenticated: true,
    ...overrides,
  };
}

function makeDefaultAppCtx(overrides: Record<string, any> = {}) {
  return {
    permissions: [],
    isLoading: false,
    refreshData: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Consumer component to expose hook values
// ---------------------------------------------------------------------------

function PermConsumer({
  section,
  action,
  actions,
}: {
  section?: string;
  action?: string;
  actions?: string[];
}) {
  const { hasPermission, hasAnyPermission, loading, permissions } =
    usePermissions();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="perm-count">{permissions.length}</span>
      {section && action && (
        <span data-testid="has-perm">
          {String(hasPermission(section, action))}
        </span>
      )}
      {section && actions && (
        <span data-testid="has-any">
          {String(hasAnyPermission(section, actions))}
        </span>
      )}
    </div>
  );
}

function renderWithPermissions(
  ui: React.ReactElement,
  authOverrides: Record<string, any> = {},
  appCtxOverrides: Record<string, any> = {}
) {
  mockUseAuth.mockReturnValue(makeDefaultAuth(authOverrides) as any);
  mockUseAppContext.mockReturnValue(makeDefaultAppCtx(appCtxOverrides) as any);

  return render(
    <MemoryRouter>
      <PermissionsProvider>{ui}</PermissionsProvider>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// hasPermission — loading guard
// ---------------------------------------------------------------------------

describe("hasPermission — loading state", () => {
  it("returns false while AppContext is still loading", async () => {
    renderWithPermissions(
      <PermConsumer section="properties" action="read" />,
      {},
      { isLoading: true, permissions: [] }
    );

    // During loading, hasPermission should return false
    expect(screen.getByTestId("loading").textContent).toBe("true");
    expect(screen.getByTestId("has-perm").textContent).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// hasPermission — admin bypass
// ---------------------------------------------------------------------------

describe("hasPermission — admin access", () => {
  it("returns true for any section/action when user has app_metadata.role = admin", async () => {
    const adminUser = makeUser({ app_metadata: { role: "admin" } });
    renderWithPermissions(
      <PermConsumer section="super_secret" action="delete" />,
      { user: adminUser },
      { permissions: [], isLoading: false }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-perm").textContent).toBe("true");
    });
  });

  it("returns true for any section when user email is a hardcoded admin", async () => {
    const adminUser = makeUser({ email: "sid@theflexliving.com" });
    renderWithPermissions(
      <PermConsumer section="any_section" action="delete" />,
      { user: adminUser },
      { permissions: [], isLoading: false }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-perm").textContent).toBe("true");
    });
  });

  it("returns true when permissions contain the wildcard { section:'*', action:'*' }", async () => {
    renderWithPermissions(
      <PermConsumer section="properties" action="delete" />,
      {},
      {
        permissions: [{ section: "*", action: "*" }],
        isLoading: false,
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-perm").textContent).toBe("true");
    });
  });
});

// ---------------------------------------------------------------------------
// hasPermission — exact match
// ---------------------------------------------------------------------------

describe("hasPermission — exact match", () => {
  it("returns true for an exact section:action match in the permissions list", async () => {
    renderWithPermissions(
      <PermConsumer section="cleaning" action="read" />,
      {},
      {
        permissions: [{ section: "cleaning", action: "read" }],
        isLoading: false,
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-perm").textContent).toBe("true");
    });
  });

  it("returns false when the section exists but the action doesn't match", async () => {
    renderWithPermissions(
      <PermConsumer section="cleaning" action="delete" />,
      {},
      {
        permissions: [{ section: "cleaning", action: "read" }],
        isLoading: false,
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-perm").textContent).toBe("false");
    });
  });

  it("maps 'view' action in permissions to satisfy a 'read' check", async () => {
    renderWithPermissions(
      <PermConsumer section="reservations" action="read" />,
      {},
      {
        permissions: [{ section: "all_reservations", action: "view" }],
        isLoading: false,
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-perm").textContent).toBe("true");
    });
  });
});

// ---------------------------------------------------------------------------
// hasPermission — section normalisation
// ---------------------------------------------------------------------------

describe("hasPermission — section aliases", () => {
  it("normalises 'reservations' → 'all_reservations'", async () => {
    renderWithPermissions(
      <PermConsumer section="reservations" action="read" />,
      {},
      {
        permissions: [{ section: "all_reservations", action: "read" }],
        isLoading: false,
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-perm").textContent).toBe("true");
    });
  });

  it("normalises 'property_details' → 'properties'", async () => {
    renderWithPermissions(
      <PermConsumer section="property_details" action="read" />,
      {},
      {
        permissions: [{ section: "properties", action: "read" }],
        isLoading: false,
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-perm").textContent).toBe("true");
    });
  });
});

// ---------------------------------------------------------------------------
// hasPermission — parent section inheritance
// ---------------------------------------------------------------------------

describe("hasPermission — property_maintenance parent", () => {
  it("grants access to property_appliances when property_maintenance:read is in permissions", async () => {
    renderWithPermissions(
      <PermConsumer section="property_appliances" action="read" />,
      {},
      {
        permissions: [{ section: "property_maintenance", action: "read" }],
        isLoading: false,
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-perm").textContent).toBe("true");
    });
  });
});

// ---------------------------------------------------------------------------
// hasPermission — keys section
// ---------------------------------------------------------------------------

describe("hasPermission — keys section", () => {
  it("returns true for keys:read when user has internal_keys:read", async () => {
    renderWithPermissions(
      <PermConsumer section="keys" action="read" />,
      {},
      {
        permissions: [{ section: "internal_keys", action: "read" }],
        isLoading: false,
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-perm").textContent).toBe("true");
    });
  });

  it("returns true for keys:read when user has lockbox:read", async () => {
    renderWithPermissions(
      <PermConsumer section="keys" action="read" />,
      {},
      {
        permissions: [{ section: "lockbox", action: "read" }],
        isLoading: false,
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-perm").textContent).toBe("true");
    });
  });
});

// ---------------------------------------------------------------------------
// hasAnyPermission
// ---------------------------------------------------------------------------

describe("hasAnyPermission", () => {
  it("returns false while loading", () => {
    renderWithPermissions(
      <PermConsumer section="properties" actions={["read", "create"]} />,
      {},
      { isLoading: true, permissions: [] }
    );

    expect(screen.getByTestId("has-any").textContent).toBe("false");
  });

  it("returns true for admin (wildcard)", async () => {
    renderWithPermissions(
      <PermConsumer section="properties" actions={["read", "delete"]} />,
      {},
      {
        permissions: [{ section: "*", action: "*" }],
        isLoading: false,
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-any").textContent).toBe("true");
    });
  });

  it("returns true if at least one action in the list is permitted", async () => {
    renderWithPermissions(
      <PermConsumer section="cleaning" actions={["create", "read"]} />,
      {},
      {
        permissions: [{ section: "cleaning", action: "read" }],
        isLoading: false,
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-any").textContent).toBe("true");
    });
  });

  it("returns false when none of the specified actions are permitted", async () => {
    renderWithPermissions(
      <PermConsumer section="cleaning" actions={["create", "delete"]} />,
      {},
      {
        permissions: [{ section: "cleaning", action: "read" }],
        isLoading: false,
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-any").textContent).toBe("false");
    });
  });
});

// ---------------------------------------------------------------------------
// PermissionsProvider — state management
// ---------------------------------------------------------------------------

describe("PermissionsProvider — state management", () => {
  it("loads permissions from AppContext when AppContext finishes loading", async () => {
    renderWithPermissions(
      <PermConsumer />,
      {},
      {
        permissions: [
          { section: "cleaning", action: "read" },
          { section: "properties", action: "update" },
        ],
        isLoading: false,
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId("perm-count").textContent).toBe("2");
    });
  });

  it("uses wildcard permissions for admin-email users as fallback", async () => {
    const adminUser = makeUser({ email: "sid@theflexliving.com" });
    renderWithPermissions(
      <PermConsumer section="any" action="read" />,
      { user: adminUser, status: "authenticated" },
      { permissions: [], isLoading: false }
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-perm").textContent).toBe("true");
    });
  });

  it("sets permissions to [] and loading to false when user is null", async () => {
    renderWithPermissions(
      <PermConsumer />,
      { user: null, status: "unauthenticated" },
      { permissions: [], isLoading: false }
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
      expect(screen.getByTestId("perm-count").textContent).toBe("0");
    });
  });
});
