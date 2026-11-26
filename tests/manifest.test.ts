import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const manifestPath = path.resolve(process.cwd(), 'manifest.yml');

describe('Forge manifest.yml integrity', () => {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const doc = YAML.parse(raw) as Record<string, any>;

  it('uses nodejs24.x Forge runtime', () => {
    expect(doc.app?.runtime?.name).toBe('nodejs24.x');
  });

  it('declares jira:issuePanel pointing to clausepulse-panel resource and resolver', () => {
    const panels = doc.modules['jira:issuePanel'];
    expect(Array.isArray(panels)).toBe(true);
    expect(panels[0].key).toBe('clausepulse-procurement-panel');
    expect(panels[0].resource).toBe('clausepulse-panel');
    expect(panels[0].resolver.function).toBe('clausepulse-resolver');
  });

  it('declares rovo:agent referencing all 4 rovo:action modules', () => {
    const agent = doc.modules['rovo:agent'][0];
    expect(agent.key).toBe('clausepulse-copilot');
    expect(agent.actions).toEqual([
      'scoreClauseRisk',
      'calculateRenewalDeadlines',
      'generateApprovalBrief',
      'compareVendorTerms'
    ]);

    const actionKeys = doc.modules['rovo:action'].map((a: any) => a.key);
    expect(actionKeys).toEqual(agent.actions);
  });

  it('declares rovo:mcp with 4 strictly typed procurement tools', () => {
    const mcp = doc.modules['rovo:mcp'][0];
    expect(mcp.key).toBe('clausepulse-mcp');
    const toolNames = mcp.tools.map((t: any) => t.name);
    expect(toolNames).toEqual([
      'audit_contract_clauses',
      'forecast_renewal_exposure',
      'build_cfo_approval_memo',
      'query_vendor_graph'
    ]);
  });

  it('maps every declared module function key to modules.function', () => {
    const declaredFunctions = new Set(doc.modules.function.map((f: any) => f.key));
    for (const action of doc.modules['rovo:action']) {
      expect(declaredFunctions.has(action.function)).toBe(true);
    }
    for (const tool of doc.modules['rovo:mcp'][0].tools) {
      expect(declaredFunctions.has(tool.function)).toBe(true);
    }
    expect(declaredFunctions.has(doc.modules['jira:issuePanel'][0].resolver.function)).toBe(true);
  });
});
