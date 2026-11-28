import type {
  ApprovalRecommendation,
  ClauseAuditInput,
  ClauseAuditResult,
  ClauseFinding,
  PlaybookConfig,
  RiskTier
} from '../types.js';

export const DEFAULT_PLAYBOOK: PlaybookConfig = {
  maxAutoRenewalNoticeDays: 30,
  maxAnnualUpliftPct: 5,
  minLiabilityCapMonths: 12,
  requireDpaSoc2: true,
  requiredPaymentTermsDays: 45
};

function extractSnippet(text: string, regex: RegExp, fallback: string): string {
  const match = text.match(regex);
  if (!match || match.index === undefined) {
    return fallback;
  }
  const start = Math.max(0, match.index - 24);
  const end = Math.min(text.length, match.index + match[0].length + 48);
  const raw = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return raw.length > 140 ? `${raw.slice(0, 137)}...` : raw;
}

function classifyTier(score: number): RiskTier {
  if (score >= 70) return 'CRITICAL';
  if (score >= 45) return 'HIGH';
  if (score >= 20) return 'MODERATE';
  return 'LOW';
}

function classifyRecommendation(
  score: number,
  findings: ClauseFinding[]
): ApprovalRecommendation {
  const hasCritical = findings.some((f) => f.severity === 'CRITICAL');
  const missingLiabilityCap = findings.some((f) => f.ruleId === 'MISSING_LIABILITY_CAP');
  if (hasCritical || score >= 65) {
    return 'BLOCK_UNTIL_REDLINED';
  }
  if (score >= 30 || missingLiabilityCap) {
    return 'FINANCE_LEGAL_REVIEW';
  }
  return 'STANDARD_APPROVAL';
}

/**
 * Deterministically audits commercial contract text against company playbook rules.
 * Flags auto-renewal traps, liability cap asymmetry, price uplift escalators,
 * DPA/SOC2 compliance gaps, and payment-term deviations.
 */
