# ClausePulse

**Contract Renewal, Clause Risk & Vendor Procurement Approval Copilot for Atlassian Jira Service Management & Confluence**

ClausePulse is an Atlassian Forge app for Legal, Finance, Procurement, and RevOps. A deterministic commercial-clause policy engine, a Rovo agent (`ClausePulse Procurement & Legal Copilot`), an Atlassian MCP server (`rovo:mcp`), and a vendor graph connector sit on the same Jira Service Management ticket.

## What the engine scores

The gap it measures is the one between a Jira Service Management approval, the Confluence MSA or DPA, and the finance renewal calendar:

- A 60-day or 90-day auto-renewal notice can pass while Legal is still on an uncapped liability clause.
- Price-uplift clauses in the 7% to 12% annual range can be signed before Finance sees the escalator.
- Missing DPA, GDPR, or SOC2 Type II language shows up as a scored gap, with a redline, before the quarter-end signoff.

The TypeScript engine runs inside Atlassian Forge (`nodejs24.x`). This repo does not call a paid external LLM. Rovo orchestrates the prompt. ClausePulse scores the clause text against the playbook, computes opt-out deadlines and annualized dollars at risk, and writes the CFO and Legal memo in ADF and Markdown. Dollar figures come from the ticket fields and the playbook caps. Each finding's `suggestedRedline` is a template: it quotes the extracted number (notice days, cap months, uplift percent, Net days) and proposes playbook language. Treat that redline as a draft, not as a clause the vendor already signed.

## Architecture

- **`manifest.yml`**: Atlassian Forge `nodejs24.x` manifest declaring `jira:issuePanel`, `rovo:agent`, 8 `action` modules (4 Rovo agent actions + 4 MCP tool actions), `rovo:mcp`, and scoped permissions, validated against Atlassian's official `@forge/manifest` schema validator.
- **`src/contracts/clauseAnalyzer.ts`**: Deterministic commercial contract risk engine scoring auto-renewal traps, uncapped liability, unilateral price-uplift caps, DPA/GDPR/SOC2 compliance gaps, and net-payment term deviations against configurable playbook rules, complete with redline counter-proposals.
- **`src/contracts/renewalScheduler.ts`**: Exact opt-out notice window and annualized spend exposure calculator (30/60/90-day lock-in buckets and dollars at risk).
- **`src/graph/vendorGraph.ts`**: Teamwork Graph connector linking `VendorEntity` <-> `ConfluenceContractPage` <-> `JiraApprovalTicket` <-> `RenewalDeadlineNode`, plus a realistic SaaS procurement portfolio fallback.
- **`src/rovo/businessActions.ts`**: Typed Rovo action handlers (`scoreClauseRisk`, `calculateRenewalDeadlines`, `generateApprovalBrief`, `compareVendorTerms`) producing Atlassian Document Format (ADF) and Markdown executive briefs.
- **`src/mcp/procurementTools.ts`**: 4 strictly typed MCP tools (`audit_contract_clauses`, `forecast_renewal_exposure`, `build_cfo_approval_memo`, `query_vendor_graph`) with JSON Schema validation.
- **`src/resolvers/index.ts`**: Forge Resolver with `@forge/api` live adapter and deterministic standalone demo portfolio fallback.
- **`static/panel/`**: Vite + React + TypeScript Atlassian-styled Custom UI workbench (`--base=./`) featuring an Annualized Auto-Renewal Spend-at-Risk Countdown Strip, Interactive Clause Redline Heatmap, Teamwork Graph view, Rovo Copilot Simulator, and 1-Click CFO Approval Memo Preview.

## Live Demo & Architecture Deck

- **Interactive workbench (GitHub Pages):** [https://alphonshhhomenicmtu.github.io/clausepulse-codegeist/](https://alphonshhhomenicmtu.github.io/clausepulse-codegeist/) (HTTP 200 on 2026-11-27)
- **8-slide architecture deck (PDF):** [https://alphonshhhomenicmtu.github.io/clausepulse-codegeist/clausepulse-deck.pdf](https://alphonshhhomenicmtu.github.io/clausepulse-codegeist/clausepulse-deck.pdf) (HTTP 200 on 2026-11-27; local [`docs/clausepulse-deck.pdf`](./docs/clausepulse-deck.pdf), 555,919 bytes)
- **Repository:** [https://github.com/alphonshhhomenicmtu/clausepulse-codegeist](https://github.com/alphonshhhomenicmtu/clausepulse-codegeist)
- **Narrated demo, local Devpost upload:** [`docs/demo-narrated-1080p.mp4`](./docs/demo-narrated-1080p.mp4). H.264 + AAC stereo, 68.3 s, 5,169,096 bytes, probed 2026-11-27. The same filename on GitHub Pages returns HTTP 404. Upload this file on the Devpost form. Codegeist still needs a public video under 5 minutes. An earlier local cut, `docs/demo-1080p.mp4` (66.4 s, 4,892,902 bytes), is gitignored and is not the upload.

![ClausePulse Workbench Preview](./docs/screenshot-preview.png)

## Quick Verification

```bash
npm install
npm run typecheck
npm test          # Vitest. Verified 2026-11-27: 5 files, 34 passed, 34 total (Vitest 2.1.9)
npm run build
```

The long case in `tests/mcp-and-manifest.test.ts` runs `@forge/manifest` full validation and expects 0 errors and 0 warnings. `app.id` stays a placeholder until `forge register`.

## Documentation

- [`skill.md`](./skill.md): MCP and Rovo agent skill specification. MCP keys match the manifest: `audit_contract_clauses`, `forecast_renewal_exposure`, `build_cfo_approval_memo`, `query_vendor_graph`.
- [`DEPLOY_CHECKLIST.md`](./DEPLOY_CHECKLIST.md): Forge CLI registration, deploy, and a live smoke test.
- [`LICENSE`](./LICENSE): MIT License.
