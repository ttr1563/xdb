import { createHash } from 'node:crypto';

import { McpServer, ResourceTemplate, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';

import {
  aiProviderSchema,
  comparisonInputSchema,
  contextTaxonomyInputSchema,
  creationRunInputSchema,
  designRequestInputSchema,
  evaluationInputSchema,
  figmaDeliveryInputSchema,
  inputHookSchema,
  knowledgeImportInputSchema,
  knowledgeLifecycleInputSchema,
  planFamilyInputSchema,
  type Artifact,
} from '../../shared/contracts.js';
import { ApplicationError, type XdbService } from '../application/xdb-service.js';
import type { Repository } from '../db/repository.js';

const idempotencyKeySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const leaseRenewalIntervalMs = 60_000;
const requestIdSchema = z.object({ requestId: z.string().uuid() });
const runIdSchema = z.object({ runId: z.string().uuid() });
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const planningAnnotations = { ...writeAnnotations, openWorldHint: true } as const;
const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

interface McpDependencies {
  service: XdbService;
  repository: Repository;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function textResult(result: Record<string, unknown>, content: CallToolResult['content'] = []): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }, ...content],
    structuredContent: result,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown MCP operation error.';
}

function artifactMimeType(kind: Artifact['kind']): string {
  if (kind === 'html') return 'text/html';
  if (kind === 'figma-script') return 'text/javascript';
  return 'application/json';
}

async function executeIdempotent(
  repository: Repository,
  tool: string,
  idempotencyKey: string,
  payload: unknown,
  execute: () => Promise<Record<string, unknown>> | Record<string, unknown>,
): Promise<{ result: Record<string, unknown>; replayed: boolean }> {
  const requestHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const claim = repository.claimMcpOperation(idempotencyKey, tool, requestHash);
  if (claim.state === 'conflict') {
    throw new ApplicationError(
      'idempotency_key_conflict',
      409,
      'The idempotency key was already used with a different tool or payload.',
    );
  }
  if (claim.state === 'in_progress') {
    throw new ApplicationError('operation_in_progress', 409, 'The idempotent operation is already in progress.');
  }
  if (claim.state === 'indeterminate') {
    throw new ApplicationError(
      'operation_outcome_unknown',
      409,
      'The prior operation did not finish recording its outcome. Reconcile saved state before using a new key.',
    );
  }
  if (claim.state === 'failed') {
    throw new ApplicationError(
      'operation_previously_failed',
      409,
      'The prior operation failed and will not be retried with the same key. Reconcile saved state before using a new key.',
    );
  }
  if (claim.state === 'replay') return { result: claim.result, replayed: true };
  let leaseOwned = true;
  const renewal = setInterval(() => {
    try {
      leaseOwned = repository.renewMcpOperation(idempotencyKey, claim.ownerToken);
    } catch {
      leaseOwned = false;
    }
  }, leaseRenewalIntervalMs);
  renewal.unref();
  try {
    const result = await execute();
    if (!leaseOwned) throw new Error('MCP operation lease renewal failed.');
    repository.completeMcpOperation(idempotencyKey, claim.ownerToken, result);
    return { result, replayed: false };
  } catch (error) {
    if (leaseOwned) repository.failMcpOperation(idempotencyKey, claim.ownerToken, errorMessage(error));
    throw error;
  } finally {
    clearInterval(renewal);
  }
}

function withReplay(result: Record<string, unknown>, replayed: boolean): Record<string, unknown> {
  return { ...result, replayed };
}

