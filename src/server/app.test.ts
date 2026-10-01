import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CreationRun, DesignPlan, DesignRequest } from '../shared/contracts.js';

import { buildApp } from './app.js';
import type { RuntimeConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { Repository } from './db/repository.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createTestApp(
  providerOverrides: Partial<RuntimeConfig['design']['ai']['providers']['anthropic']> = {},
  credentialOverrides: Partial<RuntimeConfig['anthropic']> = {},
) {
  const directory = mkdtempSync(path.join(tmpdir(), 'xdb-test-'));
  temporaryDirectories.push(directory);
  const database = openDatabase(path.join(directory, 'xdb.sqlite'));
  const app = buildApp({
    repository: new Repository(database),
    config: {
      host: '127.0.0.1',
      port: 4310,
      databasePath: path.join(directory, 'xdb.sqlite'),
      artifactsPath: path.join(directory, 'artifacts'),
      figmaMcpServer: null,
      imageProvider: null,
      anthropic: { apiKey: null, model: null, baseUrl: 'https://api.anthropic.com', ...credentialOverrides },
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
              ...providerOverrides,
            },
          },
        },
        figma: { enabled: true, requireExistingFile: true, reuseExistingComponents: true, reuseExistingVariables: true },
        html: { enabled: true, format: 'standalone', responsive: true, accessibilityTarget: 'WCAG-AA' },
        illustration: { enabled: true, candidateCount: 4, requireHumanApproval: true, storeRejectedCandidates: true },
        evaluation: { automatic: true, pairwiseComparison: true, requireHumanReview: true },
        knowledge: { recordProvenance: true, recordRejectedDesigns: true },
      },
    },
  });
  return { app, database };
}

