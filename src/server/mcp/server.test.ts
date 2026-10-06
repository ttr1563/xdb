import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';

import { seedXdbRepository, XdbService } from '../application/xdb-service.js';
import { ArtifactStore } from '../artifacts/store.js';
import type { RuntimeConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { Repository } from '../db/repository.js';

import { createXdbMcpServer } from './server.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function runtimeConfig(directory: string): RuntimeConfig {
  return {
    host: '127.0.0.1',
    port: 4310,
    databasePath: path.join(directory, 'xdb.sqlite'),
    artifactsPath: path.join(directory, 'artifacts'),
    figmaMcpServer: null,
    imageProvider: null,
    anthropic: { apiKey: null, model: null, baseUrl: 'https://api.anthropic.com' },
    design: {
      version: 1,
      output: { defaultMode: 'both', availableModes: ['figma', 'html', 'both'] },
      ai: {
        defaultProvider: 'local',
        providers: {
          local: { enabled: true },
          anthropic: {
            enabled: true,
            allowExternalRequests: false,
            fallbackToLocal: true,
            allowedBaseUrls: ['https://api.anthropic.com'],
            timeoutMs: 30_000,
            maxOutputTokens: 4_096,
            maxRetries: 1,
            retryBaseDelayMs: 500,
            monthlyTokenBudget: 0,
          },
        },
      },
      figma: { enabled: true, requireExistingFile: true, reuseExistingComponents: true, reuseExistingVariables: true },
      html: { enabled: true, format: 'standalone', responsive: true, accessibilityTarget: 'WCAG-AA' },
      illustration: { enabled: true, candidateCount: 4, requireHumanApproval: true, storeRejectedCandidates: true },
      evaluation: { automatic: true, pairwiseComparison: true, requireHumanReview: true },
      knowledge: { recordProvenance: true, recordRejectedDesigns: true },
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('Expected structured MCP content.');
  return value as Record<string, unknown>;
}

describe('XDB MCP facade', () => {
  it('exposes the planned tools and runs an idempotent local workflow with artifact resources', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-mcp-'));
    temporaryDirectories.push(directory);
    const config = runtimeConfig(directory);
    const database = openDatabase(config.databasePath);
    const repository = new Repository(database);
    seedXdbRepository(repository);
    const service = new XdbService({ repository, config, artifactStore: new ArtifactStore(config.artifactsPath) });
    const server = createXdbMcpServer({ service, repository });
    const client = new Client({ name: 'xdb-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'xdb_classify_design_input',
        'xdb_compare_artifacts',
        'xdb_create_artifacts',
        'xdb_create_context_taxonomy',
        'xdb_create_plan',
        'xdb_create_plan_family',
        'xdb_create_request',
        'xdb_get_dataset_snapshot',
        'xdb_get_run_status',
        'xdb_import_knowledge',
        'xdb_list_request_references',
        'xdb_record_evaluation',
        'xdb_record_figma_delivery',
        'xdb_record_reference_analysis',
        'xdb_review_request_reference',
        'xdb_search_knowledge',
        'xdb_update_knowledge_lifecycle',
      ]);

      const taxonomyResult = await client.callTool({
        name: 'xdb_create_context_taxonomy',
        arguments: {
          canonical: 'product-marketing',
          aliases: ['PM Site'],
          idempotencyKey: 'taxonomy:product-marketing:1',
        },
      });
      expect(asRecord(taxonomyResult.structuredContent).replayed).toBe(false);
      const importResult = await client.callTool({
        name: 'xdb_import_knowledge',
        arguments: {
          format: 'json',
          items: [{
            title: 'MCP research reference',
            summary: 'MCP経由で登録する検証可能な参照情報です。',
            kind: 'reference',
            contexts: ['PM Site'],
            concepts: ['clarity'],
            evidence: 'MCP importとdataset snapshotの統合検証です。',
            provenance: {
              sourceType: 'human', sourceUri: null, license: 'Owned research',
              rightsStatus: 'verified', trainingEligible: true, capturedAt: '2026-10-06T00:00:00.000Z',
            },
          }],
          idempotencyKey: 'import:mcp-research:1',
        },
      });
      expect(asRecord(asRecord(importResult.structuredContent).batch).createdCount).toBe(1);
      const imported = repository.listKnowledge().find((item) => item.title === 'MCP research reference');
      expect(imported?.contexts).toEqual(['product-marketing']);
      const snapshotResult = await client.callTool({ name: 'xdb_get_dataset_snapshot', arguments: {} });
      const snapshotKnowledge = asRecord(snapshotResult.structuredContent).knowledge as Array<Record<string, unknown>>;
      expect(snapshotKnowledge.some((item) => item.id === imported?.id)).toBe(true);
      const lifecycleResult = await client.callTool({
        name: 'xdb_update_knowledge_lifecycle',
        arguments: {
          knowledgeId: imported?.id,
          action: 'exclude',
          reason: 'MCP lifecycle integration test.',
          idempotencyKey: 'lifecycle:mcp-research:1',
        },
      });
      expect(asRecord(asRecord(lifecycleResult.structuredContent).knowledge).lifecycle).toBe('excluded');

      const requestArguments = {
        idempotencyKey: 'request:invoice-flow:1',
        prompt: '個人事業主向け請求書サービスのLPをデザインしてください',
        projectName: 'Invoice Flow',
        audience: '個人事業主',
        objective: '無料登録',
        concepts: ['信頼感'],
        avoid: ['過度な3D'],
        references: [{
          url: 'https://example.com/invoice-design#hero',
          role: 'inspiration',
          note: 'Heroの情報階層を調査する',
        }],
        outputMode: 'html',
      };
      const created = await client.callTool({ name: 'xdb_create_request', arguments: requestArguments });
      const createdContent = asRecord(created.structuredContent);
      const request = asRecord(createdContent.request);
      expect(createdContent.replayed).toBe(false);
      expect(repository.listRequests()).toHaveLength(1);

      const replay = await client.callTool({ name: 'xdb_create_request', arguments: requestArguments });
      expect(asRecord(replay.structuredContent).replayed).toBe(true);
      expect(repository.listRequests()).toHaveLength(1);

      const conflict = await client.callTool({
        name: 'xdb_create_request',
        arguments: { ...requestArguments, objective: '資料請求' },
      });
      expect(conflict.isError).toBe(true);
      expect(repository.listRequests()).toHaveLength(1);

      const listedReferences = await client.callTool({
        name: 'xdb_list_request_references',
        arguments: { requestId: request.id },
      });
      const references = asRecord(listedReferences.structuredContent).references as Array<Record<string, unknown>>;
      expect(references).toEqual([
        expect.objectContaining({ url: 'https://example.com/invoice-design', status: 'pending' }),
      ]);
      const referenceId = String(references[0]?.id);
      const analyzed = await client.callTool({
        name: 'xdb_record_reference_analysis',
        arguments: {
          referenceId,
          title: '請求サービスHeroの情報階層',
          summary: '価値提案と主要CTAを近接させ、補助情報との階層を明確にしている。',
          contexts: ['landing-page', 'hero'],
          concepts: ['clarity', 'trustworthy'],
          strengths: ['価値提案から主要行動への流れが明確である。'],
          risks: ['自社の根拠情報を別途検証する必要がある。'],
          evidence: '許可されたMCPクライアントによる目視分析。',
          license: null,
          rightsStatus: 'unverified',
          trainingEligible: false,
          idempotencyKey: 'reference-analysis:invoice-flow:1',
        },
      });
      expect(asRecord(asRecord(analyzed.structuredContent).reference).status).toBe('analyzed');
      const analyzedReplay = await client.callTool({
        name: 'xdb_record_reference_analysis',
        arguments: {
          referenceId,
          title: '請求サービスHeroの情報階層',
          summary: '価値提案と主要CTAを近接させ、補助情報との階層を明確にしている。',
          contexts: ['landing-page', 'hero'],
          concepts: ['clarity', 'trustworthy'],
          strengths: ['価値提案から主要行動への流れが明確である。'],
          risks: ['自社の根拠情報を別途検証する必要がある。'],
          evidence: '許可されたMCPクライアントによる目視分析。',
          license: null,
          rightsStatus: 'unverified',
          trainingEligible: false,
          idempotencyKey: 'reference-analysis:invoice-flow:1',
        },
      });
      expect(asRecord(analyzedReplay.structuredContent).replayed).toBe(true);
      const reviewed = await client.callTool({
        name: 'xdb_review_request_reference',
        arguments: {
          referenceId,
          decision: 'approved',
          reason: '設計時の参考ナレッジとして採用する。',
          idempotencyKey: 'reference-review:invoice-flow:1',
        },
      });
      const approvedReference = asRecord(asRecord(reviewed.structuredContent).reference);
      expect(approvedReference.status).toBe('approved');
      const reviewedReplay = await client.callTool({
        name: 'xdb_review_request_reference',
        arguments: {
          referenceId,
          decision: 'approved',
          reason: '設計時の参考ナレッジとして採用する。',
          idempotencyKey: 'reference-review:invoice-flow:1',
        },
      });
      expect(asRecord(reviewedReplay.structuredContent).replayed).toBe(true);
      const searchResult = await client.callTool({
        name: 'xdb_search_knowledge',
        arguments: { requestId: request.id },
      });
      const rankedItems = asRecord(searchResult.structuredContent).items as Array<Record<string, unknown>>;
      expect(rankedItems[0]?.id).toBe(approvedReference.knowledgeId);

      const familyResult = await client.callTool({
        name: 'xdb_create_plan_family',
        arguments: {
          requestId: request.id,
          provider: 'local',
          strategies: ['conservative', 'expressive', 'conversion-led'],
          idempotencyKey: 'family:invoice-flow:1',
        },
      });
      const familyPlans = asRecord(familyResult.structuredContent).plans as Array<Record<string, unknown>>;
      expect(familyPlans).toHaveLength(3);
      expect(new Set(familyPlans.map((candidate) => candidate.fingerprint)).size).toBe(3);

      const planResult = await client.callTool({
        name: 'xdb_create_plan',
        arguments: {
          requestId: request.id,
          provider: 'local',
          idempotencyKey: 'plan:invoice-flow:1',
        },
      });
      const plan = asRecord(asRecord(planResult.structuredContent).plan);
      const runResult = await client.callTool({
        name: 'xdb_create_artifacts',
        arguments: {
          planId: plan.id,
          outputMode: 'html',
          figmaFileKey: null,
          idempotencyKey: 'artifacts:invoice-flow:1',
        },
      });
      const runContent = asRecord(runResult.structuredContent);
      expect(runContent.status).toBe('completed');
      const artifacts = runContent.artifacts as Array<Record<string, unknown>>;
      const html = artifacts.find((artifact) => artifact.kind === 'html');
      expect(html?.uri).toMatch(/^xdb:\/\/artifact\//);

      const resource = await client.readResource({ uri: String(html?.uri) });
      const resourceContent = resource.contents[0];
      expect(resourceContent).toMatchObject({ mimeType: 'text/html' });
      expect(resourceContent && 'text' in resourceContent ? resourceContent.text : '').toContain('<!doctype html>');

      const status = await client.callTool({
        name: 'xdb_get_run_status',
        arguments: { runId: runContent.runId },
      });
      expect(asRecord(asRecord(status.structuredContent).run).status).toBe('completed');

      const figmaRunResult = await client.callTool({
        name: 'xdb_create_artifacts',
        arguments: {
          planId: plan.id,
          outputMode: 'figma',
          figmaFileKey: 'figma-test-file',
          idempotencyKey: 'artifacts:invoice-figma:1',
        },
      });
      const figmaRun = asRecord(figmaRunResult.structuredContent);
      const structure = {
        nodeCount: 20,
        textNodeCount: 8,
        instanceCount: 2,
        width: 1440,
        height: 3000,
        clippedTextCount: 0,
        placeholderTextCount: 0,
        imageFillCount: 0,
      };
      const delivery = await client.callTool({
        name: 'xdb_record_figma_delivery',
        arguments: {
          runId: figmaRun.runId,
          operationKey: `figma:${String(figmaRun.runId)}:v1`,
          fileKey: 'figma-test-file',
          status: 'completed',
          pageId: '0:1',
          desktopNodeId: '10:1',
          mobileNodeId: '20:1',
          createdNodeIds: ['10:1', '20:1'],
          mutatedNodeIds: [],
          desktopStructure: structure,
          mobileStructure: { ...structure, width: 390, height: 4000 },
          desktopScreenshotCaptured: true,
          mobileScreenshotCaptured: true,
          error: null,
          idempotencyKey: 'delivery:invoice-figma:1',
        },
      });
      expect(asRecord(delivery.structuredContent).replayed).toBe(false);
      expect(repository.getRun(String(figmaRun.runId))?.status).toBe('completed');
    } finally {
      await client.close();
      await server.close();
      database.close();
    }
  });

  it('rejects invalid tool arguments before writing', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-mcp-'));
    temporaryDirectories.push(directory);
    const config = runtimeConfig(directory);
    const database = openDatabase(config.databasePath);
    const repository = new Repository(database);
    seedXdbRepository(repository);
    const service = new XdbService({ repository, config, artifactStore: new ArtifactStore(config.artifactsPath) });
    const server = createXdbMcpServer({ service, repository });
    const client = new Client({ name: 'xdb-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: 'xdb_create_request',
        arguments: { idempotencyKey: 'short' },
      });
      expect(result.isError).toBe(true);
      expect(repository.listRequests()).toHaveLength(0);
    } finally {
      await client.close();
      await server.close();
      database.close();
    }
  });

  it('does not execute a write whose prior outcome is unknown', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-mcp-'));
    temporaryDirectories.push(directory);
    const config = runtimeConfig(directory);
    const database = openDatabase(config.databasePath);
    const repository = new Repository(database);
    seedXdbRepository(repository);
    const service = new XdbService({ repository, config, artifactStore: new ArtifactStore(config.artifactsPath) });
    const server = createXdbMcpServer({ service, repository });
    const client = new Client({ name: 'xdb-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const requestId = randomUUID();
    const payload = { requestId, provider: 'local' };
    const key = 'plan:unknown-outcome:1';
    const requestHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    repository.claimMcpOperation(key, 'xdb_create_plan', requestHash);
    database.prepare('UPDATE mcp_operations SET lease_expires_at = ? WHERE idempotency_key = ?')
      .run('2000-01-01T00:00:00.000Z', key);

    try {
      const result = await client.callTool({
        name: 'xdb_create_plan',
        arguments: { ...payload, idempotencyKey: key },
      });
      expect(result.isError).toBe(true);
      expect(repository.listPlans()).toHaveLength(0);
    } finally {
      await client.close();
      await server.close();
      database.close();
    }
  });
});