export function createXdbMcpServer({ service, repository }: McpDependencies): McpServer {
  const server = new McpServer(
    { name: 'xdb-design-intelligence', version: '0.1.0' },
    {
      instructions: 'Classify first, then create a request, inspect the plan, create local artifacts, and record human evaluation. Figma write is never implicit. Reuse one stable idempotency key per intended write.',
    },
  );

  server.registerTool(
    'xdb_classify_design_input',
    {
      title: 'Classify design input',
      description: 'Classify raw input before starting an XDB design workflow.',
      inputSchema: inputHookSchema,
      annotations: readAnnotations,
    },
    ({ input }) => textResult(jsonRecord(service.classify(input))),
  );

  server.registerTool(
    'xdb_search_knowledge',
    {
      title: 'Search contextual design knowledge',
      description: 'Return ranked XDB knowledge for an existing Design Request.',
      inputSchema: requestIdSchema,
      annotations: readAnnotations,
    },
    ({ requestId }) => textResult(jsonRecord({ requestId, items: service.searchKnowledge(requestId) })),
  );

  server.registerTool(
    'xdb_get_dataset_snapshot',
    {
      title: 'Get the training-eligible dataset snapshot',
      description: 'Return only active, rights-verified, non-duplicate knowledge and its taxonomy.',
      inputSchema: z.object({}),
      annotations: readAnnotations,
    },
    () => textResult(jsonRecord(service.datasetSnapshot())),
  );

  server.registerTool(
    'xdb_import_knowledge',
    {
      title: 'Import contextual design knowledge',
      description: 'Validate and import JSON or parsed JSONL metadata with duplicate reporting.',
      inputSchema: knowledgeImportInputSchema.extend({ idempotencyKey: idempotencyKeySchema }),
      annotations: writeAnnotations,
    },
    async ({ idempotencyKey, ...input }) => {
      const operation = await executeIdempotent(repository, 'xdb_import_knowledge', idempotencyKey, input, () =>
        jsonRecord({ batch: service.importKnowledge(input) }),
      );
      return textResult(withReplay(operation.result, operation.replayed));
    },
  );

  server.registerTool(
    'xdb_update_knowledge_lifecycle',
    {
      title: 'Exclude, restore, or tombstone knowledge',
      description: 'Change knowledge retrieval lifecycle while preserving lineage.',
      inputSchema: knowledgeLifecycleInputSchema.extend({
        knowledgeId: z.string().uuid(),
        idempotencyKey: idempotencyKeySchema,
      }),
      annotations: writeAnnotations,
    },
    async ({ knowledgeId, idempotencyKey, ...input }) => {
      const payload = { knowledgeId, ...input };
      const operation = await executeIdempotent(repository, 'xdb_update_knowledge_lifecycle', idempotencyKey, payload, async () =>
        jsonRecord({ knowledge: await service.updateKnowledgeLifecycle(knowledgeId, input) }),
      );
      return textResult(withReplay(operation.result, operation.replayed));
    },
  );

  server.registerTool(
    'xdb_create_context_taxonomy',
    {
      title: 'Create a canonical context and aliases',
      description: 'Add one context taxonomy term without merging incompatible contexts.',
      inputSchema: contextTaxonomyInputSchema.extend({ idempotencyKey: idempotencyKeySchema }),
      annotations: writeAnnotations,
    },
    async ({ idempotencyKey, ...input }) => {
      const operation = await executeIdempotent(repository, 'xdb_create_context_taxonomy', idempotencyKey, input, () =>
        jsonRecord({ taxonomy: service.createContextTaxonomy(input) }),
      );
      return textResult(withReplay(operation.result, operation.replayed));
    },
  );

  server.registerTool(
    'xdb_create_request',
    {
      title: 'Create a Design Request',
      description: 'Validate and persist a design request. Requires an idempotency key.',
      inputSchema: designRequestInputSchema.extend({ idempotencyKey: idempotencyKeySchema }),
      annotations: writeAnnotations,
    },
    async ({ idempotencyKey, ...input }) => {
      const operation = await executeIdempotent(repository, 'xdb_create_request', idempotencyKey, input, () =>
        jsonRecord({ request: service.createRequest(input) }),
      );
      return textResult(withReplay(operation.result, operation.replayed));
    },
  );

  server.registerTool(
    'xdb_create_plan',
    {
      title: 'Create a Design Plan',
      description: 'Create and persist a Design Plan from ranked knowledge using local or configured Claude planning.',
      inputSchema: z.object({
        requestId: z.string().uuid(),
        provider: aiProviderSchema,
        idempotencyKey: idempotencyKeySchema,
      }),
      annotations: planningAnnotations,
    },
    async ({ requestId, provider, idempotencyKey }) => {
      const payload = { requestId, provider };
      const operation = await executeIdempotent(repository, 'xdb_create_plan', idempotencyKey, payload, async () =>
        jsonRecord({ plan: await service.createPlan(requestId, provider) }),
      );
      return textResult(withReplay(operation.result, operation.replayed));
    },
  );

  server.registerTool(
    'xdb_create_plan_family',
    {
      title: 'Create a local Design Plan family',
      description: 'Create two or three distinct local candidates for one Design Request without external provider calls.',
      inputSchema: planFamilyInputSchema.extend({ idempotencyKey: idempotencyKeySchema }),
      annotations: writeAnnotations,
    },
    async ({ idempotencyKey, ...input }) => {
      const operation = await executeIdempotent(repository, 'xdb_create_plan_family', idempotencyKey, input, async () =>
        jsonRecord(await service.createPlanFamily(input)),
      );
      return textResult(withReplay(operation.result, operation.replayed));
    },
  );

  server.registerTool(
    'xdb_create_artifacts',
    {
      title: 'Create design artifacts',
      description: 'Create configured local artifacts. Figma output is an operation plan and script, not an implicit external write.',
      inputSchema: creationRunInputSchema.extend({ idempotencyKey: idempotencyKeySchema }),
      annotations: writeAnnotations,
    },
    async ({ idempotencyKey, ...input }) => {
      const operation = await executeIdempotent(repository, 'xdb_create_artifacts', idempotencyKey, input, async () => {
        const run = await service.createArtifacts(input);
        return jsonRecord({
          runId: run.id,
          status: run.status,
          summary: run.summary,
          artifacts: run.artifacts.map((artifact) => ({
            id: artifact.id,
            kind: artifact.kind,
            uri: `xdb://artifact/${artifact.id}`,
            sha256: artifact.sha256,
          })),
        });
      });
      const result = withReplay(operation.result, operation.replayed);
      const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
      const links: CallToolResult['content'] = artifacts.flatMap((value) => {
        if (!value || typeof value !== 'object') return [];
        const artifact = value as { id?: unknown; kind?: unknown; uri?: unknown };
        if (typeof artifact.id !== 'string' || typeof artifact.kind !== 'string' || typeof artifact.uri !== 'string') return [];
        return [{
          type: 'resource_link' as const,
          name: `${artifact.kind}-${artifact.id}`,
          uri: artifact.uri,
          description: `XDB ${artifact.kind} artifact`,
        }];
      });
      return textResult(result, links);
    },
  );

  server.registerTool(
    'xdb_record_evaluation',
    {
      title: 'Record a design evaluation',
      description: 'Persist a human or automatic evaluation with scores and rationale.',
      inputSchema: evaluationInputSchema.extend({ idempotencyKey: idempotencyKeySchema }),
      annotations: writeAnnotations,
    },
    async ({ idempotencyKey, ...input }) => {
      const operation = await executeIdempotent(repository, 'xdb_record_evaluation', idempotencyKey, input, () =>
        jsonRecord({ evaluation: service.recordEvaluation(input) }),
      );
      return textResult(withReplay(operation.result, operation.replayed));
    },
  );

  server.registerTool(
    'xdb_record_figma_delivery',
    {
      title: 'Record a Figma delivery result',
      description: 'Persist Figma node IDs and structural/screenshot evidence after an explicit external write.',
      inputSchema: figmaDeliveryInputSchema.extend({ idempotencyKey: idempotencyKeySchema }),
      annotations: writeAnnotations,
    },
    async ({ idempotencyKey, ...input }) => {
      const operation = await executeIdempotent(repository, 'xdb_record_figma_delivery', idempotencyKey, input, () =>
        jsonRecord({ delivery: service.recordFigmaDelivery(input) }),
      );
      return textResult(withReplay(operation.result, operation.replayed));
    },
  );

  server.registerTool(
    'xdb_compare_artifacts',
    {
      title: 'Record an artifact preference',
      description: 'Persist a pairwise artifact preference and its rationale.',
      inputSchema: comparisonInputSchema.extend({ idempotencyKey: idempotencyKeySchema }),
      annotations: writeAnnotations,
    },
    async ({ idempotencyKey, ...input }) => {
      const operation = await executeIdempotent(repository, 'xdb_compare_artifacts', idempotencyKey, input, () =>
        jsonRecord({ comparison: service.compareArtifacts(input) }),
      );
      return textResult(withReplay(operation.result, operation.replayed));
    },
  );

  server.registerTool(
    'xdb_get_run_status',
    {
      title: 'Get Creation Run status',
      description: 'Return the current status and artifact metadata for a Creation Run.',
      inputSchema: runIdSchema,
      annotations: readAnnotations,
    },
    ({ runId }) => textResult(jsonRecord({ run: service.getRunStatus(runId) })),
  );

  server.registerResource(
    'xdb-artifact',
    new ResourceTemplate('xdb://artifact/{artifactId}', { list: undefined }),
    { title: 'XDB artifact', description: 'A generated XDB artifact addressed by its immutable artifact ID.' },
    async (uri, variables) => {
      const artifactId = variables.artifactId;
      if (typeof artifactId !== 'string') throw new ApplicationError('artifact_id_invalid', 400, 'Artifact ID is invalid.');
      const { artifact, content } = await service.readArtifact(artifactId);
      return {
        contents: [{ uri: uri.href, mimeType: artifactMimeType(artifact.kind), text: content }],
      };
    },
  );

  return server;
}