describe('XDB API workflow', () => {
  it('runs request -> plan -> both adapters and reports external Figma blocking', async () => {
    const { app, database } = createTestApp();
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/api/requests',
      payload: {
        prompt: '個人事業主向け請求書サービスのLPをデザインして、Heroにはイラストを使う',
        projectName: 'Invoice Flow',
        audience: '個人事業主',
        objective: '無料登録への誘導',
        concepts: ['信頼感', '親しみ'],
        avoid: ['過度な3D'],
        outputMode: 'both',
      },
    });
    expect(requestResponse.statusCode).toBe(201);
    const designRequest = requestResponse.json<DesignRequest>();

    const planResponse = await app.inject({ method: 'POST', url: '/api/plans', payload: { requestId: designRequest.id } });
    expect(planResponse.statusCode).toBe(201);
    const plan = planResponse.json<DesignPlan>();

    const runResponse = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { planId: plan.id, outputMode: 'both', figmaFileKey: null },
    });
    expect(runResponse.statusCode).toBe(201);
    const run = runResponse.json<CreationRun>();
    expect(run.status).toBe('partial');
    expect(run.artifacts.map((artifact) => artifact.kind)).toEqual(
      expect.arrayContaining(['html', 'figma-plan', 'figma-script', 'illustration-spec', 'report']),
    );

    const evaluationResponse = await app.inject({ method: 'GET', url: '/api/evaluations' });
    expect(evaluationResponse.json<unknown[]>()).toHaveLength(2);
    await app.close();
    database.close();
  });

  it('rejects non-design requests before storing them', async () => {
    const { app, database } = createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/requests',
      payload: {
        prompt: 'データベースのmigrationだけを修正してください',
        projectName: 'Database maintenance',
        audience: 'developers',
        objective: 'repair migration',
        concepts: ['safety'],
        avoid: [],
        outputMode: 'html',
      },
    });
    expect(response.statusCode).toBe(422);
    const requests = await app.inject({ method: 'GET', url: '/api/requests' });
    expect(requests.json<unknown[]>()).toHaveLength(0);
    await app.close();
    database.close();
  });

  it('records an explicit local fallback when Claude external requests are disabled', async () => {
    const { app, database } = createTestApp();
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/api/requests',
      payload: {
        prompt: '採用管理サービスのランディングページをデザインしてください',
        projectName: 'Hiring Flow',
        audience: '採用担当者',
        objective: 'デモ予約',
        concepts: ['明快さ'],
        avoid: [],
        outputMode: 'html',
      },
    });
    const designRequest = requestResponse.json<DesignRequest>();
    const planResponse = await app.inject({
      method: 'POST',
      url: '/api/plans',
      payload: { requestId: designRequest.id, provider: 'anthropic' },
    });
    expect(planResponse.statusCode).toBe(201);
    expect(planResponse.json<DesignPlan>().generation).toEqual({
      provider: 'local',
      model: 'xdb-deterministic-v1',
      fallbackUsed: true,
    });
    const aiRuns = await app.inject({ method: 'GET', url: '/api/ai-runs' });
    expect(aiRuns.json<Array<{ provider: string; status: string; fallbackUsed: boolean; errorCode: string }>>()).toEqual([
      expect.objectContaining({ provider: 'anthropic', status: 'fallback', fallbackUsed: true, errorCode: 'external_requests_disabled' }),
    ]);
    await app.close();
    database.close();
  });

  it('blocks Claude before network access when the monthly token budget is insufficient', async () => {
    const { app, database } = createTestApp(
      { allowExternalRequests: true, monthlyTokenBudget: 4_095 },
      { apiKey: 'test-key', model: 'test-model' },
    );
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/api/requests',
      payload: {
        prompt: '予約管理サービスのランディングページをデザインしてください',
        projectName: 'Booking Flow',
        audience: '店舗運営者',
        objective: '問い合わせ獲得',
        concepts: ['安心感'],
        avoid: [],
        outputMode: 'html',
      },
    });
    const designRequest = requestResponse.json<DesignRequest>();
    const planResponse = await app.inject({
      method: 'POST',
      url: '/api/plans',
      payload: { requestId: designRequest.id, provider: 'anthropic' },
    });
    expect(planResponse.statusCode).toBe(201);
    const aiRuns = await app.inject({ method: 'GET', url: '/api/ai-runs' });
    expect(aiRuns.json<Array<{ errorCode: string; attemptCount: number }>>()[0]).toMatchObject({
      errorCode: 'budget_exceeded',
      attemptCount: 0,
    });
    await app.close();
    database.close();
  });

  it('falls back and audits a categorized Claude timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); }));
    const { app, database } = createTestApp(
      { allowExternalRequests: true, monthlyTokenBudget: 10_000 },
      { apiKey: 'test-key', model: 'test-model' },
    );
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/api/requests',
      payload: {
        prompt: '顧客管理サービスのランディングページをデザインしてください',
        projectName: 'Customer Flow',
        audience: '小規模事業者',
        objective: '無料登録',
        concepts: ['明快さ'],
        avoid: [],
        outputMode: 'html',
      },
    });
    const designRequest = requestResponse.json<DesignRequest>();
    const planResponse = await app.inject({
      method: 'POST',
      url: '/api/plans',
      payload: { requestId: designRequest.id, provider: 'anthropic' },
    });
    expect(planResponse.statusCode).toBe(201);
    expect(planResponse.json<DesignPlan>().generation).toMatchObject({ provider: 'local', fallbackUsed: true });
    const aiRuns = await app.inject({ method: 'GET', url: '/api/ai-runs' });
    expect(aiRuns.json<Array<{ errorCode: string; attemptCount: number }>>()[0]).toMatchObject({
      errorCode: 'timeout',
      attemptCount: 1,
    });
    await app.close();
    database.close();
  });

  it('returns 503 and records failure when fallback is disabled', async () => {
    const { app, database } = createTestApp({ fallbackToLocal: false });
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/api/requests',
      payload: {
        prompt: '勤怠管理サービスのランディングページをデザインしてください',
        projectName: 'Time Flow',
        audience: '人事担当者',
        objective: '資料請求',
        concepts: ['効率性'],
        avoid: [],
        outputMode: 'html',
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/plans',
      payload: { requestId: requestResponse.json<DesignRequest>().id, provider: 'anthropic' },
    });
    expect(response.statusCode).toBe(503);
    const aiRuns = await app.inject({ method: 'GET', url: '/api/ai-runs' });
    expect(aiRuns.json<Array<{ status: string; errorCode: string }>>()[0]).toMatchObject({
      status: 'failed',
      errorCode: 'external_requests_disabled',
    });
    await app.close();
    database.close();
  });
});
