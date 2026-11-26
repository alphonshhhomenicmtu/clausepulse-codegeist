import { queryVendorGraph } from '../graph/vendorGraph.js';
import {
  assertSafePlainObject,
  handleCalculateRenewalDeadlines,
  handleGenerateApprovalBrief,
  handleScoreClauseRisk
} from '../rovo/businessActions.js';

export const MCP_PROTOCOL_VERSION = '2025-03-26';

export type McpToolName =
  | 'audit_contract_clauses'
  | 'forecast_renewal_exposure'
  | 'build_cfo_approval_memo'
  | 'query_vendor_graph';

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean';
  description: string;
}

export interface McpToolDefinition {
  name: McpToolName;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required: string[];
    additionalProperties: boolean;
  };
}

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'audit_contract_clauses',
    description:
      'Audits contract clause text against commercial playbook rules and returns risk score, severity breakdown, and redline counter-proposals.',
    inputSchema: {
      type: 'object',
      properties: {
        vendorName: { type: 'string', description: 'Canonical vendor name' },
        contractText: { type: 'string', description: 'MSA/DPA/Order Form clause text' },
        annualSpendUsd: { type: 'number', description: 'Annualized spend in USD' }
      },
      required: ['vendorName', 'contractText'],
      additionalProperties: false
    }
  },
  {
    name: 'forecast_renewal_exposure',
    description:
      'Calculates opt-out notice deadlines and annualized USD spend at risk within 30, 60, and 90-day auto-renewal lock-in windows.',
    inputSchema: {
      type: 'object',
      properties: {
        referenceDateIso: { type: 'string', description: 'Evaluation date YYYY-MM-DD' },
        horizonDays: { type: 'number', description: 'Lookahead window in days (1-365)' }
      },
      required: [],
      additionalProperties: false
    }
  },
  {
    name: 'build_cfo_approval_memo',
    description:
      'Generates an executive CFO & Legal procurement approval brief in Atlassian Document Format (ADF) and Markdown.',
    inputSchema: {
      type: 'object',
      properties: {
        vendorId: { type: 'string', description: 'Vendor ID or Jira ticket key' },
        includeRedlines: { type: 'boolean', description: 'Include redline counter-proposals' }
      },
      required: ['vendorId'],
      additionalProperties: false
    }
  },
  {
    name: 'query_vendor_graph',
    description:
      'Queries the Teamwork Graph linking Vendor Entity, Active MSA/DPA Confluence page, Jira/JSM Budget Approval Ticket, and Renewal Deadline.',
    inputSchema: {
      type: 'object',
      properties: {
        vendorId: { type: 'string', description: 'Optional vendor filter' },
        statusFilter: { type: 'string', description: 'Optional Jira ticket status filter' }
      },
      required: [],
      additionalProperties: false
    }
  }
];

function validateAgainstSchema(
  toolName: string,
  schema: McpToolDefinition['inputSchema'],
  rawArgs: unknown
): Record<string, unknown> {
  const args = assertSafePlainObject(rawArgs, `arguments for "${toolName}"`);

  for (const requiredKey of schema.required) {
    const val = args[requiredKey];
    if (val === undefined || val === null || val === '') {
      throw new Error(`Missing required MCP argument: "${requiredKey}"`);
    }
  }

  for (const [key, val] of Object.entries(args)) {
    const prop = schema.properties[key];
    if (!prop) {
      if (schema.additionalProperties === false) {
        throw new Error(`Unexpected MCP argument: "${key}"`);
      }
      continue;
    }
    if (val === undefined) continue;
    if (prop.type === 'number' && (typeof val !== 'number' || !Number.isFinite(val))) {
      throw new Error(`Invalid type for "${key}": expected number`);
    }
    if (prop.type === 'string') {
      if (typeof val !== 'string') {
        throw new Error(`Invalid type for "${key}": expected string`);
      }
      if (key !== 'contractText' && val.length > 256) {
        throw new RangeError(`Argument "${key}" exceeds maximum length (256 characters).`);
      }
    }
    if (prop.type === 'boolean' && typeof val !== 'boolean') {
      throw new Error(`Invalid type for "${key}": expected boolean`);
    }
  }

  return args;
}

/**
 * Executes one of the 4 strictly typed ClausePulse MCP tools with JSON Schema validation.
 */
