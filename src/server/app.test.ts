import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  CreationRun,
  DesignPlan,
  DesignRequest,
  FigmaDelivery,
  KnowledgeImportBatch,
  KnowledgeItem,
  PlanFamily,
} from '../shared/contracts.js';

import { buildApp } from './app.js';
import type { RuntimeConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { Repository } from './db/repository.js';

const temporaryDirectories: string[] = [];

function multipartImage(
  buffer: Buffer,
  filename = 'reference.png',
  mimeType = 'image/png',
): { body: Buffer; contentType: string } {
  const boundary = '----xdb-test-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createTestApp(
  providerOverrides: Partial<RuntimeConfig['design']['ai']['providers']['anthropic']> = {},
  credentialOverrides: Partial<RuntimeConfig['anthropic']> = {},
  localProviderOverrides: Partial<RuntimeConfig['design']['ai']['providers']['local']> = {},
  figmaOverrides: Partial<RuntimeConfig['design']['figma']> = {},
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
            local: { enabled: true, ...localProviderOverrides },
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
        figma: { enabled: true, requireExistingFile: true, reuseExistingComponents: true, reuseExistingVariables: true, ...figmaOverrides },
        html: { enabled: true, format: 'standalone', responsive: true, accessibilityTarget: 'WCAG-AA' },
        illustration: { enabled: true, candidateCount: 4, requireHumanApproval: true, storeRejectedCandidates: true },
        evaluation: { automatic: true, pairwiseComparison: true, requireHumanReview: true },
        knowledge: { recordProvenance: true, recordRejectedDesigns: true },
      },
    },
  });
  return { app, database };
}

function knowledgePayload(title: string, sourceUri: string, contexts = ['product-marketing']) {
  return {
    title,
    summary: `${title}の検証可能な要約です。`,
    kind: 'reference',
    contexts,
    concepts: ['clarity'],
    evidence: `${title}を比較評価した根拠です。`,
    provenance: {
      sourceType: 'url',
      sourceUri,
      license: 'CC BY 4.0',
      rightsStatus: 'verified',
      trainingEligible: true,
      capturedAt: '2026-10-06T00:00:00.000Z',
    },
  };
}

