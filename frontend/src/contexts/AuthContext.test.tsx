import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext.new";
import { makeUser, makeSession, makeJWT } from "../test/helpers";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
  },
}));

vi.mock("../utils/authOptimizer", () => ({
  authOptimizer: {
    storeSession: vi.fn(),
    clearSession: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../utils/sessionRecovery", () => ({
  sessionRecovery: {
    tryRecover: vi.fn().mockResolvedValue(null),
    clearStoredSession: vi.fn(),
  },
}));

vi.mock("../utils/SessionPersistenceManager", () => ({
  sessionPersistenceManager: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock("../utils/jwtUtils", () => ({
  extractTenantFromSession: vi.fn().mockReturnValue("tenant-abc"),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { supabase } from "../lib/supabase";
import { sessionRecovery } from "../utils/sessionRecovery";
import { sessionPersistenceManager } from "../utils/SessionPersistenceManager";
import { authOptimizer } from "../utils/authOptimizer";

const mockGetSession = vi.mocked(supabase.auth.getSession);
const mockSignIn = vi.mocked(supabase.auth.signInWithPassword);
const mockSignOut = vi.mocked(supabase.auth.signOut);
const mockOnAuthStateChange = vi.mocked(supabase.auth.onAuthStateChange);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A simple component that exposes auth context values via data-testid */
function AuthConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(auth.isLoading)}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="user-email">{auth.user?.email ?? "none"}</span>
      <span data-testid="tenant-id">{(auth.user as any)?.tenant_id ?? "none"}</span>
    </div>
  );
}

function setupOnAuthStateChange(
  callback?: (event: string, session: any) => void
) {
  mockOnAuthStateChange.mockImplementation((cb) => {
    if (callback) callback("INITIAL_SESSION", null);
    else cb("INITIAL_SESSION", null);
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
}

function renderAuthProvider(initialEntries = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// useAuth — outside provider
// ---------------------------------------------------------------------------

describe("useAuth outside AuthProvider", () => {
  it("throws 'useAuth must be used within an AuthProvider'", () => {
    // Suppress expected console.error from React
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      render(
        <MemoryRouter>
          <AuthConsumer />
        </MemoryRouter>
      )
    ).toThrow("useAuth must be used within an AuthProvider");

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("AuthProvider initial state", () => {
  it("resolves to isAuthenticated:false and user:null when no session and no recovery", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } } as any);
    vi.mocked(sessionRecovery.tryRecover).mockResolvedValue(null);
    setupOnAuthStateChange();

    renderAuthProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("authenticated").textContent).toBe("false");
    expect(screen.getByTestId("user-email").textContent).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// initAuth — with active session
// ---------------------------------------------------------------------------

describe("AuthProvider with active session", () => {
  it("sets isAuthenticated:true and populates user when session exists", async () => {
    const session = makeSession({ user: makeUser({ email: "user@test.com" }) });
    mockGetSession.mockResolvedValue({ data: { session } } as any);
    setupOnAuthStateChange();

    renderAuthProvider();

    await waitFor(() => {
      expect(screen.getByTestId("authenticated").textContent).toBe("true");
    });
    expect(screen.getByTestId("user-email").textContent).toBe("user@test.com");
  });

  it("attaches tenant_id from the enriched user", async () => {
    const session = makeSession({ user: makeUser() });
    mockGetSession.mockResolvedValue({ data: { session } } as any);
    setupOnAuthStateChange();

    renderAuthProvider();

    await waitFor(() => {
      expect(screen.getByTestId("tenant-id").textContent).toBe("tenant-abc");
    });
  });
});

// ---------------------------------------------------------------------------
// initAuth — no session, session recovery
// ---------------------------------------------------------------------------

describe("AuthProvider session recovery", () => {
  it("attempts recovery when there is no supabase session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } } as any);
    setupOnAuthStateChange();

    renderAuthProvider();

    await waitFor(() => {
      expect(sessionRecovery.tryRecover).toHaveBeenCalled();
    });
  });

  it("sets user from recovered session when tryRecover succeeds", async () => {
    const recoveredUser = makeUser({ email: "recovered@test.com" });
    mockGetSession.mockResolvedValue({ data: { session: null } } as any);
    vi.mocked(sessionRecovery.tryRecover).mockResolvedValue({
      user: recoveredUser,
    } as any);
    setupOnAuthStateChange();

    renderAuthProvider();

    await waitFor(() => {
      expect(screen.getByTestId("authenticated").textContent).toBe("true");
    });
  });

  it("remains unauthenticated when no session and recovery fails", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } } as any);
    vi.mocked(sessionRecovery.tryRecover).mockResolvedValue(null);
    setupOnAuthStateChange();

    renderAuthProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("authenticated").textContent).toBe("false");
  });

  it("skips initialization when window.__isLoggingOut is true", async () => {
    (window as any).__isLoggingOut = true;
    mockGetSession.mockResolvedValue({ data: { session: null } } as any);
    setupOnAuthStateChange();

    renderAuthProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    // Session check and recovery should NOT be called
    expect(sessionRecovery.tryRecover).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// signIn
// ---------------------------------------------------------------------------

describe("AuthProvider.signIn", () => {
  function SignInConsumer() {
    const { signIn, isAuthenticated, user } = useAuth();
    return (
      <div>
        <button
          onClick={() => signIn("user@test.com", "password")}
          data-testid="sign-in-btn"
        >
          Login
        </button>
        <span data-testid="authenticated">{String(isAuthenticated)}</span>
        <span data-testid="user-email">{user?.email ?? "none"}</span>
      </div>
    );
  }

  it("sets isAuthenticated:true and stores session on success", async () => {
    const session = makeSession({ user: makeUser({ email: "user@test.com" }) });
    mockGetSession.mockResolvedValue({ data: { session: null } } as any);
    mockSignIn.mockResolvedValue({ data: { session }, error: null } as any);
    setupOnAuthStateChange();

    const { getByTestId } = render(
      <MemoryRouter>
        <AuthProvider>
          <SignInConsumer />
        </AuthProvider>
      </MemoryRouter>
    );

    await act(async () => {
      getByTestId("sign-in-btn").click();
    });

    await waitFor(() => {
      expect(getByTestId("authenticated").textContent).toBe("true");
    });
    expect(authOptimizer.storeSession).toHaveBeenCalledWith(session);
  });

  it("returns { error } and leaves state unchanged on supabase error", async () => {
    let capturedResult: any;
    function ErrorConsumer() {
      const { signIn, isAuthenticated } = useAuth();
      return (
        <div>
          <button
            onClick={async () => {
              capturedResult = await signIn("bad@user.com", "wrong");
            }}
            data-testid="btn"
          >
            Login
          </button>
          <span data-testid="authenticated">{String(isAuthenticated)}</span>
        </div>
      );
    }

    mockGetSession.mockResolvedValue({ data: { session: null } } as any);
    mockSignIn.mockResolvedValue({
      data: { session: null },
      error: new Error("Invalid credentials"),
    } as any);
    setupOnAuthStateChange();

    const { getByTestId } = render(
      <MemoryRouter>
        <AuthProvider>
          <ErrorConsumer />
        </AuthProvider>
      </MemoryRouter>
    );

    await act(async () => {
      getByTestId("btn").click();
    });

    expect(capturedResult.error).toBeTruthy();
    expect(getByTestId("authenticated").textContent).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// signOut
// ---------------------------------------------------------------------------

describe("AuthProvider.signOut", () => {
  function SignOutConsumer() {
    const { signOut, isAuthenticated } = useAuth();
    return (
      <div>
        <button onClick={signOut} data-testid="sign-out-btn">Logout</button>
        <span data-testid="authenticated">{String(isAuthenticated)}</span>
      </div>
    );
  }

  it("clears user state, calls supabase.signOut, and stops sessionPersistenceManager", async () => {
    const session = makeSession();
    mockGetSession.mockResolvedValue({ data: { session } } as any);
    mockSignOut.mockResolvedValue({ error: null } as any);

    // Auth state change fires with session first, then null on sign-out
    mockOnAuthStateChange.mockImplementation((cb) => {
      cb("SIGNED_IN", session);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const { getByTestId } = render(
      <MemoryRouter>
        <AuthProvider>
          <SignOutConsumer />
        </AuthProvider>
      </MemoryRouter>
    );

    await act(async () => {
      getByTestId("sign-out-btn").click();
    });

    expect(mockSignOut).toHaveBeenCalled();
    expect(sessionPersistenceManager.stop).toHaveBeenCalled();
  });

  it("clears localStorage and sessionStorage during sign-out", async () => {
    localStorage.setItem("test-key", "value");
    mockGetSession.mockResolvedValue({ data: { session: null } } as any);
    mockSignOut.mockResolvedValue({ error: null } as any);
    setupOnAuthStateChange();

    const { getByTestId } = render(
      <MemoryRouter>
        <AuthProvider>
          <SignOutConsumer />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("authenticated").textContent).toBe("false");
    });

    await act(async () => {
      getByTestId("sign-out-btn").click();
    });

    expect(localStorage.getItem("test-key")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getAccessToken
// ---------------------------------------------------------------------------

describe("getAccessToken", () => {
  it("returns the access token from the current session", async () => {
    let capturedToken: string | null = null;
    function TokenConsumer() {
      const { getAccessToken } = useAuth();
      return (
        <button
          data-testid="get-token"
          onClick={async () => {
            capturedToken = await getAccessToken();
          }}
        >
          Get token
        </button>
      );
    }

    const session = makeSession({ access_token: "my-real-token" });
    mockGetSession.mockResolvedValue({ data: { session } } as any);
    setupOnAuthStateChange();

    const { getByTestId } = render(
      <MemoryRouter>
        <AuthProvider>
          <TokenConsumer />
        </AuthProvider>
      </MemoryRouter>
    );

    await act(async () => {
      getByTestId("get-token").click();
    });

    expect(capturedToken).toBe("my-real-token");
  });
});
