import { auditContractClauses } from '../contracts/clauseAnalyzer.js';
import { addUtcDays, forecastRenewalPortfolio } from '../contracts/renewalScheduler.js';
import { DEMO_VENDOR_PORTFOLIO, findVendorById } from '../graph/vendorGraph.js';
import type {
  AdfDocument,
  ApprovalBriefResult,
  ClauseAuditResult,
  RenewalPortfolioForecast,
  VendorComparisonResult,
  VendorComparisonRow,
  VendorContractRecord
} from '../types.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_PAYLOAD_BYTES = 65_536;
const MAX_CONTRACT_TEXT_LENGTH = 32_768;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_OBJECT_KEYS = 50;
const MAX_NESTING_DEPTH = 8;

function inspectValueSafety(value: unknown, depth: number, label: string): void {
  if (depth > MAX_NESTING_DEPTH) {
    throw new RangeError(`${label} exceeds maximum nesting depth (${MAX_NESTING_DEPTH}).`);
  }
  if (typeof value === 'string') {
    if (value.length > MAX_CONTRACT_TEXT_LENGTH) {
      throw new RangeError(
        `${label} exceeds maximum string length (${MAX_CONTRACT_TEXT_LENGTH} characters).`
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_OBJECT_KEYS) {
      throw new RangeError(`${label} exceeds maximum array length (${MAX_OBJECT_KEYS}).`);
    }
    for (let i = 0; i < value.length; i++) {
      inspectValueSafety(value[i], depth + 1, `${label}[${i}]`);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    const ownKeys = Object.getOwnPropertyNames(value);
    if (ownKeys.length > MAX_OBJECT_KEYS) {
      throw new RangeError(`${label} exceeds maximum key count (${MAX_OBJECT_KEYS}).`);
    }
    for (const key of ownKeys) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new Error(`Forbidden property key "${key}" detected in ${label}.`);
      }
      inspectValueSafety((value as Record<string, unknown>)[key], depth + 1, `${label}.${key}`);
    }
  }
}

