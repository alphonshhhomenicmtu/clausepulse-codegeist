import type {
  RenewalDeadlineSummary,
  RenewalPortfolioForecast,
  RenewalUrgencyBucket,
  VendorContractRecord
} from '../types';

const MS_PER_DAY = 86_400_000;

export function parseUtcDate(dateIso: string): Date {
  const normalized = dateIso.trim().slice(0, 10);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO date: "${dateIso}"`);
  }
  return parsed;
}

export function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addUtcDays(dateIso: string, deltaDays: number): string {
  const base = parseUtcDate(dateIso);
  return formatUtcDate(new Date(base.getTime() + deltaDays * MS_PER_DAY));
}

export function diffUtcDays(fromIso: string, toIso: string): number {
  const from = parseUtcDate(fromIso);
  const to = parseUtcDate(toIso);
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function classifyUrgency(daysUntilOptOut: number): RenewalUrgencyBucket {
  if (daysUntilOptOut < 0) return 'LOCKED_IN';
  if (daysUntilOptOut <= 30) return 'CRITICAL_30D';
  if (daysUntilOptOut <= 60) return 'WARNING_60D';
  if (daysUntilOptOut <= 90) return 'WATCH_90D';
  return 'SAFE_GT_90D';
}

function buildActionRequired(
  record: VendorContractRecord,
  bucket: RenewalUrgencyBucket,
  daysUntilOptOut: number,
  optOutDeadlineIso: string
): string {
  if (!record.autoRenew) {
    return `Manual renewal (${record.renewalDateIso}); confirm scope with ${record.ownerTeam}.`;
  }
  switch (bucket) {
    case 'LOCKED_IN':
      return `Opt-out window closed ${Math.abs(daysUntilOptOut)}d ago (${optOutDeadlineIso}); escalate to VP Procurement for waiver.`;
    case 'CRITICAL_30D':
      return `URGENT: Send non-renewal / redline notice within ${daysUntilOptOut}d (by ${optOutDeadlineIso}) to prevent $${record.annualSpendUsd.toLocaleString('en-US')} lock-in.`;
    case 'WARNING_60D':
      return `Initiate Legal/Finance renewal review; ${daysUntilOptOut}d left before ${optOutDeadlineIso} cutoff.`;
    case 'WATCH_90D':
      return `Schedule vendor QBR & benchmark pricing; ${daysUntilOptOut}d until ${optOutDeadlineIso} cutoff.`;
    case 'SAFE_GT_90D':
      return `Healthy runway (${daysUntilOptOut}d until ${optOutDeadlineIso} opt-out cutoff).`;
  }
}

/**
 * Computes opt-out notice deadlines and annualized spend at risk across a portfolio.
 */
export function forecastRenewalPortfolio(
  records: VendorContractRecord[],
  referenceDateIso: string = new Date().toISOString().slice(0, 10),
  horizonDays: number = 90
): RenewalPortfolioForecast {
  const refIso = formatUtcDate(parseUtcDate(referenceDateIso));
  const boundedHorizon = Math.max(1, Math.min(365, Math.round(horizonDays)));

  let totalPortfolioSpendUsd = 0;
  let totalSpendAtRiskUsd = 0;
  let lockedInSpendUsd = 0;
  let within30DaysUsd = 0;
  let within60DaysUsd = 0;
  let within90DaysUsd = 0;

  const summaries: RenewalDeadlineSummary[] = records.map((record) => {
    const optOutDeadlineIso = addUtcDays(record.renewalDateIso, -record.noticeWindowDays);
    const daysUntilOptOut = diffUtcDays(refIso, optOutDeadlineIso);
    const daysUntilRenewal = diffUtcDays(refIso, record.renewalDateIso);
    const urgencyBucket = classifyUrgency(daysUntilOptOut);

    totalPortfolioSpendUsd += record.annualSpendUsd;

    const isAtRiskInHorizon =
      record.autoRenew && daysUntilOptOut <= boundedHorizon;
    const spendAtRiskUsd = isAtRiskInHorizon ? record.annualSpendUsd : 0;

    if (record.autoRenew) {
      if (daysUntilOptOut < 0) {
        lockedInSpendUsd += record.annualSpendUsd;
      } else if (daysUntilOptOut <= 30) {
        within30DaysUsd += record.annualSpendUsd;
      } else if (daysUntilOptOut <= 60) {
        within60DaysUsd += record.annualSpendUsd;
      } else if (daysUntilOptOut <= 90) {
        within90DaysUsd += record.annualSpendUsd;
      }
    }

    totalSpendAtRiskUsd += spendAtRiskUsd;

    return {
      vendorId: record.vendorId,
      vendorName: record.vendorName,
      jiraTicketKey: record.jiraTicketKey,
      annualSpendUsd: record.annualSpendUsd,
      renewalDateIso: record.renewalDateIso,
      optOutDeadlineIso,
      noticeWindowDays: record.noticeWindowDays,
      daysUntilOptOut,
      daysUntilRenewal,
      autoRenew: record.autoRenew,
      urgencyBucket,
      spendAtRiskUsd,
      actionRequired: buildActionRequired(
        record,
        urgencyBucket,
        daysUntilOptOut,
        optOutDeadlineIso
      )
    };
  });

  summaries.sort((a, b) => a.daysUntilOptOut - b.daysUntilOptOut);

  return {
    referenceDateIso: refIso,
    horizonDays: boundedHorizon,
    totalPortfolioSpendUsd,
    totalSpendAtRiskUsd,
    lockedInSpendUsd,
    within30DaysUsd,
    within60DaysUsd,
    within90DaysUsd,
    contracts: summaries
  };
}
