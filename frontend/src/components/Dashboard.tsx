import React, { useEffect, useState } from "react";

import { SecureAPI } from "../lib/secureApi";
import { RevenueSummary } from "./RevenueSummary";

interface PropertyOption {
  id: string;
  name: string;
}

type PeriodMode = "latest" | "custom";

const MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

function buildYearOptions(): number[] {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 10 }, (_, index) => currentYear - index);
}

const Dashboard: React.FC = () => {
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("latest");
  const [selectedMonth, setSelectedMonth] = useState(3);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const yearOptions = buildYearOptions();

  useEffect(() => {
    let cancelled = false;

    const loadProperties = async () => {
      setLoading(true);
      setError("");

      try {
        const response = await SecureAPI.getDashboardProperties();
        if (cancelled) {
          return;
        }

        setProperties(response);
        setSelectedProperty((currentValue) => {
          if (currentValue && response.some((property) => property.id === currentValue)) {
            return currentValue;
          }
          return response[0]?.id || "";
        });
      } catch (loadError) {
        if (!cancelled) {
          setError("Failed to load your properties.");
          console.error(loadError);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadProperties();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-4 lg:p-6 min-h-full">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 text-gray-900">Property Management Dashboard</h1>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 lg:p-6">
          <div className="mb-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
              <div>
                <h2 className="text-lg lg:text-xl font-medium text-gray-900 mb-2">Revenue Overview</h2>
                <p className="text-sm lg:text-base text-gray-600">
                  Monthly performance insights for your properties
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
                <div className="flex flex-col sm:items-end">
                  <label htmlFor="dashboard-property" className="text-xs font-medium text-gray-700 mb-1">
                    Select Property
                  </label>
                  <select
                    id="dashboard-property"
                    value={selectedProperty}
                    onChange={(event) => setSelectedProperty(event.target.value)}
                    disabled={loading || properties.length === 0}
                    className="block w-full sm:w-auto min-w-[220px] px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm disabled:bg-gray-100"
                  >
                    {properties.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col sm:items-end">
                  <label htmlFor="dashboard-period-mode" className="text-xs font-medium text-gray-700 mb-1">
                    Reporting Period
                  </label>
                  <select
                    id="dashboard-period-mode"
                    value={periodMode}
                    onChange={(event) => setPeriodMode(event.target.value as PeriodMode)}
                    className="block w-full sm:w-auto min-w-[180px] px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
                  >
                    <option value="latest">Latest available month</option>
                    <option value="custom">Choose month</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <label htmlFor="dashboard-month" className="text-xs font-medium text-gray-700 mb-1">
                      Month
                    </label>
                    <select
                      id="dashboard-month"
                      value={selectedMonth}
                      onChange={(event) => setSelectedMonth(Number(event.target.value))}
                      disabled={periodMode === "latest"}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm disabled:bg-gray-100"
                    >
                      {MONTH_OPTIONS.map((month) => (
                        <option key={month.value} value={month.value}>
                          {month.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col">
                    <label htmlFor="dashboard-year" className="text-xs font-medium text-gray-700 mb-1">
                      Year
                    </label>
                    <select
                      id="dashboard-year"
                      value={selectedYear}
                      onChange={(event) => setSelectedYear(Number(event.target.value))}
                      disabled={periodMode === "latest"}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm disabled:bg-gray-100"
                    >
                      {yearOptions.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {error ? <div className="p-4 text-red-500 bg-red-50 rounded-lg">{error}</div> : null}

          {!error && selectedProperty ? (
            <div className="space-y-6">
              <RevenueSummary
                propertyId={selectedProperty}
                month={periodMode === "custom" ? selectedMonth : undefined}
                year={periodMode === "custom" ? selectedYear : undefined}
              />
            </div>
          ) : null}

          {!error && !loading && properties.length === 0 ? (
            <div className="p-4 text-gray-500 bg-gray-50 rounded-lg">
              No properties are available for this tenant.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
