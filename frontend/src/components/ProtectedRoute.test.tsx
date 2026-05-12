import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute.new";

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

function renderRoute(isLoading: boolean, isAuthenticated: boolean) {
  mockUseAuth.mockReturnValue({ isLoading, isAuthenticated } as any);

  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="/login" element={<div data-testid="login-page" />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <div data-testid="protected-content">Secret</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProtectedRoute", () => {
  it("renders a loading spinner and NOT children when isLoading is true", () => {
    renderRoute(true, false);

    // The spinner uses animate-spin class
    expect(document.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByTestId("protected-content")).toBeNull();
  });

  it("redirects to /login when isLoading is false and isAuthenticated is false", () => {
    renderRoute(false, false);

    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).toBeNull();
  });

  it("renders children when isLoading is false and isAuthenticated is true", () => {
    renderRoute(false, true);

    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
  });

  it("does NOT render children while loading even if isAuthenticated is true", () => {
    renderRoute(true, true);

    expect(screen.queryByTestId("protected-content")).toBeNull();
    expect(document.querySelector(".animate-spin")).not.toBeNull();
  });
});
