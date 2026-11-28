import { DEMO_VENDOR_PORTFOLIO, queryVendorGraph } from '../graph/vendorGraph';
import { executeMcpTool, handleMcpJsonRpc } from '../mcp/procurementTools';
import {
  handleCalculateRenewalDeadlines,
  handleCompareVendorTerms,
  handleGenerateApprovalBrief,
  handleScoreClauseRisk
} from '../rovo/businessActions';
import { auditContractClauses } from '../contracts/clauseAnalyzer';
import type { VendorContractRecord } from '../types';

export interface ForgeApiAdapter {
  fetchJiraIssueContext?: (issueKey: string) => Promise<{
    summary?: string;
    description?: string;
  } | null>;
}

export interface WorkbenchPayload {
  mode: 'FORGE_CLOUD' | 'STANDALONE_DEMO';
  referenceDateIso: string;
  forecast: ReturnType<typeof handleCalculateRenewalDeadlines>;
  graph: ReturnType<typeof queryVendorGraph>;
  auditsByVendorId: Record<string, ReturnType<typeof auditContractClauses>>;
}

/**
 * Builds the full Custom UI workbench state from live Atlassian Cloud context
 * or deterministic SaaS procurement demo portfolio fallback.
 */
export async function buildWorkbenchState(
  options: {
    issueKey?: string;
    referenceDateIso?: string;
    horizonDays?: number;
    portfolio?: VendorContractRecord[];
    adapter?: ForgeApiAdapter;
  } = {}
): Promise<WorkbenchPayload> {
  const portfolio = options.portfolio ?? DEMO_VENDOR_PORTFOLIO;
  const referenceDateIso = options.referenceDateIso ?? '2026-11-27';

  let mode: WorkbenchPayload['mode'] = 'STANDALONE_DEMO';
  if (options.issueKey && options.adapter?.fetchJiraIssueContext) {
    try {
      const liveIssue = await options.adapter.fetchJiraIssueContext(options.issueKey);
      if (liveIssue) {
        mode = 'FORGE_CLOUD';
      }
    } catch {
      mode = 'STANDALONE_DEMO';
    }
  }

  const forecast = handleCalculateRenewalDeadlines(
    { referenceDateIso, horizonDays: options.horizonDays ?? 90 },
    portfolio
  );
  const graph = queryVendorGraph({}, portfolio);
  const auditsByVendorId: Record<string, ReturnType<typeof auditContractClauses>> = {};
  for (const record of portfolio) {
    auditsByVendorId[record.vendorId] = auditContractClauses({
      vendorName: record.vendorName,
      contractText: record.contractExcerpt,
      annualSpendUsd: record.annualSpendUsd
    });
  }

  return {
    mode,
    referenceDateIso,
    forecast,
    graph,
    auditsByVendorId
  };
}

/**
 * Forge Custom UI resolver entrypoint.
 * Routes UI actions to the deterministic ClausePulse business-ops engine.
 */
export async function handler(request?: {
  action?: string;
  payload?: Record<string, unknown>;
  context?: { extension?: { issue?: { key?: string } } };
}): Promise<unknown> {
  const req = request ?? {};
  const action = req.action ?? 'getWorkbenchState';
  const payload = req.payload ?? {};

  switch (action) {
    case 'getWorkbenchState':
      return buildWorkbenchState({
        issueKey: req.context?.extension?.issue?.key,
        referenceDateIso: payload.referenceDateIso as string | undefined,
        horizonDays: payload.horizonDays as number | undefined
      });
    case 'scoreClauseRisk':
      return handleScoreClauseRisk({
        vendorName: payload.vendorName as string | undefined,
        contractText: String(payload.contractText ?? ''),
        annualSpendUsd: payload.annualSpendUsd as number | undefined
      });
    case 'generateApprovalBrief':
      return handleGenerateApprovalBrief({
        vendorId: String(payload.vendorId ?? 'vendor-snowflake'),
        includeRedlines: payload.includeRedlines as boolean | undefined
      });
    case 'compareVendorTerms':
      return handleCompareVendorTerms({
        primaryVendorId: String(payload.primaryVendorId ?? 'vendor-snowflake'),
        secondaryVendorId: String(payload.secondaryVendorId ?? 'vendor-datadog')
      });
    default:
      throw new Error(`Unsupported resolver action: "${action}"`);
  }
}

// Rovo Action Handlers (declared in manifest.yml)
export async function rovoScoreClauseRisk(payload?: {
  contractText: string;
  vendorName?: string;
  annualSpendUsd?: number;
}) {
  return handleScoreClauseRisk(payload ?? ({} as { contractText: string }));
}

export async function rovoCalculateRenewalDeadlines(payload?: {
  referenceDateIso?: string;
  horizonDays?: number;
}) {
  return handleCalculateRenewalDeadlines(payload ?? {});
}

export async function rovoGenerateApprovalBrief(payload?: {
  vendorId: string;
  includeRedlines?: boolean;
}) {
  return handleGenerateApprovalBrief(payload ?? ({} as { vendorId: string }));
}

export async function rovoCompareVendorTerms(payload?: {
  primaryVendorId: string;
  secondaryVendorId: string;
}) {
  return handleCompareVendorTerms(
    payload ?? ({} as { primaryVendorId: string; secondaryVendorId: string })
  );
}

// MCP Tool Handlers (declared in manifest.yml)
export async function mcpAuditContractClauses(args?: Record<string, unknown>) {
  return executeMcpTool('audit_contract_clauses', args ?? {});
}

export async function mcpForecastRenewalExposure(args?: Record<string, unknown>) {
  return executeMcpTool('forecast_renewal_exposure', args ?? {});
}

export async function mcpBuildCfoApprovalMemo(args?: Record<string, unknown>) {
  return executeMcpTool('build_cfo_approval_memo', args ?? {});
}

export async function mcpQueryVendorGraph(args?: Record<string, unknown>) {
  return executeMcpTool('query_vendor_graph', args ?? {});
}

export async function mcpJsonRpcHandler(request: unknown) {
  return handleMcpJsonRpc(request);
}
