import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import Dashboard from "./Dashboard";

const { getDashboardProperties, getDashboardSummary } = vi.hoisted(() => ({
  getDashboardProperties: vi.fn(),
  getDashboardSummary: vi.fn(),
}));

vi.mock("../lib/secureApi", () => ({
  SecureAPI: {
    getDashboardProperties,
    getDashboardSummary,
  },
}));

function buildSummary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    property_id: "prop-001",
    property_name: "Beach House Alpha",
    total_revenue: "2250.000",
    currency: "USD",
    reservations_count: 4,
    reporting_month: 4,
    reporting_year: 2024,
    ...overrides,
  };
}

describe("Dashboard", () => {
  beforeEach(() => {
    getDashboardProperties.mockResolvedValue([
      { id: "prop-001", name: "Beach House Alpha" },
      { id: "prop-002", name: "City Apartment Downtown" },
    ]);
    getDashboardSummary.mockResolvedValue(buildSummary());
  });

  it("defaults to latest mode and shows the resolved reporting period from the API", async () => {
    render(<Dashboard />);

    await waitFor(() => {
      expect(getDashboardSummary).toHaveBeenCalled();
    });

    expect(screen.getByLabelText(/reporting period/i)).toHaveValue("latest");
    expect(screen.getByLabelText(/^month$/i)).toBeDisabled();
    expect(screen.getByLabelText(/^year$/i)).toBeDisabled();
    expect(screen.getByText("April 2024")).toBeInTheDocument();
    expect(getDashboardSummary).toHaveBeenCalledWith(
      "prop-001",
      expect.objectContaining({
        month: undefined,
        year: undefined,
        timestamp: expect.any(Number),
      }),
    );
  });

  it("sends explicit month and year when a custom period is selected and preserves it across property changes", async () => {
    const user = userEvent.setup();
    getDashboardSummary.mockImplementation((propertyId: string, options?: { month?: number; year?: number }) =>
      Promise.resolve(
        buildSummary({
          property_id: propertyId,
          property_name: propertyId === "prop-002" ? "City Apartment Downtown" : "Beach House Alpha",
          reporting_month: options?.month ?? 4,
          reporting_year: options?.year ?? 2024,
        }),
      ),
    );

    render(<Dashboard />);

    await waitFor(() => {
      expect(getDashboardSummary).toHaveBeenCalledTimes(1);
    });

    await user.selectOptions(screen.getByLabelText(/reporting period/i), "custom");
    await user.selectOptions(screen.getByLabelText(/^month$/i), "3");
    await user.selectOptions(screen.getByLabelText(/^year$/i), "2024");

    await waitFor(() => {
      expect(getDashboardSummary).toHaveBeenLastCalledWith(
        "prop-001",
        expect.objectContaining({
          month: 3,
          year: 2024,
          timestamp: expect.any(Number),
        }),
      );
    });

    await user.selectOptions(screen.getByLabelText(/select property/i), "prop-002");

    await waitFor(() => {
      expect(getDashboardSummary).toHaveBeenLastCalledWith(
        "prop-002",
        expect.objectContaining({
          month: 3,
          year: 2024,
          timestamp: expect.any(Number),
        }),
      );
    });

    expect(screen.getByText("March 2024")).toBeInTheDocument();
    expect(screen.getAllByText("City Apartment Downtown")).toHaveLength(2);
  });
});
