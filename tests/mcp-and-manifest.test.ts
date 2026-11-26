import fs from 'node:fs';
import path from 'node:path';
import {
  FullValidationProcessor,
  ManifestParserBuilder,
  validate
} from '@forge/manifest';
import { describe, expect, it } from 'vitest';
import {
  executeMcpTool,
  handleMcpJsonRpc,
  MCP_PROTOCOL_VERSION,
  MCP_TOOL_DEFINITIONS
} from '../src/mcp/procurementTools.js';
import {
  handleCalculateRenewalDeadlines,
  handleCompareVendorTerms,
  handleGenerateApprovalBrief,
  handleScoreClauseRisk
} from '../src/rovo/businessActions.js';
import * as resolvers from '../src/resolvers/index.js';

const manifestPath = path.resolve(process.cwd(), 'manifest.yml');
const panelDistDir = path.resolve(process.cwd(), 'static/panel/dist');
const panelIndexHtml = path.join(panelDistDir, 'index.html');

async function withPanelDistAvailable<T>(fn: () => Promise<T>): Promise<T> {
  const existed = fs.existsSync(panelIndexHtml);
  if (!existed) {
    fs.mkdirSync(panelDistDir, { recursive: true });
    fs.writeFileSync(panelIndexHtml, '<!doctype html><html><body></body></html>', 'utf8');
  }
  try {
    return await fn();
  } finally {
    if (!existed) {
      fs.rmSync(panelDistDir, { recursive: true, force: true });
    }
  }
}

describe('Official @forge/manifest Full Validation (ClausePulse)', () => {
  it('passes Atlassian official FullValidationProcessor with zero errors and zero warnings', async () => {
    await withPanelDistAvailable(async () => {
      const result = await validate(false, manifestPath);
      expect(result.errors ?? []).toEqual([]);
      expect(result.success).toBe(true);

      const processor = new FullValidationProcessor({
        deprecatedRuntimes: ['nodejs18.x', 'nodejs20.x']
      });
      const strictResult = await processor.process(manifestPath);
      expect(strictResult.errors ?? []).toEqual([]);
      expect(strictResult.success).toBe(true);
    });
  });

  it('parses via ManifestParserBuilder and verifies every declared handler export exists', () => {
    const content = fs.readFileSync(manifestPath, 'utf8');
    const parsed = new ManifestParserBuilder().build().parseManifest({
      content,
      filePath: manifestPath
    });

    expect(parsed.app?.runtime?.name).toBe('nodejs24.x');
    const agent = parsed.modules?.['rovo:agent']?.[0];
    expect(agent?.name.length).toBeLessThanOrEqual(30);
    for (const starter of agent?.conversationStarters ?? []) {
      expect(starter.length).toBeLessThanOrEqual(85);
    }

    const mcp = parsed.modules?.['rovo:mcp']?.[0];
    expect(mcp?.name.length).toBeLessThanOrEqual(30);
    expect(mcp?.tools).toHaveLength(4);

    const resolverExports = resolvers as Record<string, unknown>;
    for (const fn of parsed.modules?.function ?? []) {
      expect(fn.key.length).toBeLessThanOrEqual(23);
      const exportName = fn.handler.split('.').pop() ?? '';
      expect(resolverExports[exportName]).toBeDefined();
    }
  });
});

