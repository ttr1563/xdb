import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CreationRun, DesignPlan, DesignRequest } from '../shared/contracts.js';

import { buildApp } from './app.js';
import { openDatabase } from './db/database.js';
import { Repository } from './db/repository.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createTestApp() {
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
      design: {
        version: 1,
        output: { defaultMode: 'both', availableModes: ['figma', 'html', 'both'] },
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
});