export function assertSafePlainObject(
  value: unknown,
  label = 'input'
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain JSON object.`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    throw new TypeError(`${label} must be a plain JSON object.`);
  }
  inspectValueSafety(value, 0, label);
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError(`${label} must be JSON-serializable.`);
  }
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    throw new RangeError(
      `${label} exceeds maximum serialized payload size (${MAX_PAYLOAD_BYTES} bytes).`
    );
  }
  return value as Record<string, unknown>;
}

function assertIsoDateString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new RangeError(`${fieldName} must be a valid YYYY-MM-DD ISO date.`);
  }
  const normalized = value.trim();
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new RangeError(`${fieldName} is not a valid calendar date: "${value}".`);
  }
  return normalized;
}

export function handleScoreClauseRisk(input: {
  contractText: string;
  vendorName?: string;
  annualSpendUsd?: number;
}): ClauseAuditResult {
  const safe = assertSafePlainObject(input, 'scoreClauseRisk input');
  if (typeof safe.contractText !== 'string' || safe.contractText.trim().length === 0) {
    throw new Error('contractText must be a non-empty string.');
  }
  if (safe.vendorName !== undefined) {
    if (typeof safe.vendorName !== 'string' || safe.vendorName.length > MAX_IDENTIFIER_LENGTH) {
      throw new TypeError(`vendorName must be a string up to ${MAX_IDENTIFIER_LENGTH} characters.`);
    }
  }
  if (safe.annualSpendUsd !== undefined) {
    if (
      typeof safe.annualSpendUsd !== 'number' ||
      !Number.isFinite(safe.annualSpendUsd) ||
      safe.annualSpendUsd < 0
    ) {
      throw new RangeError('annualSpendUsd must be a finite non-negative number.');
    }
  }

  return auditContractClauses({
    vendorName: (safe.vendorName as string | undefined)?.trim() || 'Prospective Vendor',
    contractText: safe.contractText,
    annualSpendUsd: safe.annualSpendUsd as number | undefined
  });
}

export function handleCalculateRenewalDeadlines(
  input: { referenceDateIso?: string; horizonDays?: number } = {},
  portfolio: VendorContractRecord[] = DEMO_VENDOR_PORTFOLIO
): RenewalPortfolioForecast {
  const safe = assertSafePlainObject(input, 'calculateRenewalDeadlines input');
  const referenceDateIso =
    safe.referenceDateIso !== undefined
      ? assertIsoDateString(safe.referenceDateIso, 'referenceDateIso')
      : undefined;

  let horizonDays = 90;
  if (safe.horizonDays !== undefined) {
    if (
      typeof safe.horizonDays !== 'number' ||
      !Number.isFinite(safe.horizonDays) ||
      safe.horizonDays < 1 ||
      safe.horizonDays > 365
    ) {
      throw new RangeError('horizonDays must be a finite number between 1 and 365.');
    }
    horizonDays = safe.horizonDays;
  }

  return forecastRenewalPortfolio(portfolio, referenceDateIso, horizonDays);
}

function buildAdfApprovalBrief(
  record: VendorContractRecord,
  audit: ClauseAuditResult,
  optOutDeadlineIso: string,
  includeRedlines: boolean
): AdfDocument {
  const content: AdfDocument['content'] = [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [
        {
          type: 'text',
          text: `CFO & Legal Procurement Signoff Brief: ${record.vendorName} (${record.jiraTicketKey})`
        }
      ]
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: `Recommendation: ${audit.approvalRecommendation} | Risk Score: ${audit.riskScore}/100 (${audit.riskTier}) | Annual Spend: $${record.annualSpendUsd.toLocaleString('en-US')} | Opt-Out Cutoff: ${optOutDeadlineIso}`
        }
      ]
    }
  ];

  if (audit.findings.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Flagged Commercial & Legal Deviations' }]
    });
    content.push({
      type: 'bulletList',
      content: audit.findings.map((finding) => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: `[${finding.severity}] ${finding.clauseCategory}: ${finding.rationale}${
                  includeRedlines ? ` Suggested Redline: ${finding.suggestedRedline}` : ''
                }`
              }
            ]
          }
        ]
      }))
    });
  }

  return {
    version: 1,
    type: 'doc',
    content
  };
}

export function handleGenerateApprovalBrief(
  input: { vendorId: string; includeRedlines?: boolean },
  portfolio: VendorContractRecord[] = DEMO_VENDOR_PORTFOLIO
): ApprovalBriefResult {
  const safe = assertSafePlainObject(input, 'generateApprovalBrief input');
  if (
    typeof safe.vendorId !== 'string' ||
    safe.vendorId.trim().length === 0 ||
    safe.vendorId.length > MAX_IDENTIFIER_LENGTH
  ) {
    throw new TypeError(`vendorId must be a non-empty string up to ${MAX_IDENTIFIER_LENGTH} characters.`);
  }
  if (safe.includeRedlines !== undefined && typeof safe.includeRedlines !== 'boolean') {
    throw new TypeError('includeRedlines must be a boolean.');
  }

  const vendorId = safe.vendorId.trim();
  const record = findVendorById(vendorId, portfolio);
  if (!record) {
    throw new Error(`Vendor not found in Teamwork Graph: "${vendorId}"`);
  }

  const includeRedlines = (safe.includeRedlines as boolean | undefined) ?? true;
  const audit = auditContractClauses({
    vendorName: record.vendorName,
    contractText: record.contractExcerpt,
    annualSpendUsd: record.annualSpendUsd
  });
  const optOutDeadlineIso = addUtcDays(record.renewalDateIso, -record.noticeWindowDays);

  const findingLines =
    audit.findings.length === 0
      ? ['- All commercial playbook checks passed.']
      : audit.findings.map((f) => {
          const redlineLine = includeRedlines
            ? `\n  - **Suggested Redline:** ${f.suggestedRedline}`
            : '';
          return `- **[${f.severity}] ${f.clauseCategory}** (${f.ruleId}): ${f.rationale}${redlineLine}`;
        });

  const markdown = [
    `## CFO & Legal Signoff Brief: ${record.vendorName}`,
    `- **Jira Ticket:** ${record.jiraTicketKey} (${record.jiraTicketStatus})`,
    `- **Confluence MSA:** ${record.confluencePageTitle}`,
    `- **Annualized Spend:** $${record.annualSpendUsd.toLocaleString('en-US')}`,
    `- **Renewal Date:** ${record.renewalDateIso} (Opt-out cutoff: **${optOutDeadlineIso}**, ${record.noticeWindowDays}d notice)`,
    `- **ClausePulse Risk Score:** **${audit.riskScore}/100 (${audit.riskTier})**`,
    `- **Decision Gate:** \`${audit.approvalRecommendation}\``,
    '',
    '### Key Findings & Redline Counter-Proposals',
    ...findingLines
  ].join('\n');

  return {
    vendorId: record.vendorId,
    vendorName: record.vendorName,
    jiraTicketKey: record.jiraTicketKey,
    riskScore: audit.riskScore,
    riskTier: audit.riskTier,
    recommendation: audit.approvalRecommendation,
    optOutDeadlineIso,
    annualSpendUsd: record.annualSpendUsd,
    markdown,
    adf: buildAdfApprovalBrief(record, audit, optOutDeadlineIso, includeRedlines)
  };
}

