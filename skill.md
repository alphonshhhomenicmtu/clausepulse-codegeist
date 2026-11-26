# ClausePulse MCP & Rovo Skill Specification

**Name:** `clausepulse-procurement-copilot`  
**Version:** `1.0.0`  
**Category:** Apps for Business Teams (Legal, Finance, Procurement, RevOps)  
**Platform:** Atlassian Forge (`nodejs24.x`) + Rovo Agent + Atlassian MCP + Teamwork Graph

## Overview

ClausePulse connects Jira Service Management procurement tickets, Confluence MSA/DPA contract pages, and Finance renewal calendars into a single deterministic risk and approval workflow. It requires zero paid external LLM APIs: Rovo orchestrates user intent while ClausePulse's deterministic TypeScript engine evaluates commercial clauses, calculates opt-out deadlines, and builds CFO-ready approval memos.

## Exposed MCP Tools (`rovo:mcp`)

### 1. `audit_contract_clauses`
Scores raw contract text against the company commercial playbook (auto-renewal notice windows, liability caps, annual price-uplift caps, DPA/GDPR/SOC2 requirements, and Net-45 payment terms).

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "vendorName": { "type": "string" },
    "contractText": { "type": "string" },
    "annualSpendUsd": { "type": "number" }
  },
  "required": ["vendorName", "contractText"]
}
```

### 2. `forecast_renewal_exposure`
Computes exact opt-out notice deadlines and annualized USD spend at risk across 30-, 60-, and 90-day lock-in windows.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "referenceDateIso": { "type": "string" },
    "horizonDays": { "type": "number" }
  },
  "required": []
}
```

### 3. `build_cfo_approval_memo`
Generates a structured CFO & Legal Signoff Memo in both Atlassian Document Format (ADF) and Markdown, including risk score, opt-out deadline, and suggested redlines.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "vendorId": { "type": "string" },
    "includeRedlines": { "type": "boolean" }
  },
  "required": ["vendorId"]
}
```

### 4. `query_vendor_graph`
Queries the Teamwork Graph linking `VendorEntity` -> `ConfluenceContractPage` -> `JiraApprovalTicket` -> `RenewalDeadlineNode`.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "vendorId": { "type": "string" },
    "statusFilter": { "type": "string" }
  },
  "required": []
}
```

## Recommended Agent Workflow

1. Call `query_vendor_graph` to locate the vendor's active MSA Confluence page and JSM procurement ticket.
2. Call `forecast_renewal_exposure` to check whether the opt-out notice deadline falls within 30, 60, or 90 days.
3. Call `audit_contract_clauses` on the MSA/Order Form text to surface policy deviations and redline language.
4. Call `build_cfo_approval_memo` to produce a ready-to-post Jira/Confluence signoff brief.