describe('MCP JSON-RPC 2.0 Protocol & Adversarial Hardening (ClausePulse)', () => {
  it('handles initialize, notifications/initialized, ping, and tools/list per MCP JSON-RPC 2.0', () => {
    const initResp = handleMcpJsonRpc({
      jsonrpc: '2.0',
      id: 'cp-init',
      method: 'initialize',
      params: { protocolVersion: MCP_PROTOCOL_VERSION }
    });
    expect(initResp.error).toBeUndefined();
    expect(initResp.result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'clausepulse-mcp', version: '1.0.0' }
    });

    const ack = handleMcpJsonRpc({
      jsonrpc: '2.0',
      id: null,
      method: 'notifications/initialized'
    });
    expect(ack.error).toBeUndefined();

    const ping = handleMcpJsonRpc({ jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(ping.error).toBeUndefined();
    expect(ping.result).toEqual({});

    const listResp = handleMcpJsonRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    expect(listResp.error).toBeUndefined();
    expect((listResp.result as { tools: unknown[] }).tools).toHaveLength(MCP_TOOL_DEFINITIONS.length);
  });

  it('executes all 4 procurement MCP tools cleanly over JSON-RPC tools/call', () => {
    const calls = [
      {
        name: 'audit_contract_clauses',
        arguments: {
          vendorName: 'Acme SaaS',
          contractText: 'Auto-renews unless 60 days notice. Uncapped liability. Net-15.',
          annualSpendUsd: 180000
        }
      },
      {
        name: 'forecast_renewal_exposure',
        arguments: { referenceDateIso: '2026-11-27', horizonDays: 60 }
      },
      {
        name: 'build_cfo_approval_memo',
        arguments: { vendorId: 'vendor-snowflake', includeRedlines: true }
      },
      {
        name: 'query_vendor_graph',
        arguments: { vendorId: 'vendor-snowflake' }
      }
    ];

    for (const [idx, params] of calls.entries()) {
      const resp = handleMcpJsonRpc({
        jsonrpc: '2.0',
        id: `cp-call-${idx}`,
        method: 'tools/call',
        params
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as { content: Array<{ type: string; text: string }>; structuredContent: unknown };
      expect(result.content[0].type).toBe('text');
      expect(result.structuredContent).toBeDefined();
    }
  });

  it('returns -32600 Invalid Request for malformed JSON-RPC envelopes without throwing', () => {
    const badInputs: unknown[] = [
      null,
      undefined,
      'invalid',
      999,
      [],
      { jsonrpc: '1.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: '' },
      { jsonrpc: '2.0', id: Number.NaN, method: 'tools/list' },
      { jsonrpc: '2.0', id: ['array-id'], method: 'tools/list' }
    ];

    for (const bad of badInputs) {
      const resp = handleMcpJsonRpc(bad);
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.error?.code).toBe(-32600);
    }
  });

  it('returns -32601 for unknown JSON-RPC methods and unregistered MCP tools', () => {
    const unknownMethod = handleMcpJsonRpc({
      jsonrpc: '2.0',
      id: 10,
      method: 'logging/setLevel'
    });
    expect(unknownMethod.error?.code).toBe(-32601);

    const unknownTool = handleMcpJsonRpc({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'approve_without_cfo', arguments: {} }
    });
    expect(unknownTool.error?.code).toBe(-32601);
  });

  it('returns -32602 for invalid params, Infinity/negative numbers, invalid dates, and extra fields', () => {
    const invalidCalls = [
      { jsonrpc: '2.0', id: 20, method: 'tools/call' },
      { jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: '' } },
      { jsonrpc: '2.0', id: 22, method: 'tools/call', params: { name: 'query_vendor_graph', arguments: ['bad'] } },
      { jsonrpc: '2.0', id: 23, method: 'tools/call', params: { name: 'build_cfo_approval_memo', arguments: {} } },
      {
        jsonrpc: '2.0',
        id: 24,
        method: 'tools/call',
        params: { name: 'build_cfo_approval_memo', arguments: { vendorId: 'vendor-unknown-999' } }
      },
      {
        jsonrpc: '2.0',
        id: 25,
        method: 'tools/call',
        params: {
          name: 'audit_contract_clauses',
          arguments: { vendorName: 'Acme', contractText: 'Net-45', annualSpendUsd: Number.POSITIVE_INFINITY }
        }
      },
      {
        jsonrpc: '2.0',
        id: 26,
        method: 'tools/call',
        params: {
          name: 'audit_contract_clauses',
          arguments: { vendorName: 'Acme', contractText: 'Net-45', annualSpendUsd: -100 }
        }
      },
      {
        jsonrpc: '2.0',
        id: 27,
        method: 'tools/call',
        params: {
          name: 'forecast_renewal_exposure',
          arguments: { referenceDateIso: '2026-02-31', horizonDays: 30 }
        }
      },
      {
        jsonrpc: '2.0',
        id: 28,
        method: 'tools/call',
        params: { name: 'query_vendor_graph', arguments: { unexpectedField: true } }
      }
    ];

    for (const req of invalidCalls) {
      const resp = handleMcpJsonRpc(req);
      expect(resp.error?.code).toBe(-32602);
    }
  });

  it('blocks prototype-pollution attacks in JSON-RPC requests, MCP args, and Rovo handlers', () => {
    const protoRpc = JSON.parse(
      '{"jsonrpc":"2.0","id":30,"method":"tools/call","params":{"name":"query_vendor_graph","arguments":{"__proto__":{"polluted":true}}}}'
    );
    const resp = handleMcpJsonRpc(protoRpc);
    expect(resp.error?.code).toBe(-32600);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    const ctorArgs = JSON.parse(
      '{"vendorName":"Acme","contractText":"Net-45","constructor":{"prototype":{"polluted":true}}}'
    );
    expect(() => executeMcpTool('audit_contract_clauses', ctorArgs)).toThrow(/Forbidden property key/);
    expect(() => handleScoreClauseRisk(ctorArgs)).toThrow(/Forbidden property key/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects oversized contract payloads, excessive keys, and deep nesting', () => {
    const oversizedContract = 'Clause '.repeat(6_000);
    const resp = handleMcpJsonRpc({
      jsonrpc: '2.0',
      id: 40,
      method: 'tools/call',
      params: {
        name: 'audit_contract_clauses',
        arguments: { vendorName: 'HugeCo', contractText: oversizedContract }
      }
    });
    expect(resp.error?.code).toBe(-32600);

    const manyKeys: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) {
      manyKeys[`k${i}`] = 'x';
    }
    expect(() => executeMcpTool('query_vendor_graph', manyKeys)).toThrow(/maximum key count/);

    let deep: Record<string, unknown> = { ok: true };
    for (let i = 0; i < 12; i++) {
      deep = { next: deep };
    }
    const deepResp = handleMcpJsonRpc({ jsonrpc: '2.0', id: 41, method: 'initialize', params: deep });
    expect(deepResp.error?.code).toBe(-32600);
  });

  it('hardens all Rovo business action handlers against null, non-string, and invalid date/horizon inputs', () => {
    expect(() => handleScoreClauseRisk(null as never)).toThrow(/plain JSON object/);
    expect(() => handleScoreClauseRisk({ contractText: '   ' })).toThrow(/non-empty string/);
    expect(() => handleCalculateRenewalDeadlines({ horizonDays: 0 })).toThrow(/between 1 and 365/);
    expect(() =>
      handleCalculateRenewalDeadlines({ referenceDateIso: 'not-a-date' })
    ).toThrow(/YYYY-MM-DD/);
    expect(() =>
      handleGenerateApprovalBrief({ vendorId: 'vendor-snowflake', includeRedlines: 'yes' as never })
    ).toThrow(/boolean/);
    expect(() =>
      handleCompareVendorTerms({ primaryVendorId: '', secondaryVendorId: 'vendor-datadog' })
    ).toThrow(/non-empty string/);
  });

  it('exposes hardened mcpJsonRpcHandler on the Forge resolver entrypoint', async () => {
    const resp = await resolvers.mcpJsonRpcHandler({
      jsonrpc: '2.0',
      id: 'resolver-cp-1',
      method: 'tools/list'
    });
    expect(resp.error).toBeUndefined();
    expect((resp.result as { tools: unknown[] }).tools).toHaveLength(4);
  });
});
