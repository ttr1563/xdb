import { existsSync } from 'node:fs';
import path from 'node:path';

import staticPlugin from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import {
  aiProviderSchema,
  comparisonInputSchema,
  creationRunInputSchema,
  designRequestInputSchema,
  evaluationInputSchema,
  inputHookSchema,
  knowledgeInputSchema,
  planFamilyInputSchema,
  styleProfileInputSchema,
  type DashboardSummary,
} from '../shared/contracts.js';

import { isAnthropicBaseUrlAllowed } from './ai/anthropic.js';
import { ApplicationError, seedXdbRepository, XdbService } from './application/xdb-service.js';
import { ArtifactStore } from './artifacts/store.js';
import type { RuntimeConfig } from './config.js';
import type { Repository } from './db/repository.js';

export interface AppDependencies {
  repository: Repository;
  config: RuntimeConfig;
}

function currentMonthStart(): string {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

export function buildApp({ repository, config }: AppDependencies): FastifyInstance {
  seedXdbRepository(repository);
  const app = Fastify({ logger: false });
  const artifactStore = new ArtifactStore(config.artifactsPath);
  const service = new XdbService({ repository, config, artifactStore });
  const anthropicConfigured = Boolean(config.anthropic.apiKey && config.anthropic.model);

  function anthropicCapabilities() {
    const provider = config.design.ai.providers.anthropic;
    const tokensUsed = repository.sumAnthropicTokensSince(currentMonthStart());
    let blockReason: string | null = null;
    if (!provider.allowExternalRequests) blockReason = 'external_requests_disabled';
    else if (!anthropicConfigured) blockReason = 'credentials_or_model_missing';
    else if (!isAnthropicBaseUrlAllowed(config.anthropic.baseUrl, provider.allowedBaseUrls)) {
      blockReason = 'base_url_not_allowed';
    }
    else if (provider.monthlyTokenBudget === 0 || tokensUsed + provider.maxOutputTokens > provider.monthlyTokenBudget) {
      blockReason = 'monthly_token_budget_insufficient';
    }
    return {
      anthropicConnected: anthropicConfigured,
      anthropicLiveEnabled: provider.enabled && blockReason === null,
      anthropicBlockReason: blockReason,
      anthropicMonthlyTokensUsed: tokensUsed,
      anthropicMonthlyTokenBudget: provider.monthlyTokenBudget,
    };
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'validation_error', issues: error.issues });
    }
    if (error instanceof ApplicationError) {
      return reply.status(error.statusCode).send({ error: error.name, message: error.message, ...error.details });
    }
    if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number') {
      return reply.status(error.statusCode).send({ error: error.name, message: error.message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: 'internal_error', message: 'Unexpected server error.' });
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    figmaConnected: Boolean(config.figmaMcpServer),
    ...anthropicCapabilities(),
  }));
  app.get('/api/config', async () => ({
    design: config.design,
    capabilities: {
      figmaConnected: Boolean(config.figmaMcpServer),
      imageProviderConnected: Boolean(config.imageProvider),
      ...anthropicCapabilities(),
    },
  }));

  app.get('/api/dashboard', async (): Promise<DashboardSummary> => ({
    requests: repository.count('design_requests'),
    knowledgeItems: repository.count('knowledge_items'),
    plans: repository.count('design_plans'),
    creationRuns: repository.count('creation_runs'),
    evaluations: repository.count('evaluations'),
    approvedArtifacts: repository.countApprovedArtifacts(),
  }));

  app.post('/api/hooks/design-input', async (request) => {
    const input = inputHookSchema.parse(request.body);
    return service.classify(input.input);
  });

  app.get('/api/knowledge', async () => repository.listKnowledge());
  app.post('/api/knowledge', async (request, reply) => {
    const input = knowledgeInputSchema.parse(request.body);
    return reply.status(201).send(repository.createKnowledge(input));
  });

  app.get('/api/style-profiles', async () => repository.listStyleProfiles());
  app.post('/api/style-profiles', async (request, reply) => {
    const input = styleProfileInputSchema.parse(request.body);
    return reply.status(201).send(repository.createStyleProfile(input));
  });

  app.get('/api/requests', async () => repository.listRequests());
  app.post('/api/requests', async (request, reply) => {
    const input = designRequestInputSchema.parse(request.body);
    return reply.status(201).send(service.createRequest(input));
  });

  app.get('/api/plans', async () => repository.listPlans());
  app.post('/api/plans', async (request, reply) => {
    const body = request.body as { requestId?: unknown; provider?: unknown };
    if (typeof body?.requestId !== 'string') {
      return reply.status(400).send({ error: 'requestId_required' });
    }
    const provider = aiProviderSchema.parse(body.provider ?? config.design.ai.defaultProvider);
    return reply.status(201).send(await service.createPlan(body.requestId, provider));
  });

  app.get('/api/plan-families', async () => repository.listPlanFamilies());
  app.post('/api/plan-families', async (request, reply) => {
    const input = planFamilyInputSchema.parse(request.body);
    return reply.status(201).send(await service.createPlanFamily(input));
  });

  app.get('/api/ai-runs', async () => repository.listAiRuns());

  app.get('/api/runs', async () => repository.listRuns());
  app.post('/api/runs', async (request, reply) => {
    const input = creationRunInputSchema.parse(request.body);
    return reply.status(201).send(await service.createArtifacts(input));
  });

  app.get('/api/evaluations', async () => repository.listEvaluations());
  app.post('/api/evaluations', async (request, reply) => {
    const input = evaluationInputSchema.parse(request.body);
    return reply.status(201).send(service.recordEvaluation(input));
  });

  app.get('/api/comparisons', async () => repository.listComparisons());
  app.post('/api/comparisons', async (request, reply) => {
    const input = comparisonInputSchema.parse(request.body);
    return reply.status(201).send(service.compareArtifacts(input));
  });

  app.get('/api/export', async () => ({
    exportedAt: new Date().toISOString(),
    version: 2,
    knowledge: repository.listKnowledge(),
    styleProfiles: repository.listStyleProfiles(),
    requests: repository.listRequests(),
    plans: repository.listPlans(),
    aiRuns: repository.listAiRuns(),
    runs: repository.listRuns(),
    evaluations: repository.listEvaluations(),
    comparisons: repository.listComparisons(),
    comparisonContexts: service.listComparisonContexts(),
  }));

  app.get('/api/export/evaluations.jsonl', async (_request, reply) => {
    const lines = repository.listEvaluations().map((evaluation) => JSON.stringify(evaluation)).join('\n');
    return reply.type('application/x-ndjson').send(lines ? `${lines}\n` : '');
  });

  app.register(staticPlugin, {
    root: config.artifactsPath,
    prefix: '/artifacts/',
    decorateReply: false,
  });

  const clientRoot = path.resolve(process.cwd(), 'dist/client');
  if (existsSync(clientRoot)) {
    app.register(staticPlugin, { root: clientRoot, wildcard: false });
    app.get('/*', async (_request, reply) => reply.sendFile('index.html'));
  }

  return app;
}