export function executeMcpTool(
  toolName: McpToolName | string,
  rawArgs: unknown = {}
): unknown {
  if (typeof toolName !== 'string' || toolName.trim().length === 0 || toolName.length > 128) {
    throw new Error('Invalid MCP tool name: expected a non-empty string.');
  }

  const definition = MCP_TOOL_DEFINITIONS.find((t) => t.name === toolName);
  if (!definition) {
    throw new Error(`Unknown MCP tool: "${toolName}"`);
  }

  const args = validateAgainstSchema(definition.name, definition.inputSchema, rawArgs);

  switch (definition.name) {
    case 'audit_contract_clauses':
      return handleScoreClauseRisk({
        vendorName: args.vendorName as string,
        contractText: args.contractText as string,
        annualSpendUsd: args.annualSpendUsd as number | undefined
      });

    case 'forecast_renewal_exposure':
      return handleCalculateRenewalDeadlines({
        referenceDateIso: args.referenceDateIso as string | undefined,
        horizonDays: args.horizonDays as number | undefined
      });

    case 'build_cfo_approval_memo':
      return handleGenerateApprovalBrief({
        vendorId: args.vendorId as string,
        includeRedlines: args.includeRedlines as boolean | undefined
      });

    case 'query_vendor_graph':
      return queryVendorGraph({
        vendorId: args.vendorId as string | undefined,
        statusFilter: args.statusFilter as string | undefined
      });
  }
}

function extractValidRpcId(rawId: unknown): { valid: boolean; id: string | number | null } {
  if (rawId === undefined || rawId === null) {
    return { valid: true, id: null };
  }
  if (typeof rawId === 'string') {
    return rawId.length <= 256 ? { valid: true, id: rawId } : { valid: false, id: null };
  }
  if (typeof rawId === 'number' && Number.isFinite(rawId)) {
    return { valid: true, id: rawId };
  }
  return { valid: false, id: null };
}

/**
 * Hardened JSON-RPC 2.0 MCP server dispatcher supporting initialize, ping,
 * tools/list, and tools/call with zero unhandled exceptions.
 */
export function handleMcpJsonRpc(request: McpJsonRpcRequest | unknown): McpJsonRpcResponse {
  let id: string | number | null = null;
  try {
    let envelope: Record<string, unknown>;
    try {
      envelope = assertSafePlainObject(request, 'JSON-RPC request');
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: `Invalid Request: ${err instanceof Error ? err.message : 'Request must be a JSON object.'}`
        }
      };
    }

    const parsedId = extractValidRpcId(envelope.id);
    if (!parsedId.valid) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Invalid Request: id must be a string, finite number, or null.'
        }
      };
    }
    id = parsedId.id;

    if (envelope.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0".' }
      };
    }

    if (
      typeof envelope.method !== 'string' ||
      envelope.method.trim().length === 0 ||
      envelope.method.length > 128
    ) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request: method must be a non-empty string.' }
      };
    }

    const method = envelope.method;

    if (method === 'initialize') {
      if (envelope.params !== undefined) {
        try {
          assertSafePlainObject(envelope.params, 'initialize params');
        } catch (err) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: `Invalid params: ${err instanceof Error ? err.message : 'params must be an object.'}`
            }
          };
        }
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false }
          },
          serverInfo: {
            name: 'clausepulse-mcp',
            version: '1.0.0'
          }
        }
      };
    }

    if (method === 'notifications/initialized') {
      return {
        jsonrpc: '2.0',
        id,
        result: { acknowledged: true }
      };
    }

    if (method === 'ping') {
      return {
        jsonrpc: '2.0',
        id,
        result: {}
      };
    }

    if (method === 'tools/list') {
      if (envelope.params !== undefined) {
        try {
          assertSafePlainObject(envelope.params, 'tools/list params');
        } catch (err) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: `Invalid params: ${err instanceof Error ? err.message : 'params must be an object.'}`
            }
          };
        }
      }
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: MCP_TOOL_DEFINITIONS }
      };
    }

    if (method === 'tools/call') {
      let params: Record<string, unknown>;
      try {
        params = assertSafePlainObject(envelope.params, 'tools/call params');
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: `Invalid params: ${err instanceof Error ? err.message : 'params must be a plain object.'}`
          }
        };
      }

      const toolName = typeof params.name === 'string' ? params.name.trim() : '';
      if (!toolName) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Invalid params: tool name is required.' }
        };
      }

      const definition = MCP_TOOL_DEFINITIONS.find((t) => t.name === toolName);
      if (!definition) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Unknown MCP tool: "${toolName}"`
          }
        };
      }

      const rawArgs = params.arguments === undefined ? {} : params.arguments;
      try {
        const output = executeMcpTool(definition.name, rawArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(output) }],
            structuredContent: output
          }
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid MCP tool parameters.';
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: `Invalid params: ${message}`
          }
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : 'Internal JSON-RPC error.'
      }
    };
  }
}
