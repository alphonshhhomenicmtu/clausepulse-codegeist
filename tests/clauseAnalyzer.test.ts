import { describe, expect, it } from 'vitest';
import { auditContractClauses, DEFAULT_PLAYBOOK } from '../src/contracts/clauseAnalyzer.js';

describe('ClausePulse deterministic clauseAnalyzer', () => {
  it('flags 60-day auto-renewal trap and generates 30-day redline', () => {
    const result = auditContractClauses({
      vendorName: 'Acme Analytics',
      annualSpendUsd: 100000,
      contractText:
        'This Order Form automatically renews for 12 months unless written notice is provided 60 days prior to expiration. Aggregate liability shall not exceed 12 months of fees. Net-45. Includes DPA and SOC 2 Type II.'
    });

    const autoRenewFinding = result.findings.find((f) => f.ruleId === 'AUTO_RENEWAL_TRAP');
    expect(autoRenewFinding).toBeDefined();
    expect(autoRenewFinding?.severity).toBe('CRITICAL');
    expect(autoRenewFinding?.suggestedRedline).toContain(`${DEFAULT_PLAYBOOK.maxAutoRenewalNoticeDays} days`);
  });

  it('flags uncapped liability as CRITICAL and recommends BLOCK_UNTIL_REDLINED', () => {
    const result = auditContractClauses({
      vendorName: 'RiskyVendor',
      annualSpendUsd: 80000,
      contractText:
        'Customer assumes uncapped liability for third-party claims. Payment is Net-45. Executed DPA and SOC 2 Type II included.'
    });

    expect(result.findings.some((f) => f.ruleId === 'UNCAPPED_LIABILITY')).toBe(true);
    expect(result.approvalRecommendation).toBe('BLOCK_UNTIL_REDLINED');
  });

  it('flags supplier liability cap below 12 months of fees', () => {
    const result = auditContractClauses({
      vendorName: 'LowCap SaaS',
      annualSpendUsd: 90000,
      contractText:
        'Supplier aggregate liability shall not exceed 3 months of fees paid. Net-45. Executed DPA and SOC 2 Type II.'
    });

    const finding = result.findings.find((f) => f.ruleId === 'UNCAPPED_LIABILITY');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('HIGH');
  });

  it('flags annual price uplift above 5% playbook ceiling', () => {
    const result = auditContractClauses({
      vendorName: 'PriceyCloud',
      annualSpendUsd: 200000,
      contractText:
        'Renewal fees may include an annual price increase of 9% upon renewal. Net-45. Includes DPA and SOC 2 Type II.'
    });

    const finding = result.findings.find((f) => f.ruleId === 'PRICE_UPLIFT_EXCESS');
    expect(finding).toBeDefined();
    expect(finding?.businessImpact).toContain('$18,000/yr');
  });

  it('flags missing DPA / GDPR and SOC 2 Type II controls', () => {
    const result = auditContractClauses({
      vendorName: 'NoSecurityCo',
      annualSpendUsd: 50000,
      contractText:
        'Service is provided on an as-is security basis without SOC 2 or DPA. Payment is Net-45.'
    });

    const finding = result.findings.find((f) => f.ruleId === 'COMPLIANCE_GAP');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('HIGH');
  });

  it('flags Net-15 payment terms as deviation from Net-45 corporate standard', () => {
    const result = auditContractClauses({
      vendorName: 'FastPay Inc',
      annualSpendUsd: 40000,
      contractText:
        'Invoices are payable Net-15 from invoice date. Mutual liability capped at 12 months of fees. DPA and SOC 2 Type II included.'
    });

    const finding = result.findings.find((f) => f.ruleId === 'PAYMENT_TERM_DEVIATION');
    expect(finding).toBeDefined();
    expect(finding?.suggestedRedline).toContain('Net-45');
  });

  it('approves clean playbook-compliant contract with 0 risk score', () => {
    const result = auditContractClauses({
      vendorName: 'CleanVendor',
      annualSpendUsd: 60000,
      contractText:
        'Renews only by mutual written agreement. Price increase capped at 3%. Mutual aggregate liability shall not exceed 12 months of fees. Invoices payable Net-45. Executed DPA and SOC 2 Type II incorporated.'
    });

    expect(result.riskScore).toBe(0);
    expect(result.riskTier).toBe('LOW');
    expect(result.approvalRecommendation).toBe('STANDARD_APPROVAL');
    expect(result.findings).toHaveLength(0);
  });

  it('flags a liability-free contract instead of calling the missing cap compliant', () => {
    const result = auditContractClauses({
      vendorName: 'NoCap Vendor',
      annualSpendUsd: 250000,
      contractText:
        'Renews only by mutual written agreement. Price increase capped at 3%. Invoices payable Net-45. Executed DPA and SOC 2 Type II incorporated.',
    });

    const missing = result.findings.find((finding) => finding.ruleId === 'MISSING_LIABILITY_CAP');
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe('HIGH');
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.riskTier).not.toBe('LOW');
    expect(result.approvalRecommendation).not.toBe('STANDARD_APPROVAL');
    expect(result.approvalRecommendation).toBe('FINANCE_LEGAL_REVIEW');
    expect(result.passedChecks.join(' ')).not.toMatch(/aligns with 12-month baseline/);
  });
});