export function auditContractClauses(
  input: ClauseAuditInput,
  playbook: PlaybookConfig = DEFAULT_PLAYBOOK
): ClauseAuditResult {
  const text = input.contractText ?? '';
  const annualSpendUsd = Math.max(0, Number(input.annualSpendUsd ?? 0));
  const findings: ClauseFinding[] = [];
  const passedChecks: string[] = [];

  // 1. Auto-renewal notice trap check
  const autoRenewMatch = text.match(
    /(auto(?:matically)?[\s-]*renew(?:s|al)?[^.]{0,120}?(\d{2,3})\s*(?:calendar\s*)?days?)/i
  );
  const evergreenMatch = text.match(
    /(auto(?:matically)?[\s-]*renew(?:s|al)?|evergreen\s+term|successive\s+annual\s+terms)/i
  );

  if (autoRenewMatch) {
    const noticeDays = Number.parseInt(autoRenewMatch[2], 10);
    if (noticeDays > playbook.maxAutoRenewalNoticeDays) {
      findings.push({
        ruleId: 'AUTO_RENEWAL_TRAP',
        clauseCategory: 'Term & Renewal',
        severity: noticeDays >= 60 ? 'CRITICAL' : 'HIGH',
        matchedExcerpt: extractSnippet(
          text,
          /(auto(?:matically)?[\s-]*renew(?:s|al)?[^.]{0,120})/i,
          autoRenewMatch[0]
        ),
        policyRule: `Auto-renewal opt-out notice must not exceed ${playbook.maxAutoRenewalNoticeDays} days.`,
        riskScorePoints: noticeDays >= 60 ? 28 : 20,
        rationale: `Contract locks in another full term unless written notice is delivered at least ${noticeDays} days before expiration.`,
        suggestedRedline: `Replace "${noticeDays} days" with "${playbook.maxAutoRenewalNoticeDays} days" and add: "Supplier shall send written renewal reminder at least 45 days prior to the opt-out deadline; otherwise renewal converts to month-to-month."`,
        businessImpact:
          annualSpendUsd > 0
            ? `Exposes $${annualSpendUsd.toLocaleString('en-US')} in annualized spend to silent lock-in.`
            : 'Increases risk of involuntary multi-quarter vendor lock-in.'
      });
    } else {
      passedChecks.push(
        `Auto-renewal notice (${noticeDays} days) complies with <= ${playbook.maxAutoRenewalNoticeDays}-day playbook limit.`
      );
    }
  } else if (evergreenMatch) {
    findings.push({
      ruleId: 'AUTO_RENEWAL_TRAP',
      clauseCategory: 'Term & Renewal',
      severity: 'HIGH',
      matchedExcerpt: extractSnippet(
        text,
        /(auto(?:matically)?[\s-]*renew(?:s|al)?|evergreen\s+term|successive\s+annual\s+terms)/i,
        evergreenMatch[0]
      ),
      policyRule: `Auto-renewal requires explicit <= ${playbook.maxAutoRenewalNoticeDays}-day opt-out or mutual written renewal.`,
      riskScorePoints: 22,
      rationale: 'Evergreen renewal language lacks an explicit short opt-out window.',
      suggestedRedline:
        'This Agreement shall only renew upon mutual written Order Form executed by both parties at least 30 days prior to expiration.',
      businessImpact: 'Creates ambiguity around Finance cancellation cutoff dates.'
    });
  } else {
    passedChecks.push('No silent auto-renewal trap detected.');
  }

  // 2. Liability cap check
  const uncappedCustomerMatch = text.match(
    /(uncapped\s+liability|unlimited\s+liability|without\s+limitation\s+of\s+liability)/i
  );
  const lowCapMonthsMatch = text.match(
    /(?:aggregate\s+liability|liability\s+shall\s+not\s+exceed|liability\s+(?:is\s+)?capped\s+at)[^.]{0,80}?(\d{1,2})\s*months?\s*(?:of\s+)?fees/i
  );
  const lowCapFixedMatch = text.match(
    /(?:aggregate\s+liability|liability\s+shall\s+not\s+exceed)[^.]{0,80}?\$([0-9,]+)/i
  );

  if (uncappedCustomerMatch) {
    findings.push({
      ruleId: 'UNCAPPED_LIABILITY',
      clauseCategory: 'Limitation of Liability',
      severity: 'CRITICAL',
      matchedExcerpt: extractSnippet(
        text,
        /(uncapped\s+liability|unlimited\s+liability|without\s+limitation\s+of\s+liability)/i,
        uncappedCustomerMatch[0]
      ),
      policyRule: `Mutual liability cap must be at least ${playbook.minLiabilityCapMonths} months of fees with no uncapped general indemnity.`,
      riskScorePoints: 30,
      rationale: 'Uncapped liability exposes the balance sheet to disproportionate damages.',
      suggestedRedline:
        'Except for confidentiality breaches or willful misconduct, each party’s aggregate liability shall not exceed 12 months of fees paid or payable under the applicable Order Form.',
      businessImpact: 'Requires Legal + CFO signoff; blocks standard procurement approval.'
    });
  } else if (
    lowCapMonthsMatch &&
    Number.parseInt(lowCapMonthsMatch[1], 10) < playbook.minLiabilityCapMonths
  ) {
    const capMonths = Number.parseInt(lowCapMonthsMatch[1], 10);
    findings.push({
      ruleId: 'UNCAPPED_LIABILITY',
      clauseCategory: 'Limitation of Liability',
      severity: 'HIGH',
      matchedExcerpt: extractSnippet(
        text,
        /(?:aggregate\s+liability|liability\s+shall\s+not\s+exceed)[^.]{0,100}/i,
        lowCapMonthsMatch[0]
      ),
      policyRule: `Supplier liability cap must be >= ${playbook.minLiabilityCapMonths} months of fees.`,
      riskScorePoints: 20,
      rationale: `Supplier liability is capped at only ${capMonths} months of fees, below the ${playbook.minLiabilityCapMonths}-month baseline.`,
      suggestedRedline: `Increase Supplier aggregate liability cap from ${capMonths} months to ${playbook.minLiabilityCapMonths} months of fees (and 2x fees for data security / DPA breaches).`,
      businessImpact: 'Leaves company under-protected in the event of a service failure or breach.'
    });
  } else if (lowCapFixedMatch) {
    const fixedDollar = Number.parseInt(lowCapFixedMatch[1].replace(/,/g, ''), 10);
    if (annualSpendUsd > 0 && fixedDollar < annualSpendUsd) {
      findings.push({
        ruleId: 'UNCAPPED_LIABILITY',
        clauseCategory: 'Limitation of Liability',
        severity: 'HIGH',
        matchedExcerpt: extractSnippet(
          text,
          /(?:aggregate\s+liability|liability\s+shall\s+not\s+exceed)[^.]{0,100}/i,
          lowCapFixedMatch[0]
        ),
        policyRule: `Liability cap ($${fixedDollar.toLocaleString('en-US')}) must not be below 12 months of ACV ($${annualSpendUsd.toLocaleString('en-US')}).`,
        riskScorePoints: 22,
        rationale: 'Fixed-dollar cap is lower than annual contract spend.',
        suggestedRedline:
          'Replace fixed dollar cap with "100% of fees paid or payable in the twelve (12) months preceding the claim."',
        businessImpact: 'Recovery is capped below even a single year of subscription fees.'
      });
    } else {
      passedChecks.push('Liability cap meets commercial threshold.');
    }
  } else if (lowCapMonthsMatch) {
    passedChecks.push(
      `Liability cap clause aligns with ${playbook.minLiabilityCapMonths}-month baseline.`,
    );
  } else {
    findings.push({
      ruleId: 'MISSING_LIABILITY_CAP',
      clauseCategory: 'Limitation of Liability',
      severity: 'HIGH',
      matchedExcerpt: 'No liability cap clause found in the contract text.',
      policyRule: `A mutual liability cap of at least ${playbook.minLiabilityCapMonths} months of fees is required. Absence is not treated as compliance.`,
      riskScorePoints: 32,
      rationale:
        'The contract does not state a liability cap. A missing cap is not a 12-month baseline.',
      suggestedRedline:
        'Except for confidentiality breaches or willful misconduct, each party’s aggregate liability shall not exceed 12 months of fees paid or payable under the applicable Order Form.',
      businessImpact: 'Requires Legal review before standard procurement approval.'
    });
  }

  // 3. Price uplift check
  const upliftPctMatch = text.match(
    /(?:price\s+increase|uplift|escalat(?:e|ion)|renewal\s+fees?)[^.]{0,90}?(\d{1,2}(?:\.\d+)?)\s*%/i
  );
  const unilateralUpliftMatch = text.match(
    /(sole\s+discretion[^.]{0,60}(?:fee|price)|prevailing\s+list\s+price)/i
  );

  if (upliftPctMatch) {
    const upliftPct = Number.parseFloat(upliftPctMatch[1]);
    if (upliftPct > playbook.maxAnnualUpliftPct) {
      const overageUsd =
        annualSpendUsd > 0 ? Math.round((annualSpendUsd * upliftPct) / 100) : 0;
      findings.push({
        ruleId: 'PRICE_UPLIFT_EXCESS',
        clauseCategory: 'Pricing & Uplift',
        severity: upliftPct >= 9 ? 'HIGH' : 'MEDIUM',
        matchedExcerpt: extractSnippet(
          text,
          /(?:price\s+increase|uplift|escalat(?:e|ion)|renewal\s+fees?)[^.]{0,110}/i,
          upliftPctMatch[0]
        ),
        policyRule: `Annual renewal price uplift must be capped at <= ${playbook.maxAnnualUpliftPct}%.`,
        riskScorePoints: upliftPct >= 9 ? 18 : 12,
        rationale: `Contract allows a ${upliftPct}% annual uplift, exceeding Finance’s ${playbook.maxAnnualUpliftPct}% ceiling.`,
        suggestedRedline: `Cap annual renewal fee increases at the lesser of CPI or ${playbook.maxAnnualUpliftPct}% per year, provided Supplier gives 60 days advance notice.`,
        businessImpact:
          overageUsd > 0
            ? `Adds up to $${overageUsd.toLocaleString('en-US')}/yr in unbudgeted renewal inflation.`
            : 'Creates unbudgeted year-over-year SaaS cost inflation.'
      });
    } else {
      passedChecks.push(
        `Annual price uplift (${upliftPct}%) is within <= ${playbook.maxAnnualUpliftPct}% budget cap.`
      );
    }
  } else if (unilateralUpliftMatch) {
    findings.push({
      ruleId: 'PRICE_UPLIFT_EXCESS',
      clauseCategory: 'Pricing & Uplift',
      severity: 'HIGH',
      matchedExcerpt: extractSnippet(
        text,
        /(sole\s+discretion[^.]{0,60}(?:fee|price)|prevailing\s+list\s+price)/i,
        unilateralUpliftMatch[0]
      ),
      policyRule: `Unilateral or list-price renewal increases are prohibited; cap at <= ${playbook.maxAnnualUpliftPct}%.`,
      riskScorePoints: 18,
      rationale: 'Supplier can raise renewal fees to prevailing list price at its sole discretion.',
      suggestedRedline: `Insert explicit renewal cap: "Renewal pricing shall not increase by more than ${playbook.maxAnnualUpliftPct}% over the prior term’s per-unit rates."`,
      businessImpact: 'Removes Finance predictability on multi-year renewals.'
    });
  } else {
    passedChecks.push('No excessive renewal price-uplift clause detected.');
  }

  // 4. DPA / GDPR / SOC2 compliance check
  if (playbook.requireDpaSoc2) {
    const hasDpa = /\b(dpa|data\s+processing\s+addendum|gdpr|standard\s+contractual\s+clauses)\b/i.test(
      text
    );
    const hasSoc2 = /\b(soc\s*2|iso\s*27001|soc2\s+type\s*ii)\b/i.test(text);
    const explicitWaiver = /\b(no\s+dpa|without\s+soc\s*2|as-is\s+security)\b/i.test(text);

    if (explicitWaiver || !hasDpa || !hasSoc2) {
      const missingParts: string[] = [];
      if (!hasDpa || explicitWaiver) missingParts.push('DPA / GDPR SCCs');
      if (!hasSoc2 || explicitWaiver) missingParts.push('SOC 2 Type II / ISO 27001');
      findings.push({
        ruleId: 'COMPLIANCE_GAP',
        clauseCategory: 'Security & Privacy',
        severity: explicitWaiver || (!hasDpa && !hasSoc2) ? 'HIGH' : 'MEDIUM',
        matchedExcerpt: explicitWaiver
          ? extractSnippet(
              text,
              /\b(no\s+dpa|without\s+soc\s*2|as-is\s+security)\b/i,
              'Security / DPA waiver language'
            )
          : `Missing explicit reference to ${missingParts.join(' and ')} in contract excerpt.`,
        policyRule: 'All SaaS vendors handling customer or employee data require executed DPA + SOC 2 Type II.',
        riskScorePoints: explicitWaiver || (!hasDpa && !hasSoc2) ? 18 : 11,
        rationale: `Contract text lacks required security/privacy assurances (${missingParts.join(', ')}).`,
        suggestedRedline:
          'Incorporate Customer’s standard Data Processing Addendum (including EU/UK SCCs) and require Supplier to maintain annual SOC 2 Type II certification with 48-hour breach notification.',
        businessImpact: 'Blocks Security & Privacy signoff in Jira Service Management.'
      });
    } else {
      passedChecks.push('DPA/GDPR and SOC 2 Type II / ISO 27001 controls present.');
    }
  }

  // 5. Payment term deviation check
  const netTermMatch = text.match(/\bnet[\s-]?(\d{1,3})\b/i);
  const dueOnReceipt = /\b(due\s+upon\s+receipt|due\s+on\s+receipt|prepaid\s+on\s+execution)\b/i.test(
    text
  );

  if (dueOnReceipt) {
    findings.push({
      ruleId: 'PAYMENT_TERM_DEVIATION',
      clauseCategory: 'Billing & Payment Terms',
      severity: 'MEDIUM',
      matchedExcerpt: extractSnippet(
        text,
        /\b(due\s+upon\s+receipt|due\s+on\s+receipt|prepaid\s+on\s+execution)\b/i,
        'Due upon receipt'
      ),
      policyRule: `Standard corporate payment terms are Net-${playbook.requiredPaymentTermsDays}.`,
      riskScorePoints: 12,
      rationale: 'Immediate payment upon execution conflicts with AP invoice processing cycles.',
      suggestedRedline: `Amend payment terms to Net-${playbook.requiredPaymentTermsDays} from receipt of an undisputed invoice.`,
      businessImpact: 'Causes AP late-fee friction and cash-flow compression.'
    });
  } else if (netTermMatch) {
    const netDays = Number.parseInt(netTermMatch[1], 10);
    if (netDays < playbook.requiredPaymentTermsDays) {
      findings.push({
        ruleId: 'PAYMENT_TERM_DEVIATION',
        clauseCategory: 'Billing & Payment Terms',
        severity: netDays <= 15 ? 'MEDIUM' : 'LOW',
        matchedExcerpt: extractSnippet(text, /\bnet[\s-]?(\d{1,3})\b/i, netTermMatch[0]),
        policyRule: `Standard corporate payment terms are Net-${playbook.requiredPaymentTermsDays}.`,
        riskScorePoints: netDays <= 15 ? 12 : 7,
        rationale: `Vendor specifies Net-${netDays}, which is shorter than Finance’s Net-${playbook.requiredPaymentTermsDays} standard.`,
        suggestedRedline: `Change "Net-${netDays}" to "Net-${playbook.requiredPaymentTermsDays} from receipt of undisputed invoice."`,
        businessImpact: 'Requires AP exception or early-payment approval.'
      });
    } else {
      passedChecks.push(`Payment terms (Net-${netDays}) meet Net-${playbook.requiredPaymentTermsDays} standard.`);
    }
  } else {
    passedChecks.push('No adverse payment-term deviation detected.');
  }

  const rawScore = findings.reduce((sum, f) => sum + f.riskScorePoints, 0);
  const materialityBoost = annualSpendUsd >= 150000 && rawScore > 0 ? 5 : 0;
  const riskScore = Math.min(100, rawScore + materialityBoost);
  const riskTier = classifyTier(riskScore);
  const approvalRecommendation = classifyRecommendation(riskScore, findings);

  const summary =
    findings.length === 0
      ? `${input.vendorName} passed all ${passedChecks.length} playbook checks with a ${riskScore}/100 risk score.`
      : `${input.vendorName} triggered ${findings.length} playbook finding(s) (${riskScore}/100 ${riskTier} risk) -> ${approvalRecommendation}.`;

  return {
    vendorName: input.vendorName,
    annualSpendUsd,
    riskScore,
    riskTier,
    approvalRecommendation,
    findings,
    passedChecks,
    summary
  };
}