export function handleCompareVendorTerms(
  input: { primaryVendorId: string; secondaryVendorId: string },
  portfolio: VendorContractRecord[] = DEMO_VENDOR_PORTFOLIO
): VendorComparisonResult {
  const safe = assertSafePlainObject(input, 'compareVendorTerms input');
  if (
    typeof safe.primaryVendorId !== 'string' ||
    safe.primaryVendorId.trim().length === 0 ||
    safe.primaryVendorId.length > MAX_IDENTIFIER_LENGTH
  ) {
    throw new TypeError('primaryVendorId must be a non-empty string.');
  }
  if (
    typeof safe.secondaryVendorId !== 'string' ||
    safe.secondaryVendorId.trim().length === 0 ||
    safe.secondaryVendorId.length > MAX_IDENTIFIER_LENGTH
  ) {
    throw new TypeError('secondaryVendorId must be a non-empty string.');
  }

  const primary = findVendorById(safe.primaryVendorId.trim(), portfolio);
  const secondary = findVendorById(safe.secondaryVendorId.trim(), portfolio);
  if (!primary) {
    throw new Error(`Primary vendor not found: "${safe.primaryVendorId}"`);
  }
  if (!secondary) {
    throw new Error(`Secondary vendor not found: "${safe.secondaryVendorId}"`);
  }

  const primaryAudit = auditContractClauses({
    vendorName: primary.vendorName,
    contractText: primary.contractExcerpt,
    annualSpendUsd: primary.annualSpendUsd
  });
  const secondaryAudit = auditContractClauses({
    vendorName: secondary.vendorName,
    contractText: secondary.contractExcerpt,
    annualSpendUsd: secondary.annualSpendUsd
  });

  const rows: VendorComparisonRow[] = [
    {
      dimension: 'Playbook Risk Score (lower is better)',
      primaryValue: `${primaryAudit.riskScore}/100 (${primaryAudit.riskTier})`,
      secondaryValue: `${secondaryAudit.riskScore}/100 (${secondaryAudit.riskTier})`,
      preferred:
        primaryAudit.riskScore === secondaryAudit.riskScore
          ? 'TIE'
          : primaryAudit.riskScore < secondaryAudit.riskScore
            ? 'PRIMARY'
            : 'SECONDARY'
    },
    {
      dimension: 'Annual Price Uplift Cap',
      primaryValue: `${primary.priceUpliftPct}%`,
      secondaryValue: `${secondary.priceUpliftPct}%`,
      preferred:
        primary.priceUpliftPct === secondary.priceUpliftPct
          ? 'TIE'
          : primary.priceUpliftPct < secondary.priceUpliftPct
            ? 'PRIMARY'
            : 'SECONDARY'
    },
    {
      dimension: 'Payment Terms',
      primaryValue: `Net-${primary.paymentTermsDays}`,
      secondaryValue: `Net-${secondary.paymentTermsDays}`,
      preferred:
        primary.paymentTermsDays === secondary.paymentTermsDays
          ? 'TIE'
          : primary.paymentTermsDays > secondary.paymentTermsDays
            ? 'PRIMARY'
            : 'SECONDARY'
    },
    {
      dimension: 'Liability Cap',
      primaryValue: primary.liabilityCapMonths ? `${primary.liabilityCapMonths} months` : 'Uncapped',
      secondaryValue: secondary.liabilityCapMonths
        ? `${secondary.liabilityCapMonths} months`
        : 'Uncapped',
      preferred:
        (primary.liabilityCapMonths ?? 0) === (secondary.liabilityCapMonths ?? 0)
          ? 'TIE'
          : (primary.liabilityCapMonths ?? 0) > (secondary.liabilityCapMonths ?? 0)
            ? 'PRIMARY'
            : 'SECONDARY'
    },
    {
      dimension: 'DPA + SOC 2 Type II',
      primaryValue: primary.hasDpaAndSoc2 ? 'Verified' : 'Missing',
      secondaryValue: secondary.hasDpaAndSoc2 ? 'Verified' : 'Missing',
      preferred:
        primary.hasDpaAndSoc2 === secondary.hasDpaAndSoc2
          ? 'TIE'
          : primary.hasDpaAndSoc2
            ? 'PRIMARY'
            : 'SECONDARY'
    }
  ];

  const primaryWins = rows.filter((r) => r.preferred === 'PRIMARY').length;
  const secondaryWins = rows.filter((r) => r.preferred === 'SECONDARY').length;
  const winner =
    primaryWins === secondaryWins
      ? 'Tie'
      : primaryWins > secondaryWins
        ? primary.vendorName
        : secondary.vendorName;

  return {
    primaryVendor: primary.vendorName,
    secondaryVendor: secondary.vendorName,
    rows,
    winner,
    rationale: `${winner === 'Tie' ? 'Both vendors tie' : `${winner} leads`} across ${rows.length} commercial playbook dimensions (${primaryWins} vs. ${secondaryWins}).`
  };
}
