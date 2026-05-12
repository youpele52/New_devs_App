import React, { useEffect, useState } from 'react';

import { SecureAPI } from '../lib/secureApi';

interface RevenueData {
    property_id: string;
    property_name: string;
    total_revenue: string;
    currency: string;
    reservations_count: number;
    reporting_month: number;
    reporting_year: number;
}

interface RevenueSummaryProps {
    propertyId: string;
}

const MONTH_LABELS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

function formatMoneyValue(rawAmount: string): string {
    const negative = rawAmount.startsWith('-');
    const normalized = negative ? rawAmount.slice(1) : rawAmount;
    const [wholePart, decimalPart] = normalized.split('.');
    const formattedWhole = Number(wholePart || '0').toLocaleString();
    const formattedAmount = decimalPart ? `${formattedWhole}.${decimalPart}` : formattedWhole;
    return negative ? `-${formattedAmount}` : formattedAmount;
}

export const RevenueSummary: React.FC<RevenueSummaryProps> = ({ propertyId }) => {
    const [data, setData] = useState<RevenueData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;

        const fetchRevenue = async () => {
            setLoading(true);
            setError('');

            try {
                const response = await SecureAPI.getDashboardSummary(propertyId, {
                    timestamp: Date.now(),
                });
                if (!cancelled) {
                    setData(response);
                }
            } catch (fetchError) {
                if (!cancelled) {
                    setError('Failed to load revenue data');
                    console.error(fetchError);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        fetchRevenue();

        return () => {
            cancelled = true;
        };
    }, [propertyId]);

    if (loading) {
        return (
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <div className="animate-pulse space-y-4">
                    <div className="h-4 bg-gray-100 rounded w-1/4"></div>
                    <div className="h-8 bg-gray-100 rounded w-1/2"></div>
                    <div className="flex gap-4 pt-4">
                        <div className="h-12 bg-gray-100 rounded flex-1"></div>
                        <div className="h-12 bg-gray-100 rounded flex-1"></div>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return <div className="p-4 text-red-500 bg-red-50 rounded-lg">{error}</div>;
    }

    if (!data) {
        return null;
    }

    const reportingLabel = `${MONTH_LABELS[data.reporting_month - 1]} ${data.reporting_year}`;

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow duration-300">
            <div className="p-6">
                <div className="flex items-center justify-between mb-6 gap-4">
                    <div>
                        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Total Revenue</h2>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-3xl font-bold text-gray-900 tracking-tight">
                                {data.currency} {formatMoneyValue(data.total_revenue)}
                            </span>
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                                {reportingLabel}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100">
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Property</p>
                        <p className="text-sm font-semibold text-gray-700 mt-1">{data.property_name}</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Reservations</p>
                        <p className="text-sm font-semibold text-gray-700 mt-1">
                            {data.reservations_count} <span className="font-normal text-gray-400">bookings</span>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
