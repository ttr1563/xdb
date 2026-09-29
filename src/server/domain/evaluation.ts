import type { DesignPlan, ScoreSet } from '../../shared/contracts.js';

export interface AutomaticReview {
  scores: ScoreSet;
  checks: Array<{ name: string; passed: boolean; evidence: string }>;
  limitations: string[];
}

function clampScore(value: number): number {
  return Math.max(1, Math.min(5, Math.round(value * 10) / 10));
}

export function evaluatePlanStructure(plan: DesignPlan): AutomaticReview {
  const hasHero = plan.sections.some((section) => section.type === 'hero');
  const hasCta = plan.sections.some((section) => section.type === 'cta');
  const uniqueComponents = new Set(plan.sections.map((section) => section.component)).size;
  const semanticTokens = plan.tokens.filter((token) => token.name.split('.').length >= 3).length;
  const knowledgeEvidence = plan.knowledgeIds.length;
  const sectionCoverage = Math.min(1, plan.sections.length / 7);

  return {
    scores: {
      hierarchy: clampScore(2.5 + Number(hasHero) + Number(hasCta) + sectionCoverage * 0.5),
      clarity: clampScore(3 + Number(plan.sections.every((section) => section.purpose.length >= 8))),
      composition: clampScore(2.8 + Math.min(1.2, uniqueComponents / 6)),
      typography: 3.5,
      color: clampScore(3 + Math.min(1, semanticTokens / 8)),
      spacing: 3.8,
      conceptFit: clampScore(3 + Math.min(1.5, knowledgeEvidence * 0.3)),
      distinctiveness: 3,
      accessibility: 3.8,
      implementability: clampScore(3 + sectionCoverage + Number(plan.tokens.length >= 10) * 0.5),
    },
    checks: [
      { name: 'hero-present', passed: hasHero, evidence: hasHero ? 'Hero section is defined.' : 'Hero section is missing.' },
      { name: 'cta-present', passed: hasCta, evidence: hasCta ? 'CTA section is defined.' : 'CTA section is missing.' },
      {
        name: 'semantic-tokens',
        passed: semanticTokens >= 8,
        evidence: `${semanticTokens} semantic tokens use a three-level name.`,
      },
      {
        name: 'knowledge-provenance',
        passed: knowledgeEvidence > 0,
        evidence: `${knowledgeEvidence} knowledge items support the plan.`,
      },
      {
        name: 'illustration-constraints',
        passed: Boolean(plan.illustration && plan.illustration.required.length > 0),
        evidence: plan.illustration ? 'Illustration requirements and exclusions are recorded.' : 'No illustration spec.',
      },
    ],
    limitations: [
      'This score validates plan structure and traceability; it is not a human aesthetic judgment.',
      'Rendered screenshots must be reviewed for clipping, contrast, visual hierarchy, and brand fit.',
    ],
  };
}
