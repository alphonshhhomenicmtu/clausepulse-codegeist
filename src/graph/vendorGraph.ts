import { addUtcDays } from '../contracts/renewalScheduler.js';
import type {
  TeamworkGraphEdge,
  TeamworkGraphNode,
  TeamworkGraphResult,
  VendorContractRecord
} from '../types.js';

/**
 * Deterministic SaaS procurement portfolio used for standalone demo mode
 * and as a fallback when live Jira/Confluence APIs are not attached.
 */
export const DEMO_VENDOR_PORTFOLIO: VendorContractRecord[] = [
  {
    vendorId: 'vendor-snowflake',
    vendorName: 'Snowflake Enterprise',
    category: 'Cloud Data Warehouse',
    ownerName: 'Maya Lin',
    ownerTeam: 'Finance',
    annualSpendUsd: 240000,
    renewalDateIso: '2027-02-15',
    noticeWindowDays: 60,
    autoRenew: true,
    paymentTermsDays: 30,
    priceUpliftPct: 9,
    liabilityCapMonths: 6,
    hasDpaAndSoc2: true,
    confluencePageId: 'conf-msa-4012',
    confluencePageTitle: 'MSA-2025: Snowflake Enterprise Order Form #4',
    confluenceUrl: 'https://acme-corp.atlassian.net/wiki/spaces/LEGAL/pages/4012',
    jiraTicketKey: 'PROC-412',
    jiraTicketStatus: 'NEEDS_REDLINE',
    jiraUrl: 'https://acme-corp.atlassian.net/browse/PROC-412',
    contractExcerpt:
      'This Order Form shall automatically renew for successive annual terms unless Customer delivers written notice at least 60 days prior to expiration. Renewal fees may escalate by 9% annually. Supplier aggregate liability shall not exceed 6 months of fees paid. Fees are payable Net-30. Executed DPA and SOC 2 Type II report are incorporated by reference.'
  },
  {
    vendorId: 'vendor-salesforce',
    vendorName: 'Salesforce Revenue Cloud',
    category: 'CRM & RevOps',
    ownerName: 'Jordan Vance',
    ownerTeam: 'RevOps',
    annualSpendUsd: 185000,
    renewalDateIso: '2027-03-01',
    noticeWindowDays: 60,
    autoRenew: true,
    paymentTermsDays: 30,
    priceUpliftPct: 7,
    liabilityCapMonths: 12,
    hasDpaAndSoc2: true,
    confluencePageId: 'conf-msa-4088',
    confluencePageTitle: 'MSA-2024: Salesforce Master Subscription Agreement',
    confluenceUrl: 'https://acme-corp.atlassian.net/wiki/spaces/LEGAL/pages/4088',
    jiraTicketKey: 'PROC-419',
    jiraTicketStatus: 'IN_LEGAL_REVIEW',
    jiraUrl: 'https://acme-corp.atlassian.net/browse/PROC-419',
    contractExcerpt:
      'Subscription Term will automatically renew unless Customer provides 60 days prior written notice. Annual price uplift of 7% applies upon renewal. Aggregate liability shall not exceed 12 months of fees. Invoices are Net-30. Customer DPA with GDPR SCCs and annual SOC 2 Type II attestation apply.'
  },
  {
    vendorId: 'vendor-datadog',
    vendorName: 'Datadog Observability',
    category: 'Infrastructure Monitoring',
    ownerName: 'Devon Brooks',
    ownerTeam: 'Engineering',
    annualSpendUsd: 132000,
    renewalDateIso: '2027-04-10',
    noticeWindowDays: 45,
    autoRenew: true,
    paymentTermsDays: 45,
    priceUpliftPct: 5,
    liabilityCapMonths: 12,
    hasDpaAndSoc2: true,
    confluencePageId: 'conf-msa-4105',
    confluencePageTitle: 'MSA-2025: Datadog Enterprise Agreement',
    confluenceUrl: 'https://acme-corp.atlassian.net/wiki/spaces/LEGAL/pages/4105',
    jiraTicketKey: 'PROC-425',
    jiraTicketStatus: 'PENDING_CFO',
    jiraUrl: 'https://acme-corp.atlassian.net/browse/PROC-425',
    contractExcerpt:
      'Agreement automatically renews unless written notice is received 45 days before term end. Renewal uplift is capped at 5%. Mutual aggregate liability cap equals 12 months of fees. Payment terms are Net-45. Includes executed DPA and SOC 2 Type II.'
  },
  {
    vendorId: 'vendor-gong',
    vendorName: 'Gong Revenue Intelligence',
    category: 'Sales Enablement',
    ownerName: 'Elena Rostova',
    ownerTeam: 'RevOps',
    annualSpendUsd: 78000,
    renewalDateIso: '2027-01-10',
    noticeWindowDays: 30,
    autoRenew: true,
    paymentTermsDays: 15,
    priceUpliftPct: 10,
    liabilityCapMonths: null,
    hasDpaAndSoc2: false,
    confluencePageId: 'conf-msa-3990',
    confluencePageTitle: 'Order Form: Gong Enterprise 2026',
    confluenceUrl: 'https://acme-corp.atlassian.net/wiki/spaces/LEGAL/pages/3990',
    jiraTicketKey: 'PROC-407',
    jiraTicketStatus: 'NEEDS_REDLINE',
    jiraUrl: 'https://acme-corp.atlassian.net/browse/PROC-407',
    contractExcerpt:
      'Term automatically renews for 12 months unless notice is given 30 days prior. Renewal fees increase by 10% at Supplier sole discretion. Customer assumes uncapped liability for third-party recording claims. Payment due Net-15. Provided on as-is security basis without DPA.'
  },
  {
    vendorId: 'vendor-figma',
    vendorName: 'Figma Organization',
    category: 'Design & Product',
    ownerName: 'Samira Patel',
    ownerTeam: 'Engineering',
    annualSpendUsd: 54000,
    renewalDateIso: '2027-06-30',
    noticeWindowDays: 30,
    autoRenew: false,
    paymentTermsDays: 45,
    priceUpliftPct: 3,
    liabilityCapMonths: 12,
    hasDpaAndSoc2: true,
    confluencePageId: 'conf-msa-4201',
    confluencePageTitle: 'MSA-2025: Figma Organization Plan',
    confluenceUrl: 'https://acme-corp.atlassian.net/wiki/spaces/LEGAL/pages/4201',
    jiraTicketKey: 'PROC-433',
    jiraTicketStatus: 'APPROVED',
    jiraUrl: 'https://acme-corp.atlassian.net/browse/PROC-433',
    contractExcerpt:
      'This Order Form renews only upon mutual written agreement. Any mutually agreed renewal price increase shall not exceed 3%. Mutual liability is capped at 12 months of fees. Invoices are payable Net-45. Executed DPA and SOC 2 Type II report are attached.'
  }
];

