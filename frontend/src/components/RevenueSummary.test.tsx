import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { RevenueSummary } from "./RevenueSummary";

const { getDashboardSummary } = vi.hoisted(() => ({
  getDashboardSummary: vi.fn(),
}));

vi.mock("../lib/secureApi", () => ({
  SecureAPI: {
    getDashboardSummary,
  },
}));

describe("RevenueSummary", () => {
  beforeEach(() => {
    getDashboardSummary.mockResolvedValue({
      property_id: "prop-001",
      property_name: "Beach House Alpha",
      total_revenue: "0.000",
      currency: "USD",
      reservations_count: 0,
      reporting_month: 4,
      reporting_year: 2024,
    });
  });

  it("renders zero revenue cleanly for an empty reporting period", async () => {
    render(<RevenueSummary propertyId="prop-001" month={4} year={2024} />);

    await waitFor(() => {
      expect(screen.getByText("April 2024")).toBeInTheDocument();
    });

    expect(screen.getByText("USD 0.000")).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === "0 bookings"),
    ).toBeInTheDocument();
    expect(getDashboardSummary).toHaveBeenCalledWith(
      "prop-001",
      expect.objectContaining({
        month: 4,
        year: 2024,
        timestamp: expect.any(Number),
      }),
    );
  });
});
