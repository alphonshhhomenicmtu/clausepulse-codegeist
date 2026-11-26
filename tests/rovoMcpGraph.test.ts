import { describe, expect, it } from 'vitest';
import { queryVendorGraph } from '../src/graph/vendorGraph.js';
import { executeMcpTool, MCP_TOOL_DEFINITIONS } from '../src/mcp/procurementTools.js';
import { buildWorkbenchState, handler } from '../src/resolvers/index.js';
import {
  handleCompareVendorTerms,
  handleGenerateApprovalBrief,
  handleScoreClauseRisk
} from '../src/rovo/businessActions.js';

describe('ClausePulse Rovo, MCP, Teamwork Graph & Resolvers', () => {
  it('generates CFO & Legal Approval Brief in both Markdown and valid Atlassian ADF', () => {
    const brief = handleGenerateApprovalBrief({
      vendorId: 'vendor-snowflake',
      includeRedlines: true
    });

    expect(brief.vendorName).toBe('Snowflake Enterprise');
    expect(brief.jiraTicketKey).toBe('PROC-412');
    expect(brief.markdown).toContain('CFO & Legal Signoff Brief');
    expect(brief.markdown).toContain('Suggested Redline');
    expect(brief.adf.version).toBe(1);
    expect(brief.adf.type).toBe('doc');
    expect(brief.adf.content.length).toBeGreaterThan(2);
  });

  it('compares two vendors side-by-side and identifies commercial winner', () => {
    const comparison = handleCompareVendorTerms({
      primaryVendorId: 'vendor-figma',
      secondaryVendorId: 'vendor-gong'
    });

    expect(comparison.winner).toBe('Figma Organization');
    expect(comparison.rows).toHaveLength(5);
  });

  it('validates and executes all 4 MCP tools via executeMcpTool', () => {
    expect(MCP_TOOL_DEFINITIONS).toHaveLength(4);

    const audit = executeMcpTool('audit_contract_clauses', {
      vendorName: 'TestCo',
      contractText: 'Auto-renews unless 60 days notice. Net-45. DPA and SOC 2.',
      annualSpendUsd: 50000
    }) as ReturnType<typeof handleScoreClauseRisk>;
    expect(audit.findings.some((f) => f.ruleId === 'AUTO_RENEWAL_TRAP')).toBe(true);

    const forecast = executeMcpTool('forecast_renewal_exposure', {
      referenceDateIso: '2026-11-27',
      horizonDays: 30
    }) as { totalSpendAtRiskUsd: number };
    expect(forecast.totalSpendAtRiskUsd).toBe(318000);

    const memo = executeMcpTool('build_cfo_approval_memo', {
      vendorId: 'vendor-gong',
      includeRedlines: true
    }) as { recommendation: string };
    expect(memo.recommendation).toBe('BLOCK_UNTIL_REDLINED');

    const graph = executeMcpTool('query_vendor_graph', {
      statusFilter: 'NEEDS_REDLINE'
    }) as { records: unknown[] };
    expect(graph.records).toHaveLength(2);
  });

  it('rejects invalid MCP arguments with descriptive schema errors', () => {
    expect(() =>
      executeMcpTool('audit_contract_clauses', {
        vendorName: 'MissingTextVendor'
      })
    ).toThrow(/Missing required MCP argument: "contractText"/);

    expect(() =>
      executeMcpTool('forecast_renewal_exposure', {
        horizonDays: 'sixty'
      })
    ).toThrow(/Invalid type for "horizonDays": expected number/);
  });

  it('builds Teamwork Graph with 4 nodes and 3 edges per vendor', () => {
    const graph = queryVendorGraph({ vendorId: 'vendor-snowflake' });
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(3);
    expect(graph.edges.map((e) => e.relation)).toEqual([
      'GOVERNED_BY',
      'TRACKED_IN',
      'EXPIRES_ON'
    ]);
  });

  it('supports both standalone demo fallback and live Forge Cloud adapter in resolver', async () => {
    const standalone = await buildWorkbenchState({ referenceDateIso: '2026-11-27' });
    expect(standalone.mode).toBe('STANDALONE_DEMO');
    expect(Object.keys(standalone.auditsByVendorId)).toHaveLength(5);

    const cloud = await buildWorkbenchState({
      issueKey: 'PROC-412',
      referenceDateIso: '2026-11-27',
      adapter: {
        fetchJiraIssueContext: async () => ({ summary: 'Snowflake Renewal' })
      }
    });
    expect(cloud.mode).toBe('FORGE_CLOUD');

    const viaHandler = await handler({
      action: 'scoreClauseRisk',
      payload: {
        vendorName: 'HandlerTest',
        contractText: 'Uncapped liability. Net-45. DPA and SOC 2.'
      }
    }) as { riskTier: string };
    expect(viaHandler.riskTier).toBe('MODERATE');
  });
});
