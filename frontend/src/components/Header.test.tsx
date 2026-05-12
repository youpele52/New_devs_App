import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Header from "./Header";
import { makeUser } from "../test/helpers";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../contexts/AuthContext.new", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../App", () => ({
  useSidebar: vi.fn(),
}));

vi.mock("../hooks/useBreadcrumbs", () => ({
  useBreadcrumbs: vi.fn().mockReturnValue([]),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { useAuth } from "../contexts/AuthContext.new";
import { useSidebar } from "../App";

const mockUseAuth = vi.mocked(useAuth);
const mockUseSidebar = vi.mocked(useSidebar);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSidebarCtx(overrides: Record<string, any> = {}) {
  return {
    isCollapsed: false,
    setIsCollapsed: vi.fn(),
    isMobileOpen: false,
    setIsMobileOpen: vi.fn(),
    submenuOpen: null,
    setSubmenuOpen: vi.fn(),
    ...overrides,
  };
}

function renderHeader(
  userOverrides: Record<string, any> | null = {},
  sidebarOverrides: Record<string, any> = {}
) {
  const signOut = vi.fn().mockResolvedValue(undefined);
  const user = userOverrides === null ? null : makeUser(userOverrides);

  mockUseAuth.mockReturnValue({ user, signOut, isAuthenticated: !!user, isLoading: false } as any);
  mockUseSidebar.mockReturnValue(buildSidebarCtx(sidebarOverrides) as any);

  return {
    signOut,
    ...render(
      <MemoryRouter>
        <Routes>
          <Route path="*" element={<Header />} />
        </Routes>
      </MemoryRouter>
    ),
  };
}

// ---------------------------------------------------------------------------
// User display
// ---------------------------------------------------------------------------

describe("Header — user display", () => {
  it("shows user.full_name when available", () => {
    renderHeader({ full_name: "Jane Doe", email: "jane@test.com" });
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("shows user.email when full_name is absent", () => {
    renderHeader({ email: "jane@test.com" });
    expect(screen.getByText("jane@test.com")).toBeInTheDocument();
  });

  it("shows 'User' fallback when neither full_name nor email is set", () => {
    renderHeader({ email: undefined });
    expect(screen.getByText("User")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// User menu
// ---------------------------------------------------------------------------

describe("Header — user menu", () => {
  it("user menu is closed by default", () => {
    renderHeader();
    // Profile and sign-out links should not be visible
    expect(screen.queryByText(/profile/i)).toBeNull();
    expect(screen.queryByText(/sign out/i)).toBeNull();
  });

  it("opens user menu when avatar button is clicked", () => {
    renderHeader();
    const avatarBtn = screen.getByLabelText(/user menu/i);
    fireEvent.click(avatarBtn);
    expect(screen.getByText(/profile/i)).toBeInTheDocument();
  });

  it("closes the user menu when clicking outside the menu container", async () => {
    renderHeader();

    const avatarBtn = screen.getByLabelText(/user menu/i);
    fireEvent.click(avatarBtn); // open
    expect(screen.getByText(/profile/i)).toBeInTheDocument();

    // Simulate mousedown outside the menu
    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByText(/profile/i)).toBeNull();
    });
  });

  it("shows 'Sign out' button in the open menu", () => {
    renderHeader();
    fireEvent.click(screen.getByLabelText(/user menu/i));
    expect(screen.getByText(/sign out/i)).toBeInTheDocument();
  });

  it("calls signOut when 'Sign out' is clicked", async () => {
    const { signOut } = renderHeader();
    fireEvent.click(screen.getByLabelText(/user menu/i));
    fireEvent.click(screen.getByText(/sign out/i));
    await waitFor(() => {
      expect(signOut).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Mobile menu button
// ---------------------------------------------------------------------------

describe("Header — mobile menu button", () => {
  it("calls setIsMobileOpen(true) when hamburger button is clicked", () => {
    const setIsMobileOpen = vi.fn();
    renderHeader({}, { setIsMobileOpen });

    const menuBtn = screen.getByLabelText(/open menu/i);
    fireEvent.click(menuBtn);

    expect(setIsMobileOpen).toHaveBeenCalledWith(true);
  });
});

// ---------------------------------------------------------------------------
// Breadcrumbs
// ---------------------------------------------------------------------------

describe("Header — breadcrumbs", () => {
  it("renders breadcrumbs wrapper that is hidden on mobile", () => {
    renderHeader();
    // Breadcrumbs wrapper has hidden md:block class
    const breadcrumbContainer = document.querySelector(".hidden.md\\:block");
    expect(breadcrumbContainer).not.toBeNull();
  });
});