export interface VendorGraphQueryOptions {
  vendorId?: string;
  statusFilter?: string;
}

/**
 * Queries the Teamwork Graph connecting Vendor Entity <-> Confluence Contract Page
 * <-> Jira/JSM Budget Approval Ticket <-> Renewal Opt-Out Deadline.
 */
export function queryVendorGraph(
  options: VendorGraphQueryOptions = {},
  portfolio: VendorContractRecord[] = DEMO_VENDOR_PORTFOLIO
): TeamworkGraphResult {
  const filtered = portfolio.filter((record) => {
    if (options.vendorId && record.vendorId !== options.vendorId) {
      return false;
    }
    if (
      options.statusFilter &&
      record.jiraTicketStatus !== options.statusFilter.toUpperCase()
    ) {
      return false;
    }
    return true;
  });

  const nodes: TeamworkGraphNode[] = [];
  const edges: TeamworkGraphEdge[] = [];

  for (const record of filtered) {
    const optOutIso = addUtcDays(record.renewalDateIso, -record.noticeWindowDays);
    const vendorNodeId = `node:${record.vendorId}`;
    const confNodeId = `node:${record.confluencePageId}`;
    const jiraNodeId = `node:${record.jiraTicketKey}`;
    const deadlineNodeId = `node:deadline-${record.vendorId}`;

    nodes.push(
      {
        id: vendorNodeId,
        type: 'VENDOR',
        label: record.vendorName,
        subtitle: `${record.category} · $${record.annualSpendUsd.toLocaleString('en-US')}/yr`,
        status: record.ownerTeam
      },
      {
        id: confNodeId,
        type: 'CONFLUENCE_CONTRACT',
        label: record.confluencePageTitle,
        subtitle: `Confluence Page ${record.confluencePageId}`,
        status: record.hasDpaAndSoc2 ? 'DPA+SOC2' : 'MISSING_DPA',
        url: record.confluenceUrl
      },
      {
        id: jiraNodeId,
        type: 'JIRA_TICKET',
        label: `${record.jiraTicketKey} (${record.ownerName})`,
        subtitle: `JSM Budget & Legal Approval`,
        status: record.jiraTicketStatus,
        url: record.jiraUrl
      },
      {
        id: deadlineNodeId,
        type: 'RENEWAL_DEADLINE',
        label: `Opt-Out by ${optOutIso}`,
        subtitle: `Renews ${record.renewalDateIso} (${record.noticeWindowDays}d notice)`,
        status: record.autoRenew ? 'AUTO_RENEW' : 'MANUAL'
      }
    );

    edges.push(
      { from: vendorNodeId, to: confNodeId, relation: 'GOVERNED_BY' },
      { from: vendorNodeId, to: jiraNodeId, relation: 'TRACKED_IN' },
      { from: confNodeId, to: deadlineNodeId, relation: 'EXPIRES_ON' }
    );
  }

  return {
    nodes,
    edges,
    records: filtered
  };
}

export function findVendorById(
  vendorId: string,
  portfolio: VendorContractRecord[] = DEMO_VENDOR_PORTFOLIO
): VendorContractRecord | undefined {
  return portfolio.find(
    (v) =>
      v.vendorId.toLowerCase() === vendorId.toLowerCase() ||
      v.vendorName.toLowerCase() === vendorId.toLowerCase() ||
      v.jiraTicketKey.toLowerCase() === vendorId.toLowerCase()
  );
}
