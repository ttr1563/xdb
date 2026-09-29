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
  styleProfileInputSchema,
  type DashboardSummary,
} from '../shared/contracts.js';

import { generateDesignPlan } from './ai/planning.js';
import { ArtifactStore } from './artifacts/store.js';
import type { RuntimeConfig } from './config.js';
import type { Repository } from './db/repository.js';
import { executeCreation } from './domain/creation.js';
import { classifyDesignInput } from './domain/intent.js';
import { rankKnowledge } from './domain/knowledge-ranking.js';
import { knowledgeSeeds, styleProfileSeeds } from './domain/seeds.js';

export interface AppDependencies {
  repository: Repository;
  config: RuntimeConfig;
}

function seedRepository(repository: Repository): void {
  if (repository.listKnowledge().length === 0) {
    for (const seed of knowledgeSeeds) repository.createKnowledge(seed);
  }
  if (repository.listStyleProfiles().length === 0) {
    for (const seed of styleProfileSeeds) repository.createStyleProfile(seed);
  }
}

export function buildApp({ repository, config }: AppDependencies): FastifyInstance {
  seedRepository(repository);
  const app = Fastify({ logger: false });
  const artifactStore = new ArtifactStore(config.artifactsPath);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'validation_error', issues: error.issues });
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
    anthropicConnected: Boolean(config.anthropic.apiKey && config.anthropic.model),
  }));
  app.get('/api/config', async () => ({
    design: config.design,
    capabilities: {
      figmaConnected: Boolean(config.figmaMcpServer),
      imageProviderConnected: Boolean(config.imageProvider),
      anthropicConnected: Boolean(config.anthropic.apiKey && config.anthropic.model),
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
    return classifyDesignInput(input.input);
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
    const intent = classifyDesignInput(input.prompt);
    if (intent.intent === 'non-design') {
      return reply.status(422).send({ error: 'not_design_request', intent });
    }
    return reply.status(201).send(repository.createRequest(input));
  });

  app.get('/api/plans', async () => repository.listPlans());
  app.post('/api/plans', async (request, reply) => {
    const body = request.body as { requestId?: unknown; provider?: unknown };
    if (typeof body?.requestId !== 'string') {
      return reply.status(400).send({ error: 'requestId_required' });
    }
    const designRequest = repository.getRequest(body.requestId);
    if (!designRequest) return reply.status(404).send({ error: 'request_not_found' });
    const styleProfile = repository.listStyleProfiles()[0];
    if (!styleProfile) return reply.status(409).send({ error: 'style_profile_required' });
    const relevantKnowledge = rankKnowledge(designRequest, repository.listKnowledge());
    const provider = aiProviderSchema.parse(body.provider ?? config.design.ai.defaultProvider);
    if (provider === 'local' && !config.design.ai.providers.local.enabled) {
      return reply.status(409).send({ error: 'local_ai_provider_disabled' });
    }
    if (provider === 'anthropic' && !config.design.ai.providers.anthropic.enabled) {
      return reply.status(409).send({ error: 'anthropic_ai_provider_disabled' });
    }
    const plan = await generateDesignPlan({
      provider,
      request: designRequest,
      knowledge: relevantKnowledge,
      styleProfile,
      config,
      repository,
    });
    return reply.status(201).send(repository.savePlan(plan));
  });

  app.get('/api/ai-runs', async () => repository.listAiRuns());

  app.get('/api/runs', async () => repository.listRuns());
  app.post('/api/runs', async (request, reply) => {
    const input = creationRunInputSchema.parse(request.body);
    if (!config.design.output.availableModes.includes(input.outputMode)) {
      return reply.status(409).send({ error: 'output_mode_disabled' });
    }
    if ((input.outputMode === 'html' || input.outputMode === 'both') && !config.design.html.enabled) {
      return reply.status(409).send({ error: 'html_adapter_disabled' });
    }
    if ((input.outputMode === 'figma' || input.outputMode === 'both') && !config.design.figma.enabled) {
      return reply.status(409).send({ error: 'figma_adapter_disabled' });
    }
    const plan = repository.getPlan(input.planId);
    if (!plan) return reply.status(404).send({ error: 'plan_not_found' });
    const run = await executeCreation(input, plan, {
      repository,
      artifactStore,
      figmaConnected: Boolean(config.figmaMcpServer),
    });
    return reply.status(201).send(run);
  });

  app.get('/api/evaluations', async () => repository.listEvaluations());
  app.post('/api/evaluations', async (request, reply) => {
    const input = evaluationInputSchema.parse(request.body);
    return reply.status(201).send(repository.createEvaluation(input));
  });

  app.get('/api/comparisons', async () => repository.listComparisons());
  app.post('/api/comparisons', async (request, reply) => {
    const input = comparisonInputSchema.parse(request.body);
    return reply.status(201).send(repository.createComparison(input));
  });

  app.get('/api/export', async () => ({
    exportedAt: new Date().toISOString(),
    version: 1,
    knowledge: repository.listKnowledge(),
    styleProfiles: repository.listStyleProfiles(),
    requests: repository.listRequests(),
    plans: repository.listPlans(),
    aiRuns: repository.listAiRuns(),
    runs: repository.listRuns(),
    evaluations: repository.listEvaluations(),
    comparisons: repository.listComparisons(),
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
