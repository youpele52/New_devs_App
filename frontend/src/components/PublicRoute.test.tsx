import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PublicRoute from "./PublicRoute";

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

function renderPublicRoute(
  authState: { user: any; status?: string },
  initialPath = "/login",
  locationState?: any
) {
  mockUseAuth.mockReturnValue(authState as any);

  return render(
    <MemoryRouter
      initialEntries={[{ pathname: initialPath, state: locationState }]}
    >
      <Routes>
        <Route path="/login" element={
          <PublicRoute>
            <div data-testid="login-content">Login form</div>
          </PublicRoute>
        } />
        <Route path="/dashboard" element={<div data-testid="dashboard" />} />
        <Route path="/properties" element={<div data-testid="properties" />} />
        <Route path="/" element={<div data-testid="home" />} />
      </Routes>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PublicRoute", () => {
  it("shows a loading spinner when auth status is 'initializing'", () => {
    renderPublicRoute({ user: null, status: "initializing" });

    expect(document.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByTestId("login-content")).toBeNull();
  });

  it("renders children when user is null (not authenticated)", () => {
    renderPublicRoute({ user: null, status: "unauthenticated" });

    expect(screen.getByTestId("login-content")).toBeInTheDocument();
  });

  it("redirects to '/' when user is already authenticated", () => {
    renderPublicRoute({ user: { id: "u1", email: "a@b.com" }, status: "authenticated" });

    // Should NOT render login content
    expect(screen.queryByTestId("login-content")).toBeNull();
    // Should have navigated to /
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });

  it("redirects to location.state.from.pathname when user is authenticated and it is set", () => {
    renderPublicRoute(
      { user: { id: "u1" }, status: "authenticated" },
      "/login",
      { from: { pathname: "/properties" } }
    );

    expect(screen.queryByTestId("login-content")).toBeNull();
    expect(screen.getByTestId("properties")).toBeInTheDocument();
  });

  it("does NOT render children when user is authenticated (no flashing content)", () => {
    renderPublicRoute({ user: { id: "u1" }, status: "authenticated" });

    expect(screen.queryByTestId("login-content")).toBeNull();
  });
});
