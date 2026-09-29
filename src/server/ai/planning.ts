import type {
  AiProvider,
  DesignPlan,
  DesignRequest,
  KnowledgeItem,
  StyleProfile,
} from '../../shared/contracts.js';
import type { RuntimeConfig } from '../config.js';
import type { Repository } from '../db/repository.js';
import { createDesignPlan } from '../domain/planner.js';

import { createAnthropicDesignPlan } from './anthropic.js';

interface PlanningInput {
  provider: AiProvider;
  request: DesignRequest;
  knowledge: KnowledgeItem[];
  styleProfile: StyleProfile;
  config: RuntimeConfig;
  repository: Repository;
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

function localPlan(input: PlanningInput, fallbackUsed: boolean): DesignPlan {
  const plan = createDesignPlan(input.request, input.knowledge, input.styleProfile);
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
      error: null,
    });
    return plan;
  }

  const providerConfig = input.config.design.ai.providers.anthropic;
  const credentials = input.config.anthropic;
  try {
    if (!providerConfig.enabled) throw new Error('Anthropic provider is disabled.');
    if (!credentials.apiKey || !credentials.model) {
      throw new Error('Anthropic provider requires XDB_ANTHROPIC_API_KEY and XDB_ANTHROPIC_MODEL.');
    }
    const result = await createAnthropicDesignPlan(input.request, input.knowledge, input.styleProfile, {
      apiKey: credentials.apiKey,
      model: credentials.model,
      baseUrl: credentials.baseUrl,
      timeoutMs: providerConfig.timeoutMs,
      maxOutputTokens: providerConfig.maxOutputTokens,
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
      error: null,
    });
    return result.plan;
  } catch (error) {
    const message = errorMessage(error);
    const fallbackUsed = providerConfig.fallbackToLocal && input.config.design.ai.providers.local.enabled;
    input.repository.createAiRun({
      requestId: input.request.id,
      purpose: 'planning',
      provider: 'anthropic',
      model: credentials.model,
      status: fallbackUsed ? 'fallback' : 'failed',
      fallbackUsed,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - startedAt,
      error: message,
    });
    if (!fallbackUsed) throw new PlanningProviderError(message);
    return localPlan(input, true);
  }
}
