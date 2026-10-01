import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { DesignRequest, KnowledgeItem, StyleProfile } from '../../shared/contracts.js';

import { createDesignPlan } from './planner.js';

const createdAt = '2026-09-29T00:00:00.000Z';

function fixtureRequest(): DesignRequest {
  return {
    id: randomUUID(),
    prompt: '請求書サービスのLPをデザインする',
    projectName: 'Invoice Flow',
    audience: '個人事業主',
    objective: '無料登録への誘導',
    concepts: ['信頼感', '親しみ'],
    avoid: ['過度な3D'],
    outputMode: 'both',
    intent: 'create-design',
    status: 'draft',
    createdAt,
  };
}

const knowledge: KnowledgeItem = {
  id: randomUUID(),
  title: 'CTAを一つに絞る',
  summary: '主要な行動を競合させない。',
  kind: 'pattern',
  contexts: ['landing-page'],
  concepts: ['信頼感'],
  evidence: '初期設計仮説',
  provenance: { sourceType: 'system', sourceUri: null, license: null, trainingEligible: true, capturedAt: createdAt },
  createdAt,
};

const style: StyleProfile = {
  id: randomUUID(),
  name: 'Warm Editorial',
  description: '親しみと信頼を両立する画風。',
  medium: 'flat vector',
  traits: ['rounded', 'quiet', 'limited palette'],
  palette: ['#17211C', '#F5F4EF'],
  compositionRules: ['copy safe area'],
  forbiddenTraits: ['glossy 3d'],
  version: 1,
  createdAt,
};

describe('createDesignPlan', () => {
  it('preserves knowledge lineage and produces responsive design foundations', () => {
    const plan = createDesignPlan(fixtureRequest(), [knowledge], style);
    expect(plan.knowledgeIds).toEqual([knowledge.id]);
    expect(plan.sections.map((section) => section.type)).toEqual(
      expect.arrayContaining(['hero', 'features', 'cta', 'footer']),
    );
    expect(plan.tokens.length).toBeGreaterThanOrEqual(10);
    expect(plan.illustration).toMatchObject({ styleProfileId: style.id, purpose: 'hero' });
    expect(plan.illustration?.avoid).toEqual(expect.arrayContaining(['過度な3D', 'glossy 3d']));
  });

  it('produces traceable and structurally distinct strategy candidates', () => {
    const request = fixtureRequest();
    const familyId = randomUUID();
    const strategies = ['conservative', 'expressive', 'conversion-led'] as const;
    const plans = strategies.map((strategy, candidateIndex) =>
      createDesignPlan(request, [knowledge], style, { familyId, strategy, candidateIndex }),
    );

    expect(plans.map((plan) => plan.variantStrategy)).toEqual(strategies);
    expect(plans.every((plan) => plan.familyId === familyId)).toBe(true);
    expect(new Set(plans.map((plan) => plan.fingerprint))).toHaveProperty('size', 3);
    expect(new Set(plans.map((plan) => plan.designDirection.contrast))).toHaveProperty('size', 2);
  });
});
