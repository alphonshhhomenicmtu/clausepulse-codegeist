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

  it('declares all 4 procurement MCP action modules with valid functions', () => {
    const actionKeys = new Set(doc.modules.action.map((a: any) => a.key));
    for (const ref of [
      'audit_contract_clauses',
      'forecast_renewal_exposure',
      'build_cfo_approval_memo',
      'query_vendor_graph'
    ]) {
      expect(actionKeys.has(ref)).toBe(true);
    }
  });

  it('declares rovo:mcp referencing 4 strictly typed procurement action tools', () => {
    const mcp = doc.modules['rovo:mcp'][0];
    expect(mcp.key).toBe('clausepulse-mcp');
    expect(mcp.name.length).toBeLessThanOrEqual(30);
    expect(mcp.tools).toEqual([
      'audit_contract_clauses',
      'forecast_renewal_exposure',
      'build_cfo_approval_memo',
      'query_vendor_graph'
    ]);

    const actionKeys = new Set(doc.modules.action.map((a: any) => a.key));
    for (const toolKey of mcp.tools) {
      expect(actionKeys.has(toolKey)).toBe(true);
    }
  });

  it('maps every declared module function key to modules.function within 23-char Forge limit', () => {
    const declaredFunctions = new Set(doc.modules.function.map((f: any) => f.key));
    for (const fn of doc.modules.function) {
      expect(fn.key.length).toBeLessThanOrEqual(23);
    }
    for (const action of doc.modules.action) {
      expect(declaredFunctions.has(action.function)).toBe(true);
    }
    expect(declaredFunctions.has(doc.modules['jira:issuePanel'][0].resolver.function)).toBe(true);
  });
});
