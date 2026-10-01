import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  type AiRun,
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

const anthropicResponseSchema = z.object({
  content: z.array(z.object({
    type: z.string().optional(),
    name: z.string().optional(),
    input: z.unknown().optional(),
  }).passthrough()).optional(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
}).passthrough();
type AnthropicResponse = z.infer<typeof anthropicResponseSchema>;

export interface AnthropicPlanningConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxOutputTokens: number;
  allowedBaseUrls: string[];
  maxRetries: number;
  retryBaseDelayMs: number;
}

export interface AnthropicPlanningResult {
  plan: DesignPlan;
  inputTokens: number | null;
  outputTokens: number | null;
  attemptCount: number;
}

type AnthropicErrorCode = NonNullable<AiRun['errorCode']>;

export class AnthropicProviderError extends Error {
  public constructor(
    public readonly code: AnthropicErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly attemptCount: number,
    public readonly inputTokens: number | null = null,
    public readonly outputTokens: number | null = null,
  ) {
    super(message);
    this.name = 'anthropic_provider_error';
  }
}

function normalizedBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AnthropicProviderError('base_url_not_allowed', 'Anthropic base URL is invalid.', false, 0);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new AnthropicProviderError(
      'base_url_not_allowed',
      'Anthropic base URL must be an HTTPS URL without credentials, query, or fragment.',
      false,
      0,
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function allowedEndpoint(baseUrl: string, allowedBaseUrls: string[]): string {
  const normalized = normalizedBaseUrl(baseUrl);
  const allowed = allowedBaseUrls.map(normalizedBaseUrl);
  if (!allowed.includes(normalized)) {
    throw new AnthropicProviderError(
      'base_url_not_allowed',
      'Anthropic base URL is not in design.config.json allowedBaseUrls.',
      false,
      0,
    );
  }
  return `${normalized}/v1/messages`;
}

export function isAnthropicBaseUrlAllowed(baseUrl: string, allowedBaseUrls: string[]): boolean {
  try {
    allowedEndpoint(baseUrl, allowedBaseUrls);
    return true;
  } catch {
    return false;
  }
}

function providerError(error: unknown, attemptCount: number): AnthropicProviderError {
  if (error instanceof AnthropicProviderError) return error;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new AnthropicProviderError('timeout', 'Anthropic request timed out.', false, attemptCount);
  }
  return new AnthropicProviderError('network', 'Anthropic request failed before a response was received.', false, attemptCount);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function createAnthropicDesignPlan(
  request: DesignRequest,
  knowledge: KnowledgeItem[],
  styleProfile: StyleProfile,
  config: AnthropicPlanningConfig,
  fetchImplementation: typeof fetch = fetch,
  sleepImplementation: (milliseconds: number) => Promise<void> = delay,
): Promise<AnthropicPlanningResult> {
  const endpoint = allowedEndpoint(config.baseUrl, config.allowedBaseUrls);
  let attemptCount = 0;
  let payload: AnthropicResponse | null = null;
  while (attemptCount <= config.maxRetries) {
    attemptCount += 1;
    try {
      const response = await fetchImplementation(endpoint, {
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
        const retryable = response.status === 429 || response.status >= 500;
        const code = response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'upstream' : 'invalid_response';
        throw new AnthropicProviderError(code, `Anthropic Messages API returned HTTP ${response.status}.`, retryable, attemptCount);
      }
      let rawPayload: unknown;
      try {
        rawPayload = await response.json();
      } catch {
        throw new AnthropicProviderError('invalid_response', 'Anthropic response was not valid JSON.', false, attemptCount);
      }
      const parsedPayload = anthropicResponseSchema.safeParse(rawPayload);
      if (!parsedPayload.success) {
        throw new AnthropicProviderError(
          'invalid_response',
          'Anthropic response body failed validation.',
          false,
          attemptCount,
        );
      }
      payload = parsedPayload.data;
      break;
    } catch (error) {
      const categorized = providerError(error, attemptCount);
      if (!categorized.retryable || attemptCount > config.maxRetries) throw categorized;
      await sleepImplementation(config.retryBaseDelayMs * 2 ** (attemptCount - 1));
    }
  }

  if (!payload) {
    throw new AnthropicProviderError('network', 'Anthropic request ended without a response.', false, attemptCount);
  }
  const toolUse = payload.content?.find((block) => block.type === 'tool_use' && block.name === planTool.name);
  if (!toolUse) {
    throw new AnthropicProviderError(
      'invalid_response',
      'Anthropic response did not contain submit_design_plan tool use.',
      false,
      attemptCount,
      payload.usage?.input_tokens ?? null,
      payload.usage?.output_tokens ?? null,
    );
  }

  const parsedDraft = planDraftSchema.safeParse(toolUse.input);
  if (!parsedDraft.success) {
    throw new AnthropicProviderError(
      'invalid_response',
      'Anthropic planning tool result failed validation.',
      false,
      attemptCount,
      payload.usage?.input_tokens ?? null,
      payload.usage?.output_tokens ?? null,
    );
  }
  const draft = parsedDraft.data;
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
    attemptCount,
  };
}
