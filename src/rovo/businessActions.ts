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

export function handleScoreClauseRisk(input: {
  contractText: string;
  vendorName?: string;
  annualSpendUsd?: number;
}): ClauseAuditResult {
  return auditContractClauses({
    vendorName: input.vendorName?.trim() || 'Prospective Vendor',
    contractText: input.contractText,
    annualSpendUsd: input.annualSpendUsd
  });
}

export function handleCalculateRenewalDeadlines(
  input: { referenceDateIso?: string; horizonDays?: number } = {},
  portfolio: VendorContractRecord[] = DEMO_VENDOR_PORTFOLIO
): RenewalPortfolioForecast {
  return forecastRenewalPortfolio(
    portfolio,
    input.referenceDateIso,
    input.horizonDays ?? 90
  );
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
  const record = findVendorById(input.vendorId, portfolio);
  if (!record) {
    throw new Error(`Vendor not found in Teamwork Graph: "${input.vendorId}"`);
  }

  const includeRedlines = input.includeRedlines ?? true;
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
  const primary = findVendorById(input.primaryVendorId, portfolio);
  const secondary = findVendorById(input.secondaryVendorId, portfolio);
  if (!primary) {
    throw new Error(`Primary vendor not found: "${input.primaryVendorId}"`);
  }
  if (!secondary) {
    throw new Error(`Secondary vendor not found: "${input.secondaryVendorId}"`);
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
