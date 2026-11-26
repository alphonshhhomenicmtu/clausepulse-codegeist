import React, { useMemo, useState } from 'react';
import { auditContractClauses } from '../../../src/contracts/clauseAnalyzer';
import { forecastRenewalPortfolio } from '../../../src/contracts/renewalScheduler';
import { DEMO_VENDOR_PORTFOLIO, queryVendorGraph } from '../../../src/graph/vendorGraph';
import {
  handleCompareVendorTerms,
  handleGenerateApprovalBrief
} from '../../../src/rovo/businessActions';

type TabKey = 'heatmap' | 'graph' | 'rovo' | 'memo';

const REFERENCE_DATE_ISO = '2026-11-27';

export function App(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<TabKey>('heatmap');
  const [horizonDays, setHorizonDays] = useState<number>(90);
  const [selectedVendorId, setSelectedVendorId] = useState<string>(
    DEMO_VENDOR_PORTFOLIO[0].vendorId
  );
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [memoFormat, setMemoFormat] = useState<'markdown' | 'adf'>('markdown');
  const [copiedMemo, setCopiedMemo] = useState<boolean>(false);
  const [customClauseText, setCustomClauseText] = useState<string>(
    'Customer agrees to auto-renew for 12 months unless written notice is sent 60 days prior. Renewal uplift of 8% applies. Payment is Net-15.'
  );
  const [rovoPrompt, setRovoPrompt] = useState<string>(
    'Calculate annualized spend at risk for renewals closing in the next 60 days'
  );

  const forecast = useMemo(
    () => forecastRenewalPortfolio(DEMO_VENDOR_PORTFOLIO, REFERENCE_DATE_ISO, horizonDays),
    [horizonDays]
  );

  const selectedVendor = useMemo(
    () =>
      DEMO_VENDOR_PORTFOLIO.find((v) => v.vendorId === selectedVendorId) ??
      DEMO_VENDOR_PORTFOLIO[0],
    [selectedVendorId]
  );

  const selectedAudit = useMemo(
    () =>
      auditContractClauses({
        vendorName: selectedVendor.vendorName,
        contractText: selectedVendor.contractExcerpt,
        annualSpendUsd: selectedVendor.annualSpendUsd
      }),
    [selectedVendor]
  );

  const customAudit = useMemo(
    () =>
      auditContractClauses({
        vendorName: 'Custom Clause Sandbox',
        contractText: customClauseText,
        annualSpendUsd: 120000
      }),
    [customClauseText]
  );

  const vendorGraph = useMemo(
    () => queryVendorGraph({ vendorId: selectedVendor.vendorId }),
    [selectedVendor.vendorId]
  );

  const approvalBrief = useMemo(
    () => handleGenerateApprovalBrief({ vendorId: selectedVendor.vendorId, includeRedlines: true }),
    [selectedVendor.vendorId]
  );

  const comparison = useMemo(
    () =>
      handleCompareVendorTerms({
        primaryVendorId: selectedVendor.vendorId,
        secondaryVendorId: 'vendor-figma'
      }),
    [selectedVendor.vendorId]
  );

  const rovoResponse = useMemo(() => {
    const q = rovoPrompt.toLowerCase();
    if (q.includes('compare')) {
      return JSON.stringify(comparison, null, 2);
    }
    if (q.includes('brief') || q.includes('cfo') || q.includes('memo')) {
      return approvalBrief.markdown;
    }
    if (q.includes('risk') || q.includes('clause') || q.includes('audit')) {
      return JSON.stringify(selectedAudit, null, 2);
    }
    const horizon = q.includes('30') ? 30 : q.includes('60') ? 60 : 90;
    const f = forecastRenewalPortfolio(DEMO_VENDOR_PORTFOLIO, REFERENCE_DATE_ISO, horizon);
    return JSON.stringify(
      {
        referenceDateIso: f.referenceDateIso,
        horizonDays: f.horizonDays,
        totalSpendAtRiskUsd: f.totalSpendAtRiskUsd,
        urgentContracts: f.contracts
          .filter((c) => c.spendAtRiskUsd > 0)
          .map((c) => ({
            vendorName: c.vendorName,
            optOutDeadlineIso: c.optOutDeadlineIso,
            daysUntilOptOut: c.daysUntilOptOut,
            spendAtRiskUsd: c.spendAtRiskUsd,
            actionRequired: c.actionRequired
          }))
      },
      null,
      2
    );
  }, [rovoPrompt, comparison, approvalBrief, selectedAudit]);

  const handleCopyMemo = async () => {
    const text =
      memoFormat === 'markdown'
        ? approvalBrief.markdown
        : JSON.stringify(approvalBrief.adf, null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      setCopiedMemo(true);
      setTimeout(() => setCopiedMemo(false), 1800);
    } catch {
      setCopiedMemo(false);
    }
  };

  return (
    <div className="cp-shell">
      <header className="cp-header">
        <div className="cp-brand">
          <div className="cp-logo">CP</div>
          <div>
            <h1 className="cp-title">ClausePulse Procurement &amp; Renewal Workbench</h1>
            <p className="cp-subtitle">
              Atlassian Forge · Rovo Agent · MCP · Teamwork Graph (Apps for Business Teams)
            </p>
          </div>
        </div>
        <div className="cp-controls">
          <span className="cp-subtitle">Lookahead Window:</span>
          {[30, 60, 90].map((d) => (
            <button
              key={d}
              type="button"
              className={`cp-btn ${horizonDays === d ? 'cp-btn-primary' : ''}`}
              onClick={() => setHorizonDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </header>

      <section className="cp-strip" aria-label="Annualized Spend at Risk Countdown">
        <div className="cp-kpi">
          <div className="cp-kpi-label">Portfolio Annual Spend</div>
          <div className="cp-kpi-value">
            ${forecast.totalPortfolioSpendUsd.toLocaleString('en-US')}
          </div>
          <div className="cp-kpi-meta">{forecast.contracts.length} active vendor MSAs</div>
        </div>
        <div className="cp-kpi">
          <div className="cp-kpi-label">Spend at Risk ({horizonDays}d Window)</div>
          <div className="cp-kpi-value" style={{ color: 'var(--critical)' }}>
            ${forecast.totalSpendAtRiskUsd.toLocaleString('en-US')}
          </div>
          <div className="cp-kpi-meta">Auto-renewing before {horizonDays}d opt-out cutoff</div>
        </div>
        <div className="cp-kpi">
          <div className="cp-kpi-label">Critical (&lt;= 30 Days)</div>
          <div className="cp-kpi-value" style={{ color: 'var(--high)' }}>
            ${forecast.within30DaysUsd.toLocaleString('en-US')}
          </div>
          <div className="cp-kpi-meta">Immediate non-renewal notice needed</div>
        </div>
        <div className="cp-kpi">
          <div className="cp-kpi-label">Warning (31–60 Days)</div>
          <div className="cp-kpi-value" style={{ color: 'var(--primary)' }}>
            ${forecast.within60DaysUsd.toLocaleString('en-US')}
          </div>
          <div className="cp-kpi-meta">Legal &amp; Finance redline queue</div>
        </div>
      </section>

      <nav className="cp-tabs" aria-label="Workbench Views">
        <button
          type="button"
          className={`cp-tab ${activeTab === 'heatmap' ? 'cp-tab-active' : ''}`}
          onClick={() => setActiveTab('heatmap')}
        >
          Clause Redline Heatmap
        </button>
        <button
          type="button"
          className={`cp-tab ${activeTab === 'graph' ? 'cp-tab-active' : ''}`}
          onClick={() => setActiveTab('graph')}
        >
          Teamwork Graph Lineage
        </button>
        <button
          type="button"
          className={`cp-tab ${activeTab === 'rovo' ? 'cp-tab-active' : ''}`}
          onClick={() => setActiveTab('rovo')}
        >
          Rovo Copilot Simulator
        </button>
        <button
          type="button"
          className={`cp-tab ${activeTab === 'memo' ? 'cp-tab-active' : ''}`}
          onClick={() => setActiveTab('memo')}
        >
          1-Click CFO Approval Memo
        </button>
      </nav>

      <div className="cp-grid">
        <aside className="cp-card">
          <h3>Vendor Renewal Queue</h3>
          <div className="cp-vendor-list">
            {forecast.contracts.map((item) => {
              const isSelected = item.vendorId === selectedVendor.vendorId;
              const badgeClass =
                item.urgencyBucket === 'CRITICAL_30D' || item.urgencyBucket === 'LOCKED_IN'
                  ? 'badge-CRITICAL'
                  : item.urgencyBucket === 'WARNING_60D'
                    ? 'badge-HIGH'
                    : item.urgencyBucket === 'WATCH_90D'
                      ? 'badge-MODERATE'
                      : 'badge-OK';
              return (
                <button
                  key={item.vendorId}
                  type="button"
                  className={`cp-vendor-item ${isSelected ? 'cp-vendor-item-active' : ''}`}
                  onClick={() => {
                    setSelectedVendorId(item.vendorId);
                    setSelectedRuleId(null);
                  }}
                >
                  <div className="cp-vendor-row">
                    <strong>{item.vendorName}</strong>
                    <span className={`cp-badge ${badgeClass}`}>
                      {item.daysUntilOptOut >= 0
                        ? `${item.daysUntilOptOut}d left`
                        : 'Locked'}
                    </span>
                  </div>
                  <div className="cp-subtitle">
                    {item.jiraTicketKey} · ${item.annualSpendUsd.toLocaleString('en-US')}/yr ·
                    Opt-out {item.optOutDeadlineIso}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="cp-card">
          {activeTab === 'heatmap' && (
            <div>
              <div className="cp-vendor-row" style={{ marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>
                  {selectedVendor.vendorName} — Clause Risk Heatmap ({selectedAudit.riskScore}/100)
                </h3>
                <span className={`cp-badge badge-${selectedAudit.riskTier}`}>
                  {selectedAudit.riskTier} · {selectedAudit.approvalRecommendation}
                </span>
              </div>
              <p className="cp-subtitle" style={{ marginBottom: 14 }}>
                {selectedAudit.summary} Click any clause card below to inspect playbook policy and
                suggested redline counter-proposal.
              </p>

              <div className="cp-clause-list">
                {selectedAudit.findings.length === 0 ? (
                  <div className="cp-redline-box">
                    All commercial playbook checks passed for {selectedVendor.vendorName}.
                  </div>
                ) : (
                  selectedAudit.findings.map((finding) => {
                    const expanded =
                      selectedRuleId === finding.ruleId ||
                      (selectedRuleId === null &&
                        selectedAudit.findings[0]?.ruleId === finding.ruleId);
                    return (
                      <div
                        key={finding.ruleId}
                        className={`cp-clause-card ${expanded ? 'cp-clause-card-active' : ''}`}
                        onClick={() => setSelectedRuleId(finding.ruleId)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setSelectedRuleId(finding.ruleId);
                          }
                        }}
                      >
                        <div className="cp-vendor-row">
                          <strong>
                            {finding.clauseCategory} ({finding.ruleId})
                          </strong>
                          <span className={`cp-badge badge-${finding.severity}`}>
                            {finding.severity} (+{finding.riskScorePoints} pts)
                          </span>
                        </div>
                        <p style={{ margin: '6px 0', fontSize: 13 }}>
                          <em>“{finding.matchedExcerpt}”</em>
                        </p>
                        {expanded && (
                          <div>
                            <div style={{ fontSize: 13, marginBottom: 6 }}>
                              <strong>Playbook Rule:</strong> {finding.policyRule}
                            </div>
                            <div style={{ fontSize: 13, marginBottom: 6 }}>
                              <strong>Business Impact:</strong> {finding.businessImpact}
                            </div>
                            <div className="cp-redline-box">
                              <strong>Suggested Redline:</strong> {finding.suggestedRedline}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div style={{ marginTop: 18 }}>
                <h3>Live Clause Audit Sandbox</h3>
                <textarea
                  className="cp-textarea"
                  value={customClauseText}
                  onChange={(e) => setCustomClauseText(e.target.value)}
                  aria-label="Custom contract clause text"
                />
                <div className="cp-subtitle" style={{ marginTop: 6 }}>
                  Instant Score: <strong>{customAudit.riskScore}/100</strong> ({customAudit.riskTier}
                  ) · {customAudit.findings.length} finding(s) ·{' '}
                  {customAudit.approvalRecommendation}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'graph' && (
            <div>
              <h3>Teamwork Graph Lineage — {selectedVendor.vendorName}</h3>
              <p className="cp-subtitle" style={{ marginBottom: 12 }}>
                Links Vendor Entity → Confluence MSA/DPA Page → Jira Service Management Ticket →
                Renewal Opt-Out Deadline.
              </p>
              <div className="cp-graph-grid">
                {vendorGraph.nodes.map((node) => (
                  <div key={node.id} className="cp-graph-node">
                    <div className="cp-kpi-label">{node.type.replace('_', ' ')}</div>
                    <div style={{ fontWeight: 700, margin: '6px 0 4px' }}>{node.label}</div>
                    <div className="cp-subtitle">{node.subtitle}</div>
                    <div style={{ marginTop: 8 }}>
                      <span className="cp-badge badge-MODERATE">{node.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'rovo' && (
            <div>
              <h3>Rovo Procurement &amp; Legal Copilot Simulator</h3>
              <div className="cp-tabs" style={{ marginBottom: 10 }}>
                {[
                  'Calculate annualized spend at risk for renewals closing in the next 60 days',
                  'Audit this vendor MSA for auto-renewal traps and uncapped liability',
                  'Generate a CFO & Legal signoff brief for this renewal ticket',
                  'Compare incumbent vendor terms against Figma baseline'
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="cp-btn"
                    onClick={() => setRovoPrompt(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={rovoPrompt}
                onChange={(e) => setRovoPrompt(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  marginBottom: 12
                }}
                aria-label="Rovo Copilot Prompt"
              />
              <pre className="cp-pre">{rovoResponse}</pre>
            </div>
          )}

          {activeTab === 'memo' && (
            <div>
              <div className="cp-vendor-row" style={{ marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>
                  CFO &amp; Legal Approval Memo — {selectedVendor.vendorName}
                </h3>
                <div className="cp-controls">
                  <button
                    type="button"
                    className={`cp-btn ${memoFormat === 'markdown' ? 'cp-btn-primary' : ''}`}
                    onClick={() => setMemoFormat('markdown')}
                  >
                    Markdown
                  </button>
                  <button
                    type="button"
                    className={`cp-btn ${memoFormat === 'adf' ? 'cp-btn-primary' : ''}`}
                    onClick={() => setMemoFormat('adf')}
                  >
                    Atlassian ADF JSON
                  </button>
                  <button type="button" className="cp-btn" onClick={handleCopyMemo}>
                    {copiedMemo ? 'Copied!' : 'Copy Memo'}
                  </button>
                </div>
              </div>
              <pre className="cp-pre">
                {memoFormat === 'markdown'
                  ? approvalBrief.markdown
                  : JSON.stringify(approvalBrief.adf, null, 2)}
              </pre>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
