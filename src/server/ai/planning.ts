import type {
  AiProvider,
  AiRun,
  DesignPlan,
  DesignRequest,
  KnowledgeItem,
  StyleProfile,
  VariantStrategy,
} from '../../shared/contracts.js';
import type { RuntimeConfig } from '../config.js';
import type { Repository } from '../db/repository.js';
import { createDesignPlan } from '../domain/planner.js';

import { AnthropicProviderError, createAnthropicDesignPlan } from './anthropic.js';

interface PlanningInput {
  provider: AiProvider;
  request: DesignRequest;
  knowledge: KnowledgeItem[];
  styleProfile: StyleProfile;
  config: RuntimeConfig;
  repository: Repository;
  variant?: {
    familyId: string;
    strategy: VariantStrategy;
    candidateIndex: number;
  };
}

export class PlanningProviderError extends Error {
  public readonly statusCode = 503;

  public constructor(message: string) {
    super(message);
    this.name = 'planning_provider_error';
  }
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : 'Unknown AI provider error.').slice(0, 1_000);
}

function monthStart(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

function categorizedError(error: unknown): {
  code: NonNullable<AiRun['errorCode']>;
  attempts: number;
  inputTokens: number | null;
  outputTokens: number | null;
} {
  if (error instanceof AnthropicProviderError) {
    return {
      code: error.code,
      attempts: error.attemptCount,
      inputTokens: error.inputTokens,
      outputTokens: error.outputTokens,
    };
  }
  return { code: 'configuration', attempts: 0, inputTokens: null, outputTokens: null };
}

function configurationError(code: NonNullable<AiRun['errorCode']>, message: string): AnthropicProviderError {
  return new AnthropicProviderError(code, message, false, 0);
}

function localPlan(input: PlanningInput, fallbackUsed: boolean): DesignPlan {
  const plan = createDesignPlan(input.request, input.knowledge, input.styleProfile, input.variant);
  return { ...plan, generation: { ...plan.generation, fallbackUsed } };
}

export async function generateDesignPlan(input: PlanningInput): Promise<DesignPlan> {
  const startedAt = Date.now();
  if (input.provider === 'local') {
    const plan = localPlan(input, false);
    input.repository.createAiRun({
      requestId: input.request.id,
      purpose: 'planning',
      provider: 'local',
      model: plan.generation.model,
      status: 'completed',
      fallbackUsed: false,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - startedAt,
      attemptCount: 0,
      errorCode: null,
      error: null,
    });
    return plan;
  }

  const providerConfig = input.config.design.ai.providers.anthropic;
  const credentials = input.config.anthropic;
  try {
    if (!providerConfig.enabled) throw configurationError('configuration', 'Anthropic provider is disabled.');
    if (!providerConfig.allowExternalRequests) {
      throw configurationError(
        'external_requests_disabled',
        'Anthropic external requests are disabled in design.config.json.',
      );
    }
    if (!credentials.apiKey || !credentials.model) {
      throw configurationError(
        'configuration',
        'Anthropic provider requires XDB_ANTHROPIC_API_KEY and XDB_ANTHROPIC_MODEL.',
      );
    }
    const usedTokens = input.repository.sumAnthropicTokensSince(monthStart());
    if (
      providerConfig.monthlyTokenBudget === 0
      || usedTokens + providerConfig.maxOutputTokens > providerConfig.monthlyTokenBudget
    ) {
      throw configurationError(
        'budget_exceeded',
        'Anthropic monthly token budget does not have enough capacity for this request.',
      );
    }
    const result = await createAnthropicDesignPlan(input.request, input.knowledge, input.styleProfile, {
      apiKey: credentials.apiKey,
      model: credentials.model,
      baseUrl: credentials.baseUrl,
      timeoutMs: providerConfig.timeoutMs,
      maxOutputTokens: providerConfig.maxOutputTokens,
      allowedBaseUrls: providerConfig.allowedBaseUrls,
      maxRetries: providerConfig.maxRetries,
      retryBaseDelayMs: providerConfig.retryBaseDelayMs,
    });
    input.repository.createAiRun({
      requestId: input.request.id,
      purpose: 'planning',
      provider: 'anthropic',
      model: credentials.model,
      status: 'completed',
      fallbackUsed: false,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: Date.now() - startedAt,
      attemptCount: result.attemptCount,
      errorCode: null,
      error: null,
    });
    return result.plan;
  } catch (error) {
    const message = errorMessage(error);
    const category = categorizedError(error);
    const fallbackUsed = providerConfig.fallbackToLocal && input.config.design.ai.providers.local.enabled;
    input.repository.createAiRun({
      requestId: input.request.id,
      purpose: 'planning',
      provider: 'anthropic',
      model: credentials.model,
      status: fallbackUsed ? 'fallback' : 'failed',
      fallbackUsed,
      inputTokens: category.inputTokens,
      outputTokens: category.outputTokens,
      latencyMs: Date.now() - startedAt,
      attemptCount: category.attempts,
      errorCode: category.code,
      error: message,
    });
    if (!fallbackUsed) throw new PlanningProviderError(message);
    return localPlan(input, true);
  }
}
