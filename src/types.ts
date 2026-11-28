export type RiskSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type RiskTier = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
export type ApprovalRecommendation =
  | 'BLOCK_UNTIL_REDLINED'
  | 'FINANCE_LEGAL_REVIEW'
  | 'STANDARD_APPROVAL';

export type ClauseRuleId =
  | 'AUTO_RENEWAL_TRAP'
  | 'UNCAPPED_LIABILITY'
  | 'MISSING_LIABILITY_CAP'
  | 'PRICE_UPLIFT_EXCESS'
  | 'COMPLIANCE_GAP'
  | 'PAYMENT_TERM_DEVIATION';

export interface PlaybookConfig {
  maxAutoRenewalNoticeDays: number;
  maxAnnualUpliftPct: number;
  minLiabilityCapMonths: number;
  requireDpaSoc2: boolean;
  requiredPaymentTermsDays: number;
}

export interface ClauseFinding {
  ruleId: ClauseRuleId;
  clauseCategory: string;
  severity: RiskSeverity;
  matchedExcerpt: string;
  policyRule: string;
  riskScorePoints: number;
  rationale: string;
  suggestedRedline: string;
  businessImpact: string;
}

export interface ClauseAuditInput {
  vendorName: string;
  contractText: string;
  annualSpendUsd?: number;
}

export interface ClauseAuditResult {
  vendorName: string;
  annualSpendUsd: number;
  riskScore: number;
  riskTier: RiskTier;
  approvalRecommendation: ApprovalRecommendation;
  findings: ClauseFinding[];
  passedChecks: string[];
  summary: string;
}

export type RenewalUrgencyBucket =
  | 'LOCKED_IN'
  | 'CRITICAL_30D'
  | 'WARNING_60D'
  | 'WATCH_90D'
  | 'SAFE_GT_90D';

export interface VendorContractRecord {
  vendorId: string;
  vendorName: string;
  category: string;
  ownerName: string;
  ownerTeam: 'Legal' | 'Finance' | 'RevOps' | 'Security' | 'Engineering';
  annualSpendUsd: number;
  renewalDateIso: string;
  noticeWindowDays: number;
  autoRenew: boolean;
  paymentTermsDays: number;
  priceUpliftPct: number;
  liabilityCapMonths: number | null;
  hasDpaAndSoc2: boolean;
  confluencePageId: string;
  confluencePageTitle: string;
  confluenceUrl: string;
  jiraTicketKey: string;
  jiraTicketStatus: 'IN_LEGAL_REVIEW' | 'PENDING_CFO' | 'APPROVED' | 'NEEDS_REDLINE';
  jiraUrl: string;
  contractExcerpt: string;
}

export interface RenewalDeadlineSummary {
  vendorId: string;
  vendorName: string;
  jiraTicketKey: string;
  annualSpendUsd: number;
  renewalDateIso: string;
  optOutDeadlineIso: string;
  noticeWindowDays: number;
  daysUntilOptOut: number;
  daysUntilRenewal: number;
  autoRenew: boolean;
  urgencyBucket: RenewalUrgencyBucket;
  spendAtRiskUsd: number;
  actionRequired: string;
}

export interface RenewalPortfolioForecast {
  referenceDateIso: string;
  horizonDays: number;
  totalPortfolioSpendUsd: number;
  totalSpendAtRiskUsd: number;
  lockedInSpendUsd: number;
  within30DaysUsd: number;
  within60DaysUsd: number;
  within90DaysUsd: number;
  contracts: RenewalDeadlineSummary[];
}

export interface TeamworkGraphNode {
  id: string;
  type: 'VENDOR' | 'CONFLUENCE_CONTRACT' | 'JIRA_TICKET' | 'RENEWAL_DEADLINE';
  label: string;
  subtitle: string;
  status: string;
  url?: string;
}

export interface TeamworkGraphEdge {
  from: string;
  to: string;
  relation: 'GOVERNED_BY' | 'TRACKED_IN' | 'EXPIRES_ON';
}

export interface TeamworkGraphResult {
  nodes: TeamworkGraphNode[];
  edges: TeamworkGraphEdge[];
  records: VendorContractRecord[];
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface AdfDocument {
  version: 1;
  type: 'doc';
  content: AdfNode[];
}

export interface ApprovalBriefResult {
  vendorId: string;
  vendorName: string;
  jiraTicketKey: string;
  riskScore: number;
  riskTier: RiskTier;
  recommendation: ApprovalRecommendation;
  optOutDeadlineIso: string;
  annualSpendUsd: number;
  markdown: string;
  adf: AdfDocument;
}

export interface VendorComparisonRow {
  dimension: string;
  primaryValue: string;
  secondaryValue: string;
  preferred: 'PRIMARY' | 'SECONDARY' | 'TIE';
}

export interface VendorComparisonResult {
  primaryVendor: string;
  secondaryVendor: string;
  rows: VendorComparisonRow[];
  winner: string;
  rationale: string;
}
