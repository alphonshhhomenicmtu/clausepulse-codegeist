import { queryVendorGraph } from '../graph/vendorGraph.js';
import {
  handleCalculateRenewalDeadlines,
  handleGenerateApprovalBrief,
  handleScoreClauseRisk
} from '../rovo/businessActions.js';

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
      required: ['vendorName', 'contractText']
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
        horizonDays: { type: 'number', description: 'Lookahead window in days' }
      },
      required: []
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
      required: ['vendorId']
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
      required: []
    }
  }
];

function validateAgainstSchema(
  schema: McpToolDefinition['inputSchema'],
  args: Record<string, unknown>
): void {
  for (const requiredKey of schema.required) {
    const val = args[requiredKey];
    if (val === undefined || val === null || val === '') {
      throw new Error(`Missing required MCP argument: "${requiredKey}"`);
    }
  }

  for (const [key, prop] of Object.entries(schema.properties)) {
    const val = args[key];
    if (val === undefined) continue;
    if (prop.type === 'number' && (typeof val !== 'number' || Number.isNaN(val))) {
      throw new Error(`Invalid type for "${key}": expected number`);
    }
    if (prop.type === 'string' && typeof val !== 'string') {
      throw new Error(`Invalid type for "${key}": expected string`);
    }
    if (prop.type === 'boolean' && typeof val !== 'boolean') {
      throw new Error(`Invalid type for "${key}": expected boolean`);
    }
  }
}

/**
 * Executes one of the 4 strictly typed ClausePulse MCP tools with JSON Schema validation.
 */
export function executeMcpTool(
  toolName: McpToolName,
  rawArgs: Record<string, unknown> = {}
): unknown {
  const definition = MCP_TOOL_DEFINITIONS.find((t) => t.name === toolName);
  if (!definition) {
    throw new Error(`Unknown MCP tool: "${toolName}"`);
  }

  validateAgainstSchema(definition.inputSchema, rawArgs);

  switch (toolName) {
    case 'audit_contract_clauses':
      return handleScoreClauseRisk({
        vendorName: rawArgs.vendorName as string,
        contractText: rawArgs.contractText as string,
        annualSpendUsd: rawArgs.annualSpendUsd as number | undefined
      });

    case 'forecast_renewal_exposure':
      return handleCalculateRenewalDeadlines({
        referenceDateIso: rawArgs.referenceDateIso as string | undefined,
        horizonDays: rawArgs.horizonDays as number | undefined
      });

    case 'build_cfo_approval_memo':
      return handleGenerateApprovalBrief({
        vendorId: rawArgs.vendorId as string,
        includeRedlines: rawArgs.includeRedlines as boolean | undefined
      });

    case 'query_vendor_graph':
      return queryVendorGraph({
        vendorId: rawArgs.vendorId as string | undefined,
        statusFilter: rawArgs.statusFilter as string | undefined
      });
  }
}