describe('XDB API workflow', () => {
  it('rejects plan family generation when the local provider is disabled', async () => {
    const { app, database } = createTestApp({}, {}, { enabled: false });
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/api/requests',
      payload: {
        prompt: 'ローカル生成を無効化した状態でLPをデザインしてください',
        projectName: 'Disabled Local Provider',
        audience: '事業者',
        objective: '設定ゲートを確認する',
        concepts: ['明快'],
        avoid: [],
        outputMode: 'html',
      },
    });
    const designRequest = requestResponse.json<DesignRequest>();

    const familyResponse = await app.inject({
      method: 'POST',
      url: '/api/plan-families',
      payload: { requestId: designRequest.id },
    });

    expect(familyResponse.statusCode).toBe(409);
    expect(familyResponse.json()).toEqual(expect.objectContaining({ error: 'local_ai_provider_disabled' }));
    expect((await app.inject({ method: 'GET', url: '/api/plan-families' })).json()).toEqual([]);
    await app.close();
    database.close();
  });

  it('creates distinct local candidates and only accepts a comparable pair', async () => {
    const { app, database } = createTestApp();
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/api/requests',
      payload: {
        prompt: '個人事業主向け請求書サービスのLPを複数案デザインしてください',
        projectName: 'Invoice Candidates',
        audience: '個人事業主',
        objective: '無料登録への誘導',
        concepts: ['信頼感', '親しみ'],
        avoid: ['過度な3D'],
        outputMode: 'html',
      },
    });
    const designRequest = requestResponse.json<DesignRequest>();
    const familyResponse = await app.inject({
      method: 'POST',
      url: '/api/plan-families',
      payload: { requestId: designRequest.id },
    });
    expect(familyResponse.statusCode).toBe(201);
    const familyResult = familyResponse.json<{ family: PlanFamily; plans: DesignPlan[] }>();
    expect(familyResult.plans).toHaveLength(3);
    expect(new Set(familyResult.plans.map((plan) => plan.fingerprint)).size).toBe(3);

    const runs: CreationRun[] = [];
    for (const plan of familyResult.plans.slice(0, 2)) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { planId: plan.id, outputMode: 'html', figmaFileKey: null },
      });
      runs.push(response.json<CreationRun>());
    }
    const artifactA = runs[0]?.artifacts.find((artifact) => artifact.kind === 'html');
    const artifactB = runs[1]?.artifacts.find((artifact) => artifact.kind === 'html');
    if (!artifactA || !artifactB) throw new Error('Expected HTML candidate artifacts.');

    const invalidPreference = await app.inject({
      method: 'POST',
      url: '/api/comparisons',
      payload: {
        requestId: designRequest.id,
        artifactAId: artifactA.id,
        artifactBId: artifactB.id,
        preferredArtifactId: randomUUID(),
        rationale: '比較対象外を選択',
      },
    });
    expect(invalidPreference.statusCode).toBe(400);

    const sameArtifact = await app.inject({
      method: 'POST',
      url: '/api/comparisons',
      payload: {
        requestId: designRequest.id,
        artifactAId: artifactA.id,
        artifactBId: artifactA.id,
        preferredArtifactId: artifactA.id,
        rationale: '同一成果物は比較しない',
      },
    });
    expect(sameArtifact.statusCode).toBe(400);

    const otherFamilyResponse = await app.inject({
      method: 'POST',
      url: '/api/plan-families',
      payload: { requestId: designRequest.id, strategies: ['conservative', 'expressive'] },
    });
    const otherPlan = otherFamilyResponse.json<{ plans: DesignPlan[] }>().plans[0];
    if (!otherPlan) throw new Error('Expected another family candidate.');
    const otherRunResponse = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { planId: otherPlan.id, outputMode: 'html', figmaFileKey: null },
    });
    const otherArtifact = otherRunResponse.json<CreationRun>().artifacts.find((artifact) => artifact.kind === 'html');
    if (!otherArtifact) throw new Error('Expected another HTML candidate artifact.');
    const familyMismatch = await app.inject({
      method: 'POST',
      url: '/api/comparisons',
      payload: {
        requestId: designRequest.id,
        artifactAId: artifactA.id,
        artifactBId: otherArtifact.id,
        preferredArtifactId: artifactA.id,
        rationale: '別familyとの比較は保存しない',
      },
    });
    expect(familyMismatch.statusCode).toBe(409);

    const comparisonResponse = await app.inject({
      method: 'POST',
      url: '/api/comparisons',
      payload: {
        requestId: designRequest.id,
        artifactAId: artifactA.id,
        artifactBId: artifactB.id,
        preferredArtifactId: artifactA.id,
        rationale: '情報階層がより明確で主要導線を理解しやすい。',
      },
    });
    expect(comparisonResponse.statusCode).toBe(201);

    const exportResponse = await app.inject({ method: 'GET', url: '/api/export' });
    const exported = exportResponse.json<{ comparisonContexts: Array<Record<string, unknown>> }>();
    expect(exported.comparisonContexts).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({ id: designRequest.id }),
        candidateA: expect.objectContaining({ familyId: familyResult.family.id, viewport: 'responsive-desktop-mobile' }),
        candidateB: expect.objectContaining({ familyId: familyResult.family.id, contentCompleteness: 'complete' }),
      }),
    ]);
    const requests = await app.inject({ method: 'GET', url: '/api/requests' });
    expect(requests.json<DesignRequest>()[0]?.status).toBe('reviewed');
    await app.close();
    database.close();
  });

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

    const missingTargetResponse = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { planId: plan.id, outputMode: 'both', figmaFileKey: null },
    });
    expect(missingTargetResponse.statusCode).toBe(400);
    expect(missingTargetResponse.json()).toEqual(expect.objectContaining({ error: 'figma_file_required' }));

    const runResponse = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { planId: plan.id, outputMode: 'both', figmaFileKey: 'test-file-key' },
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

  it('records validated Figma delivery evidence and completes the run', async () => {
    const { app, database } = createTestApp({}, {}, {}, { requireExistingFile: false });
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/api/requests',
      payload: {
        prompt: '請求書サービスの編集可能なFigmaランディングページをデザインしてください',
        projectName: 'Figma Delivery',
        audience: '個人事業主',
        objective: '無料登録',
        concepts: ['信頼感'],
        avoid: [],
        outputMode: 'figma',
      },
    });
    const designRequest = requestResponse.json<DesignRequest>();
    const planResponse = await app.inject({
      method: 'POST',
      url: '/api/plans',
      payload: { requestId: designRequest.id },
    });
    expect(planResponse.statusCode, planResponse.body).toBe(201);
    const plan = planResponse.json<DesignPlan>();
    const runResponse = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { planId: plan.id, outputMode: 'figma', figmaFileKey: null },
    });
    expect(runResponse.statusCode, runResponse.body).toBe(201);
    const run = runResponse.json<CreationRun>();
    expect(run.status).toBe('blocked_external');
    const structure = {
      nodeCount: 24,
      textNodeCount: 8,
      instanceCount: 2,
      width: 1440,
      height: 3200,
      clippedTextCount: 0,
      placeholderTextCount: 0,
      imageFillCount: 0,
    };
    const deliveryInput = {
      runId: run.id,
      operationKey: `figma:${run.id}:v1`,
      fileKey: 'test-file-key',
      status: 'completed',
      pageId: '0:1',
      desktopNodeId: '10:1',
      mobileNodeId: '20:1',
      createdNodeIds: ['I10:2;30:4'],
      mutatedNodeIds: [],
      observedNodeIds: ['10:1', '20:1'],
      desktopStructure: structure,
      mobileStructure: { ...structure, width: 390, height: 4100 },
      desktopScreenshotCaptured: true,
      mobileScreenshotCaptured: true,
      error: null,
    };
    const deliveryResponse = await app.inject({
      method: 'POST',
      url: '/api/figma-deliveries',
      payload: deliveryInput,
    });
    expect(deliveryResponse.statusCode).toBe(201);
    expect(deliveryResponse.json<FigmaDelivery>()).toMatchObject(deliveryInput);
    const replayResponse = await app.inject({
      method: 'POST',
      url: '/api/figma-deliveries',
      payload: deliveryInput,
    });
    expect(replayResponse.json<FigmaDelivery>().id).toBe(deliveryResponse.json<FigmaDelivery>().id);
    const duplicateCompletionResponse = await app.inject({
      method: 'POST',
      url: '/api/figma-deliveries',
      payload: { ...deliveryInput, operationKey: `figma:${run.id}:v2` },
    });
    expect(duplicateCompletionResponse.statusCode).toBe(409);
    expect(duplicateCompletionResponse.json()).toEqual(expect.objectContaining({
      error: 'figma_operation_mismatch',
    }));
    const latePartialResponse = await app.inject({
      method: 'POST',
      url: '/api/figma-deliveries',
      payload: {
        ...deliveryInput,
        status: 'partial',
        desktopScreenshotCaptured: false,
        mobileScreenshotCaptured: false,
        error: 'A late partial result must not downgrade a completed run.',
      },
    });
    expect(latePartialResponse.statusCode).toBe(409);
    expect(latePartialResponse.json()).toEqual(expect.objectContaining({ error: 'figma_operation_conflict' }));
    const statusResponse = await app.inject({ method: 'GET', url: `/api/runs` });
    expect(statusResponse.json<CreationRun[]>()[0]?.status).toBe('completed');
    expect(statusResponse.json<CreationRun[]>()[0]?.figmaFileKey).toBe('test-file-key');
    const exportResponse = await app.inject({ method: 'GET', url: '/api/export' });
    expect(exportResponse.json<{ version: number; figmaDeliveries: FigmaDelivery[] }>()).toMatchObject({
      version: 4,
      figmaDeliveries: [expect.objectContaining({ runId: run.id, status: 'completed' })],
    });
    await app.close();
    database.close();
  });

  it('imports rights-aware knowledge, canonicalizes contexts, and preserves tombstones', async () => {
    const { app, database } = createTestApp();
    const taxonomyResponse = await app.inject({
      method: 'POST',
      url: '/api/knowledge/taxonomy',
      payload: { canonical: 'product-marketing', aliases: ['PM Site'] },
    });
    expect(taxonomyResponse.statusCode).toBe(201);

    const firstPayload = knowledgePayload('Evidence-led hero', 'https://example.com/reference-one', ['PM Site']);
    const firstResponse = await app.inject({ method: 'POST', url: '/api/knowledge', payload: firstPayload });
    expect(firstResponse.statusCode, firstResponse.body).toBe(201);
    const first = firstResponse.json<KnowledgeItem>();
    const firstFingerprint = first.metadataFingerprint;
    expect(first.contexts).toEqual(['product-marketing']);
    expect(first.lifecycle).toBe('active');

    const duplicateResponse = await app.inject({ method: 'POST', url: '/api/knowledge', payload: firstPayload });
    expect(duplicateResponse.statusCode).toBe(409);
    expect(duplicateResponse.json()).toEqual(expect.objectContaining({
      error: 'knowledge_duplicate',
      duplicateOfId: first.id,
    }));

    const invalidTraining = await app.inject({
      method: 'POST',
      url: '/api/knowledge',
      payload: {
        ...knowledgePayload('Unverified source', 'https://example.com/unverified'),
        provenance: {
          sourceType: 'url', sourceUri: 'https://example.com/unverified', license: null,
          rightsStatus: 'unverified', trainingEligible: true, capturedAt: '2026-10-06T00:00:00.000Z',
        },
      },
    });
    expect(invalidTraining.statusCode).toBe(400);

    const importedPayload = knowledgePayload('Responsive evidence', 'https://example.com/reference-two');
    const importResponse = await app.inject({
      method: 'POST',
      url: '/api/knowledge/import',
      payload: { format: 'json', items: [importedPayload, importedPayload, { title: 'invalid' }] },
    });
    expect(importResponse.statusCode).toBe(201);
    expect(importResponse.json<KnowledgeImportBatch>()).toMatchObject({
      status: 'partial', totalCount: 3, createdCount: 1, duplicateCount: 1, rejectedCount: 1,
    });
    const jsonlItem = knowledgePayload('JSONL reference', 'https://example.com/reference-jsonl');
    const jsonlResponse = await app.inject({
      method: 'POST',
      url: '/api/knowledge/import',
      headers: { 'content-type': 'application/x-ndjson' },
      payload: `${JSON.stringify(jsonlItem)}\n{invalid-json}\n`,
    });
    expect(jsonlResponse.statusCode).toBe(201);
    expect(jsonlResponse.json<KnowledgeImportBatch>()).toMatchObject({
      format: 'jsonl', status: 'partial', createdCount: 1, rejectedCount: 1,
    });

    const excludeResponse = await app.inject({
      method: 'PATCH',
      url: `/api/knowledge/${first.id}/lifecycle`,
      payload: { action: 'exclude', reason: 'Not applicable to the current dataset.' },
    });
    expect(excludeResponse.json<KnowledgeItem>().lifecycle).toBe('excluded');
    const snapshotBeforeDelete = await app.inject({ method: 'GET', url: '/api/export/dataset.jsonl' });
    expect(snapshotBeforeDelete.body).not.toContain(first.id);
    expect(snapshotBeforeDelete.body).toContain('Responsive evidence');

    const deleteResponse = await app.inject({
      method: 'PATCH',
      url: `/api/knowledge/${first.id}/lifecycle`,
      payload: { action: 'delete', reason: 'Source owner requested deletion.' },
    });
    expect(deleteResponse.json<KnowledgeItem>()).toMatchObject({
      id: first.id,
      title: '[deleted]',
      lifecycle: 'deleted',
      provenance: { sourceUri: null, rightsStatus: 'prohibited', trainingEligible: false },
    });
    expect(deleteResponse.json<KnowledgeItem>().metadataFingerprint).not.toBe(firstFingerprint);
    await app.close();
    database.close();
  });

  it('validates local images, detects exact and perceptual duplicates, and deletes asset data', async () => {
    const { app, database } = createTestApp();
    const firstResponse = await app.inject({
      method: 'POST', url: '/api/knowledge',
      payload: knowledgePayload('Reference asset one', 'https://example.com/asset-one'),
    });
    const secondResponse = await app.inject({
      method: 'POST', url: '/api/knowledge',
      payload: knowledgePayload('Reference asset two', 'https://example.com/asset-two'),
    });
    const thirdResponse = await app.inject({
      method: 'POST', url: '/api/knowledge',
      payload: knowledgePayload('Reference asset three', 'https://example.com/asset-three'),
    });
    const fourthResponse = await app.inject({
      method: 'POST', url: '/api/knowledge',
      payload: knowledgePayload('Reference asset four', 'https://example.com/asset-four'),
    });
    const first = firstResponse.json<KnowledgeItem>();
    const second = secondResponse.json<KnowledgeItem>();
    const third = thirdResponse.json<KnowledgeItem>();
    const fourth = fourthResponse.json<KnowledgeItem>();
    const image = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 32, g: 96, b: 64 } },
    }).png().toBuffer();
    const multipart = multipartImage(image);
    const firstAsset = await app.inject({
      method: 'POST', url: `/api/knowledge/${first.id}/asset`,
      headers: { 'content-type': multipart.contentType }, payload: multipart.body,
    });
    expect(firstAsset.statusCode, firstAsset.body).toBe(201);
    expect(firstAsset.json<{ duplicate: unknown }>().duplicate).toBeNull();
    const secondAsset = await app.inject({
      method: 'POST', url: `/api/knowledge/${second.id}/asset`,
      headers: { 'content-type': multipart.contentType }, payload: multipart.body,
    });
    expect(secondAsset.statusCode, secondAsset.body).toBe(201);
    expect(secondAsset.json<{ duplicate: { knowledgeId: string; kind: string } }>().duplicate).toEqual({
      knowledgeId: first.id,
      kind: 'exact-asset',
    });
    const differentBytesSameShape = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 48, g: 112, b: 80 } },
    }).png().toBuffer();
    const perceptualMultipart = multipartImage(differentBytesSameShape);
    const thirdAsset = await app.inject({
      method: 'POST', url: `/api/knowledge/${third.id}/asset`,
      headers: { 'content-type': perceptualMultipart.contentType }, payload: perceptualMultipart.body,
    });
    expect(thirdAsset.statusCode, thirdAsset.body).toBe(201);
    expect(thirdAsset.json<{ duplicate: { knowledgeId: string; kind: string } }>().duplicate).toEqual({
      knowledgeId: first.id,
      kind: 'perceptual',
    });
    const invalidMime = multipartImage(image, 'reference.jpg', 'image/jpeg');
    const invalidMimeResponse = await app.inject({
      method: 'POST', url: `/api/knowledge/${fourth.id}/asset`,
      headers: { 'content-type': invalidMime.contentType }, payload: invalidMime.body,
    });
    expect(invalidMimeResponse.statusCode).toBe(400);
    expect(invalidMimeResponse.json()).toEqual(expect.objectContaining({ error: 'reference_asset_invalid' }));
    const knowledge = (await app.inject({ method: 'GET', url: '/api/knowledge' })).json<KnowledgeItem[]>();
    expect(knowledge.find((item) => item.id === second.id)).toMatchObject({
      lifecycle: 'excluded', duplicateOfId: first.id, duplicateKind: 'exact-asset',
    });
    expect(knowledge.find((item) => item.id === third.id)).toMatchObject({
      lifecycle: 'excluded', duplicateOfId: first.id, duplicateKind: 'perceptual',
    });
    const secondAssetRecord = secondAsset.json<{ asset: { storagePath: string } }>().asset;
    expect((await app.inject({
      method: 'GET', url: `/artifacts/${secondAssetRecord.storagePath}`,
    })).statusCode).toBe(200);
    const deleteResponse = await app.inject({
      method: 'PATCH', url: `/api/knowledge/${second.id}/lifecycle`,
      payload: { action: 'delete', reason: 'Delete duplicate reference data.' },
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect((await app.inject({
      method: 'GET', url: `/artifacts/${secondAssetRecord.storagePath}`,
    })).statusCode).toBe(404);
    const assets = (await app.inject({ method: 'GET', url: '/api/knowledge/assets' })).json<Array<{ knowledgeId: string }>>();
    expect(assets.some((asset) => asset.knowledgeId === second.id)).toBe(false);
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
