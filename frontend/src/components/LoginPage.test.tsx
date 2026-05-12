import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import LoginPage from "./LoginPage";

// ---------------------------------------------------------------------------
// Mock AuthContext
// ---------------------------------------------------------------------------

vi.mock("../contexts/AuthContext.new", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../contexts/AuthContext.new";
const mockUseAuth = vi.mocked(useAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAuthMock(overrides: Record<string, any> = {}) {
  return {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    signIn: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn(),
    ...overrides,
  };
}

function renderLoginPage(
  authOverrides: Record<string, any> = {},
  initialPath = "/login",
  locationState?: any
) {
  mockUseAuth.mockReturnValue(buildAuthMock(authOverrides) as any);

  return render(
    <MemoryRouter
      initialEntries={[{ pathname: initialPath, state: locationState }]}
    >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div data-testid="home" />} />
        <Route path="/dashboard" element={<div data-testid="dashboard" />} />
        <Route path="/properties" element={<div data-testid="properties" />} />
      </Routes>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("LoginPage — rendering", () => {
  it("renders the email input with label", () => {
    renderLoginPage();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it("renders the password input with label", () => {
    renderLoginPage();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("renders the submit button labeled 'Sign in'", () => {
    renderLoginPage();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("does not show an error banner on initial render", () => {
    renderLoginPage();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Auto-redirect when already authenticated
// ---------------------------------------------------------------------------

describe("LoginPage — redirect when already authenticated", () => {
  it("redirects to '/' when user is already set on mount", () => {
    renderLoginPage({ user: { id: "u1", email: "a@b.com" } });
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });

  it("redirects to location.state.from when provided", () => {
    renderLoginPage(
      { user: { id: "u1" } },
      "/login",
      { from: "/properties" }
    );
    expect(screen.getByTestId("properties")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Form submission
// ---------------------------------------------------------------------------

describe("LoginPage — form submission", () => {
  const user = userEvent.setup();

  it("calls signIn with the entered email and password on submit", async () => {
    const signIn = vi.fn().mockResolvedValue({ error: null });
    renderLoginPage({ signIn });

    await user.type(screen.getByLabelText(/email address/i), "user@test.com");
    await user.type(screen.getByLabelText(/password/i), "securepass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith("user@test.com", "securepass");
    });
  });

  it("disables the submit button while loading to prevent double-submit", async () => {
    // signIn never resolves — keeps us in loading state
    const signIn = vi.fn().mockReturnValue(new Promise(() => {}));
    renderLoginPage({ signIn });

    await user.type(screen.getByLabelText(/email address/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "pass");

    const btn = screen.getByRole("button", { name: /sign in/i });
    await user.click(btn);

    await waitFor(() => {
      expect(btn).toBeDisabled();
    });
  });

  it("shows 'Signing in...' text while the request is in-flight", async () => {
    const signIn = vi.fn().mockReturnValue(new Promise(() => {}));
    renderLoginPage({ signIn });

    await user.type(screen.getByLabelText(/email address/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "pass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/signing in/i)).toBeInTheDocument();
    });
  });

  it("shows an error message when signIn returns an error", async () => {
    const signIn = vi
      .fn()
      .mockResolvedValue({ error: new Error("Invalid login credentials") });
    renderLoginPage({ signIn });

    await user.type(screen.getByLabelText(/email address/i), "bad@user.com");
    await user.type(screen.getByLabelText(/password/i), "wrongpass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/invalid login credentials/i)
      ).toBeInTheDocument();
    });
  });

  it("clears the error on a subsequent submission attempt", async () => {
    // First call fails, second succeeds
    const signIn = vi
      .fn()
      .mockResolvedValueOnce({ error: new Error("Bad credentials") })
      .mockResolvedValue({ error: null });
    renderLoginPage({ signIn });

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const btn = screen.getByRole("button", { name: /sign in/i });

    // First submit — error appears
    await user.type(emailInput, "a@b.com");
    await user.type(passwordInput, "wrong");
    await user.click(btn);
    await waitFor(() =>
      expect(screen.getByText(/bad credentials/i)).toBeInTheDocument()
    );

    // Second submit — error should clear
    await user.click(btn);
    await waitFor(() =>
      expect(screen.queryByText(/bad credentials/i)).toBeNull()
    );
  });
});
