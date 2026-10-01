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
        'xdb_create_plan',
        'xdb_create_plan_family',
        'xdb_create_request',
        'xdb_get_run_status',
        'xdb_record_evaluation',
        'xdb_search_knowledge',
      ]);

      const requestArguments = {
        idempotencyKey: 'request:invoice-flow:1',
        prompt: '個人事業主向け請求書サービスのLPをデザインしてください',
        projectName: 'Invoice Flow',
        audience: '個人事業主',
        objective: '無料登録',
        concepts: ['信頼感'],
        avoid: ['過度な3D'],
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
