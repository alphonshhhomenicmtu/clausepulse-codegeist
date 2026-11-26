# ClausePulse Deployment & Verification Checklist

## 1. Local Pre-Flight Checks
- [ ] `npm install` completes cleanly
- [ ] `npm run typecheck` (`tsc --noEmit`) exits with `0` errors
- [ ] `npm test` (`vitest run`) passes all unit and integration tests
- [ ] `npm run build` (`vite build --base=./`) outputs `static/panel/dist/index.html` with relative asset paths

## 2. Atlassian Forge Registration & Deployment
1. Ensure Forge CLI (`@forge/cli`) is installed and authenticated (`forge login`).
2. Register the app to replace the placeholder `app.id` in `manifest.yml`:
   ```bash
   forge register
   ```
3. Build the Custom UI bundle:
   ```bash
   npm run build
   ```
4. Deploy to development or production environment:
   ```bash
   forge deploy -e development
   ```
5. Install on your Jira Service Management + Confluence Cloud site:
   ```bash
   forge install --site <your-site>.atlassian.net --product jira
   ```

## 3. Live Smoke Test on Atlassian Cloud
- [ ] Open a Jira Service Management procurement ticket and confirm the **ClausePulse Procurement & Renewal Workbench** issue panel renders with zero console errors.
- [ ] Open Rovo Chat and invoke `@ClausePulse Procurement & Legal Copilot` with:
  - `"Calculate annualized spend at risk for renewals closing in the next 60 days"`
  - `"Generate a CFO & Legal signoff brief for our Snowflake renewal ticket"`
- [ ] Verify MCP tool discovery (`rovo:mcp`) lists all 4 tools: `audit_contract_clauses`, `forecast_renewal_exposure`, `build_cfo_approval_memo`, and `query_vendor_graph`.
