import { describe, expect, it } from 'vitest';
import { addUtcDays, diffUtcDays, forecastRenewalPortfolio } from '../src/contracts/renewalScheduler.js';
import { DEMO_VENDOR_PORTFOLIO } from '../src/graph/vendorGraph.js';

describe('ClausePulse renewalScheduler', () => {
  it('computes exact UTC opt-out deadline dates', () => {
    expect(addUtcDays('2027-02-15', -60)).toBe('2026-12-17');
    expect(diffUtcDays('2026-11-27', '2026-12-17')).toBe(20);
  });

  it('buckets Snowflake and Gong into CRITICAL_30D relative to 2026-11-27', () => {
    const forecast = forecastRenewalPortfolio(DEMO_VENDOR_PORTFOLIO, '2026-11-27', 90);
    const snowflake = forecast.contracts.find((c) => c.vendorId === 'vendor-snowflake');
    const gong = forecast.contracts.find((c) => c.vendorId === 'vendor-gong');

    expect(snowflake?.optOutDeadlineIso).toBe('2026-12-17');
    expect(snowflake?.daysUntilOptOut).toBe(20);
    expect(snowflake?.urgencyBucket).toBe('CRITICAL_30D');

    expect(gong?.optOutDeadlineIso).toBe('2026-12-11');
    expect(gong?.daysUntilOptOut).toBe(14);
    expect(gong?.urgencyBucket).toBe('CRITICAL_30D');
  });

  it('calculates 30/60/90-day annualized spend-at-risk totals accurately', () => {
    const forecast = forecastRenewalPortfolio(DEMO_VENDOR_PORTFOLIO, '2026-11-27', 90);
    expect(forecast.within30DaysUsd).toBe(240000 + 78000);
    expect(forecast.within60DaysUsd).toBe(185000);
    expect(forecast.within90DaysUsd).toBe(132000);
    expect(forecast.totalSpendAtRiskUsd).toBe(240000 + 78000 + 185000 + 132000);
    expect(forecast.totalPortfolioSpendUsd).toBe(689000);
  });

  it('excludes manual non-auto-renew contracts from auto-renew spend at risk', () => {
    const forecast = forecastRenewalPortfolio(DEMO_VENDOR_PORTFOLIO, '2026-11-27', 365);
    const figma = forecast.contracts.find((c) => c.vendorId === 'vendor-figma');
    expect(figma?.autoRenew).toBe(false);
    expect(figma?.spendAtRiskUsd).toBe(0);
  });

  it('throws on invalid ISO reference date', () => {
    expect(() => forecastRenewalPortfolio(DEMO_VENDOR_PORTFOLIO, 'not-a-date', 60)).toThrow(
      /Invalid ISO date/
    );
  });
});
