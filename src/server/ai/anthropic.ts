import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  designPlanSchema,
  illustrationSpecSchema,
  type DesignPlan,
  type DesignRequest,
  type KnowledgeItem,
  type StyleProfile,
} from '../../shared/contracts.js';

const planDraftSchema = z.object({
  rationale: designPlanSchema.shape.rationale,
  designDirection: designPlanSchema.shape.designDirection,
  sections: designPlanSchema.shape.sections,
  tokens: designPlanSchema.shape.tokens,
  illustration: illustrationSpecSchema.omit({ styleProfileId: true }).nullable(),
});

const planTool = {
  name: 'submit_design_plan',
  description: 'Submit one implementation-ready web Design Plan grounded in the supplied request and knowledge.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['rationale', 'designDirection', 'sections', 'tokens', 'illustration'],
    properties: {
      rationale: { type: 'string', minLength: 20 },
      designDirection: {
        type: 'object',
        additionalProperties: false,
        required: ['primaryConcept', 'secondaryConcepts', 'density', 'contrast', 'shape', 'motion'],
        properties: {
          primaryConcept: { type: 'string' },
          secondaryConcepts: { type: 'array', items: { type: 'string' } },
          density: { enum: ['low', 'medium', 'high'] },
          contrast: { enum: ['soft', 'moderate', 'strong'] },
          shape: { enum: ['precise', 'balanced', 'soft'] },
          motion: { enum: ['none', 'subtle', 'expressive'] },
        },
      },
      sections: {
        type: 'array',
        minItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'purpose', 'component', 'variant', 'headline', 'body'],
          properties: {
            id: { type: 'string' },
            type: { enum: ['navigation', 'hero', 'trust', 'features', 'workflow', 'pricing', 'faq', 'cta', 'footer'] },
            purpose: { type: 'string' },
            component: { type: 'string' },
            variant: { type: 'string' },
            headline: { type: 'string' },
            body: { type: 'string' },
          },
        },
      },
      tokens: {
        type: 'array',
        minItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'type', 'value', 'description'],
          properties: {
            name: { type: 'string' },
            type: { enum: ['color', 'dimension', 'fontFamily', 'fontWeight', 'duration'] },
            value: {
              anyOf: [
                { type: 'string' },
                { type: 'number' },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['value', 'unit'],
                  properties: { value: { type: 'number' }, unit: { enum: ['px', 'rem'] } },
                },
              ],
            },
            description: { type: 'string' },
          },
        },
      },
      illustration: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['purpose', 'subject', 'aspectRatio', 'focalPoint', 'safeArea', 'required', 'avoid'],
            properties: {
              purpose: { enum: ['hero', 'feature', 'empty-state', 'background', 'icon'] },
              subject: { type: 'string' },
              aspectRatio: { enum: ['16:9', '4:3', '3:2', '1:1'] },
              focalPoint: { enum: ['left', 'center', 'right'] },
              safeArea: { enum: ['left', 'right', 'top', 'none'] },
              required: { type: 'array', minItems: 1, items: { type: 'string' } },
              avoid: { type: 'array', items: { type: 'string' } },
            },
          },
        ],
      },
    },
  },
} as const;

interface AnthropicResponse {
  content?: Array<{ type?: string; name?: string; input?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface AnthropicPlanningConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface AnthropicPlanningResult {
  plan: DesignPlan;
  inputTokens: number | null;
  outputTokens: number | null;
}

export async function createAnthropicDesignPlan(
  request: DesignRequest,
  knowledge: KnowledgeItem[],
  styleProfile: StyleProfile,
  config: AnthropicPlanningConfig,
  fetchImplementation: typeof fetch = fetch,
): Promise<AnthropicPlanningResult> {
  const response = await fetchImplementation(`${config.baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxOutputTokens,
      system: 'You are XDB planning an evidence-backed web design. Use only the supplied context. Call submit_design_plan exactly once. Do not invent research evidence, IDs, permissions, or implementation status.',
      messages: [
        {
          role: 'user',
          content: `<design_request>${JSON.stringify(request)}</design_request>\n<knowledge>${JSON.stringify(knowledge)}</knowledge>\n<style_profile>${JSON.stringify(styleProfile)}</style_profile>\nCreate a coherent, responsive, accessible plan. Preserve the requested concepts and avoid list.`,
        },
      ],
      tools: [planTool],
      tool_choice: { type: 'tool', name: planTool.name },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Anthropic Messages API returned HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as AnthropicResponse;
  const toolUse = payload.content?.find(
    (block) => block.type === 'tool_use' && block.name === planTool.name,
  );
  if (!toolUse) throw new Error('Anthropic response did not contain submit_design_plan tool use.');

  const draft = planDraftSchema.parse(toolUse.input);
  const plan = designPlanSchema.parse({
    ...draft,
    id: randomUUID(),
    requestId: request.id,
    version: 1,
    illustration: draft.illustration
      ? { ...draft.illustration, styleProfileId: styleProfile.id }
      : null,
    knowledgeIds: knowledge.map((item) => item.id),
    generation: { provider: 'anthropic', model: config.model, fallbackUsed: false },
    createdAt: new Date().toISOString(),
  });

  return {
    plan,
    inputTokens: payload.usage?.input_tokens ?? null,
    outputTokens: payload.usage?.output_tokens ?? null,
  };
}
