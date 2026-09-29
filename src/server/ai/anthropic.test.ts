import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { DesignRequest, KnowledgeItem, StyleProfile } from '../../shared/contracts.js';
import { createDesignPlan } from '../domain/planner.js';

import { createAnthropicDesignPlan } from './anthropic.js';

const createdAt = '2026-09-29T00:00:00.000Z';
const request: DesignRequest = {
  id: randomUUID(),
  prompt: '会計サービスのランディングページをデザインしてください',
  projectName: 'Ledger',
  audience: '個人事業主',
  objective: '無料登録',
  concepts: ['信頼感'],
  avoid: ['過度な3D'],
  outputMode: 'both',
  intent: 'create-design',
  status: 'draft',
  createdAt,
};
const knowledge: KnowledgeItem = {
  id: randomUUID(),
  title: 'Evidence before action',
  summary: 'CTAの前に判断根拠を置く。',
  kind: 'pattern',
  contexts: ['landing-page'],
  concepts: ['信頼感'],
  evidence: '初期設計仮説',
  provenance: { sourceType: 'system', sourceUri: null, license: null, trainingEligible: true, capturedAt: createdAt },
  createdAt,
};
const style: StyleProfile = {
  id: randomUUID(),
  name: 'Quiet Geometry',
  description: '抑制された幾何学表現。',
  medium: 'flat vector',
  traits: ['quiet', 'geometric', 'limited palette'],
  palette: ['#17211C', '#F5F4EF'],
  compositionRules: ['copy safe area'],
  forbiddenTraits: ['glossy 3d'],
  version: 1,
  createdAt,
};

describe('Anthropic planning adapter', () => {
  it('accepts a tool result but owns IDs, lineage, style, and generation metadata', async () => {
    const localPlan = createDesignPlan(request, [knowledge], style);
    const illustration = localPlan.illustration;
    if (!illustration) throw new Error('Fixture must include an illustration.');
    let sentBody = '';
    const fetchImplementation: typeof fetch = async (_input, init) => {
      sentBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          content: [
            {
              type: 'tool_use',
              name: 'submit_design_plan',
              input: {
                rationale: localPlan.rationale,
                designDirection: localPlan.designDirection,
                sections: localPlan.sections,
                tokens: localPlan.tokens,
                illustration: {
                  purpose: illustration.purpose,
                  subject: illustration.subject,
                  aspectRatio: illustration.aspectRatio,
                  focalPoint: illustration.focalPoint,
                  safeArea: illustration.safeArea,
                  required: illustration.required,
                  avoid: illustration.avoid,
                },
              },
            },
          ],
          usage: { input_tokens: 120, output_tokens: 340 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const result = await createAnthropicDesignPlan(
      request,
      [knowledge],
      style,
      {
        apiKey: 'test-only-key',
        model: 'configured-model',
        baseUrl: 'https://api.anthropic.test/',
        timeoutMs: 5_000,
        maxOutputTokens: 2_048,
      },
      fetchImplementation,
    );

    expect(result.plan.requestId).toBe(request.id);
    expect(result.plan.knowledgeIds).toEqual([knowledge.id]);
    expect(result.plan.illustration?.styleProfileId).toBe(style.id);
    expect(result.plan.generation).toEqual({ provider: 'anthropic', model: 'configured-model', fallbackUsed: false });
    expect(result).toMatchObject({ inputTokens: 120, outputTokens: 340 });
    expect(sentBody).not.toContain('test-only-key');
  });

  it('rejects a response without the required planning tool call', async () => {
    const fetchImplementation: typeof fetch = async () =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'not a plan' }] }), { status: 200 });

    await expect(
      createAnthropicDesignPlan(
        request,
        [knowledge],
        style,
        {
          apiKey: 'test-only-key',
          model: 'configured-model',
          baseUrl: 'https://api.anthropic.test',
          timeoutMs: 5_000,
          maxOutputTokens: 2_048,
        },
        fetchImplementation,
      ),
    ).rejects.toThrow('submit_design_plan');
  });
});
