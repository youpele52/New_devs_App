import React from "react";
import { render, RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// User / session factories
// ---------------------------------------------------------------------------

export function makeUser(overrides: Record<string, any> = {}): any {
  return {
    id: "user-123",
    email: "test@example.com",
    user_metadata: {
      name: "Test User",
      tenant_id: "tenant-abc",
    },
    app_metadata: {
      role: "user",
      tenant_id: "tenant-abc",
    },
    tenant_id: "tenant-abc",
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeAdminUser(overrides: Record<string, any> = {}): any {
  return makeUser({
    email: "sid@theflexliving.com",
    app_metadata: { role: "admin", tenant_id: "tenant-abc" },
    ...overrides,
  });
}

export function makePermission(
  section: string,
  action: string
): { section: string; action: string } {
  return { section, action };
}

export function makeSession(overrides: Record<string, any> = {}): any {
  const user = overrides.user ?? makeUser();
  return {
    access_token: "mock-access-token",
    refresh_token: "mock-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    user,
    ...overrides,
  };
}

// Builds a minimal JWT-shaped token with a base64-encoded payload.
// NOT cryptographically valid — for decoding tests only.
export function makeJWT(payload: Record<string, any>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  // Remove base64 padding to match standard JWT format
  const body = btoa(JSON.stringify(payload)).replace(/=/g, "");
  return `${header}.${body}.fakesignature`;
}

// ---------------------------------------------------------------------------
// Auth context default value
// ---------------------------------------------------------------------------

export function makeAuthContextValue(overrides: Record<string, any> = {}): any {
  return {
    user: null,
    isLoading: false,
    isAuthenticated: false,
    status: "unauthenticated",
    tenantId: null,
    signIn: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue(undefined),
    refreshSession: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// App context default value
// ---------------------------------------------------------------------------

export function makeAppContextValue(overrides: Record<string, any> = {}): any {
  return {
    user: null,
    tenant: null,
    companySettings: null,
    permissions: [],
    modules: new Set<string>(),
    isLoading: false,
    error: null,
    isAdmin: false,
    hasPermission: vi.fn().mockReturnValue(false),
    hasModule: vi.fn().mockReturnValue(false),
    refreshData: vi.fn().mockResolvedValue(undefined),
    refreshDepartments: vi.fn().mockResolvedValue(undefined),
    departments: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

interface RenderWithRouterOptions extends Omit<RenderOptions, "wrapper"> {
  initialEntries?: string[];
}

/** Wrap UI in a plain MemoryRouter — no auth context. */
export function renderWithRouter(
  ui: React.ReactElement,
  { initialEntries = ["/"], ...options }: RenderWithRouterOptions = {}
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}

// ---------------------------------------------------------------------------
// Supabase query builder stub (chainable + thenable)
// ---------------------------------------------------------------------------

/**
 * Returns a mock Supabase query-builder that:
 * - Has chainable methods (.select, .insert, .delete, .eq, .gte, .lte, .order, .single)
 * - Is thenable — `await queryBuilder` resolves to `resolvedValue`
 */
export function makeQueryBuilder(resolvedValue: any = { data: null, error: null }) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(resolvedValue),
    // Makes `await builder` work
    then: (
      resolve: (v: any) => any,
      reject?: (e: any) => any
    ): Promise<any> => Promise.resolve(resolvedValue).then(resolve, reject),
  };
  return builder;
}

// ---------------------------------------------------------------------------
// Fetch response helpers
// ---------------------------------------------------------------------------

export function mockFetchResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function mockFetchError(message = "Network error"): never {
  throw new TypeError(message);
}
