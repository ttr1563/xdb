import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import type {
  AiRun,
  Artifact,
  ComparisonInput,
  CreationRun,
  DesignPlan,
  DesignRequest,
  DesignRequestInput,
  Evaluation,
  EvaluationInput,
  FigmaDelivery,
  FigmaDeliveryInput,
  ContextTaxonomyInput,
  ContextTaxonomyTerm,
  KnowledgeImportBatch,
  KnowledgeInput,
  KnowledgeItem,
  PlanFamily,
  ReferenceAsset,
  RequestReference,
  RequestReferenceAnalysisInput,
  RequestReferenceStatus,
  StyleProfile,
  StyleProfileInput,
} from '../../shared/contracts.js';
import { canonicalReferenceUrl } from '../../shared/contracts.js';
import { knowledgeMetadataFingerprint, normalizeTaxonomyValue } from '../domain/knowledge-quality.js';

type SqlRow = Record<string, unknown>;

export type McpOperationClaim =
  | { state: 'execute'; ownerToken: string }
  | { state: 'replay'; result: Record<string, unknown> }
  | { state: 'in_progress' }
  | { state: 'indeterminate' }
  | { state: 'failed' }
  | { state: 'conflict' };

const mcpLeaseDurationMs = 5 * 60_000;

function asRows(value: unknown[]): SqlRow[] {
  return value as SqlRow[];
}

function asRow(value: unknown): SqlRow | undefined {
  return value as SqlRow | undefined;
}

function parseJson<T>(value: unknown): T {
  if (typeof value !== 'string') {
    throw new Error('Expected a JSON string from the database.');
  }
  return JSON.parse(value) as T;
}

function now(): string {
  return new Date().toISOString();
}

function toKnowledge(row: SqlRow): KnowledgeItem {
  return {
    id: String(row.id),
    title: String(row.title),
    summary: String(row.summary),
    kind: row.kind as KnowledgeItem['kind'],
    contexts: parseJson<string[]>(row.contexts_json),
    concepts: parseJson<string[]>(row.concepts_json),
    evidence: String(row.evidence),
    provenance: parseJson<KnowledgeItem['provenance']>(row.provenance_json),
    lifecycle: row.lifecycle as KnowledgeItem['lifecycle'],
    lifecycleReason: row.lifecycle_reason === null ? null : String(row.lifecycle_reason),
    metadataFingerprint: String(row.metadata_fingerprint),
    duplicateOfId: row.duplicate_of_id === null ? null : String(row.duplicate_of_id),
    duplicateKind: row.duplicate_kind === null ? null : row.duplicate_kind as KnowledgeItem['duplicateKind'],
    importBatchId: row.import_batch_id === null ? null : String(row.import_batch_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at === null ? null : String(row.deleted_at),
  };
}

function toReferenceAsset(row: SqlRow): ReferenceAsset {
  return {
    id: String(row.id),
    knowledgeId: String(row.knowledge_id),
    originalName: String(row.original_name),
    storagePath: String(row.storage_path),
    mimeType: row.mime_type as ReferenceAsset['mimeType'],
    byteSize: Number(row.byte_size),
    width: Number(row.width),
    height: Number(row.height),
    sha256: String(row.sha256),
    perceptualHash: String(row.perceptual_hash),
    createdAt: String(row.created_at),
  };
}

function toRequestReference(row: SqlRow): RequestReference {
  return {
    id: String(row.id),
    requestId: String(row.request_id),
    url: String(row.url),
    role: row.role as RequestReference['role'],
    note: row.note === null ? null : String(row.note),
    status: row.status as RequestReferenceStatus,
    analysis: row.analysis_json === null
      ? null
      : parseJson<RequestReferenceAnalysisInput>(row.analysis_json),
    decisionReason: row.decision_reason === null ? null : String(row.decision_reason),
    knowledgeId: row.knowledge_id === null ? null : String(row.knowledge_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toRequest(row: SqlRow, references: RequestReference[] = []): DesignRequest {
  return {
    id: String(row.id),
    prompt: String(row.prompt),
    projectName: String(row.project_name),
    audience: String(row.audience),
    objective: String(row.objective),
    concepts: parseJson<string[]>(row.concepts_json),
    avoid: parseJson<string[]>(row.avoid_json),
    references,
    outputMode: row.output_mode as DesignRequest['outputMode'],
    intent: row.intent as DesignRequest['intent'],
    status: row.status as DesignRequest['status'],
    createdAt: String(row.created_at),
  };
}

function toStyleProfile(row: SqlRow): StyleProfile {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    medium: String(row.medium),
    traits: parseJson<string[]>(row.traits_json),
    palette: parseJson<string[]>(row.palette_json),
    compositionRules: parseJson<string[]>(row.composition_rules_json),
    forbiddenTraits: parseJson<string[]>(row.forbidden_traits_json),
    version: Number(row.version),
    createdAt: String(row.created_at),
  };
}

function toArtifact(row: SqlRow): Artifact {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    kind: row.kind as Artifact['kind'],
    path: String(row.path),
    sha256: String(row.sha256),
    createdAt: String(row.created_at),
  };
}

function toPlan(row: SqlRow): DesignPlan {
  const plan = parseJson<DesignPlan>(row.plan_json);
  return {
    ...plan,
    familyId: String(row.family_id),
    variantStrategy: row.variant_strategy as DesignPlan['variantStrategy'],
    candidateIndex: Number(row.candidate_index),
    fingerprint: String(row.fingerprint),
  };
}

function toFigmaDelivery(row: SqlRow): FigmaDelivery {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    operationKey: String(row.operation_key),
    fileKey: String(row.file_key),
    status: row.status as FigmaDelivery['status'],
    pageId: row.page_id === null ? null : String(row.page_id),
    desktopNodeId: row.desktop_node_id === null ? null : String(row.desktop_node_id),
    mobileNodeId: row.mobile_node_id === null ? null : String(row.mobile_node_id),
    createdNodeIds: parseJson<string[]>(row.created_node_ids_json),
    mutatedNodeIds: parseJson<string[]>(row.mutated_node_ids_json),
    observedNodeIds: parseJson<string[]>(row.observed_node_ids_json),
    desktopStructure: row.desktop_structure_json === null ? null : parseJson<FigmaDelivery['desktopStructure']>(row.desktop_structure_json),
    mobileStructure: row.mobile_structure_json === null ? null : parseJson<FigmaDelivery['mobileStructure']>(row.mobile_structure_json),
    desktopScreenshotCaptured: Boolean(row.desktop_screenshot_captured),
    mobileScreenshotCaptured: Boolean(row.mobile_screenshot_captured),
    error: row.error === null ? null : String(row.error),
    createdAt: String(row.created_at),
  };
}

export class Repository {
  public constructor(private readonly database: Database.Database) {}

  public listKnowledge(): KnowledgeItem[] {
    return asRows(this.database.prepare('SELECT * FROM knowledge_items ORDER BY created_at DESC').all()).map((row) =>
      toKnowledge(row),
    );
  }

  public listRetrievableKnowledge(): KnowledgeItem[] {
    return asRows(this.database.prepare(`
      SELECT * FROM knowledge_items
      WHERE lifecycle = 'active' AND duplicate_of_id IS NULL
      ORDER BY created_at DESC
    `).all()).map(toKnowledge);
  }

  public getKnowledge(id: string): KnowledgeItem | null {
    const row = asRow(this.database.prepare('SELECT * FROM knowledge_items WHERE id = ?').get(id));
    return row ? toKnowledge(row) : null;
  }

  public findKnowledgeByFingerprint(fingerprint: string): KnowledgeItem | null {
    const row = asRow(this.database.prepare(`
      SELECT * FROM knowledge_items
      WHERE metadata_fingerprint = ? AND lifecycle != 'deleted'
      ORDER BY created_at ASC LIMIT 1
    `).get(fingerprint));
    return row ? toKnowledge(row) : null;
  }

  public resolveContexts(contexts: string[]): string[] {
    const resolved: string[] = [];
    const timestamp = now();
    const findAlias = this.database.prepare(`
      SELECT taxonomy.canonical
      FROM context_aliases aliases
      JOIN context_taxonomy taxonomy ON taxonomy.id = aliases.taxonomy_id
      WHERE aliases.alias = ?
    `);
    const insertTaxonomy = this.database.prepare(
      'INSERT OR IGNORE INTO context_taxonomy (id, canonical, created_at) VALUES (?, ?, ?)',
    );
    const insertAlias = this.database.prepare(
      'INSERT OR IGNORE INTO context_aliases (alias, taxonomy_id) VALUES (?, ?)',
    );
    for (const context of contexts) {
      const alias = normalizeTaxonomyValue(context);
      const existing = asRow(findAlias.get(alias));
      if (existing) {
        resolved.push(String(existing.canonical));
        continue;
      }
      const id = randomUUID();
      insertTaxonomy.run(id, alias, timestamp);
      insertAlias.run(alias, id);
      resolved.push(alias);
    }
    return [...new Set(resolved)];
  }

  public createKnowledge(input: KnowledgeInput, importBatchId: string | null = null): KnowledgeItem {
    const contexts = this.resolveContexts(input.contexts);
    const timestamp = now();
    const item: KnowledgeItem = {
      ...input,
      contexts,
      id: randomUUID(),
      lifecycle: 'active',
      lifecycleReason: null,
      metadataFingerprint: knowledgeMetadataFingerprint(input, contexts),
      duplicateOfId: null,
      duplicateKind: null,
      importBatchId,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    this.database
      .prepare(`
        INSERT INTO knowledge_items (
          id, title, summary, kind, contexts_json, concepts_json, evidence, provenance_json,
          lifecycle, lifecycle_reason, rights_status, metadata_fingerprint, duplicate_of_id,
          duplicate_kind, import_batch_id, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        item.id,
        item.title,
        item.summary,
        item.kind,
        JSON.stringify(item.contexts),
        JSON.stringify(item.concepts),
        item.evidence,
        JSON.stringify(item.provenance),
        item.lifecycle,
        item.lifecycleReason,
        item.provenance.rightsStatus,
        item.metadataFingerprint,
        item.duplicateOfId,
        item.duplicateKind,
        item.importBatchId,
        item.createdAt,
        item.updatedAt,
        item.deletedAt,
      );
    return item;
  }

  public updateKnowledgeLifecycle(
    id: string,
    action: 'exclude' | 'restore' | 'delete',
    reason: string,
  ): KnowledgeItem | null {
    const existing = this.getKnowledge(id);
    if (!existing) return null;
    if (existing.lifecycle === 'deleted') return existing;
    const timestamp = now();
    if (action === 'delete') {
      this.database.transaction(() => {
        this.database.prepare('DELETE FROM reference_assets WHERE knowledge_id = ?').run(id);
        this.database.prepare(`
          UPDATE knowledge_items
          SET title = '[deleted]', summary = 'Deleted knowledge tombstone.', contexts_json = '["deleted"]',
              concepts_json = '["deleted"]', evidence = 'Deleted by lifecycle request.',
              provenance_json = ?, lifecycle = 'deleted', lifecycle_reason = ?, rights_status = 'prohibited',
              metadata_fingerprint = ?, duplicate_of_id = NULL, duplicate_kind = NULL,
              updated_at = ?, deleted_at = ?
          WHERE id = ?
        `).run(JSON.stringify({
          sourceType: 'generated', sourceUri: null, license: null, rightsStatus: 'prohibited',
          trainingEligible: false, capturedAt: timestamp,
        }), reason, knowledgeMetadataFingerprint({
          title: '[deleted]',
          summary: 'Deleted knowledge tombstone.',
          kind: existing.kind,
          contexts: ['deleted'],
          concepts: ['deleted'],
          evidence: 'Deleted by lifecycle request.',
          provenance: {
            sourceType: 'generated', sourceUri: null, license: null, rightsStatus: 'prohibited',
            trainingEligible: false, capturedAt: timestamp,
          },
        }, ['deleted']), timestamp, timestamp, id);
      })();
    } else {
      this.database.prepare(`
        UPDATE knowledge_items
        SET lifecycle = ?, lifecycle_reason = ?, updated_at = ?, deleted_at = NULL
        WHERE id = ?
      `).run(action === 'exclude' ? 'excluded' : 'active', reason, timestamp, id);
    }
    return this.getKnowledge(id);
  }

  public listContextTaxonomy(): ContextTaxonomyTerm[] {
    const rows = asRows(this.database.prepare('SELECT * FROM context_taxonomy ORDER BY canonical').all());
    const aliases = this.database.prepare('SELECT alias FROM context_aliases WHERE taxonomy_id = ? ORDER BY alias');
    return rows.map((row) => ({
      id: String(row.id),
      canonical: String(row.canonical),
      aliases: asRows(aliases.all(row.id)).map((alias) => String(alias.alias)),
      createdAt: String(row.created_at),
    }));
  }

  public createContextTaxonomy(input: ContextTaxonomyInput): ContextTaxonomyTerm {
    const canonical = normalizeTaxonomyValue(input.canonical);
    const aliases = [...new Set([canonical, ...input.aliases.map(normalizeTaxonomyValue)])];
    const timestamp = now();
    const id = randomUUID();
    this.database.transaction(() => {
      this.database.prepare('INSERT INTO context_taxonomy (id, canonical, created_at) VALUES (?, ?, ?)')
        .run(id, canonical, timestamp);
      const insert = this.database.prepare('INSERT INTO context_aliases (alias, taxonomy_id) VALUES (?, ?)');
      for (const alias of aliases) insert.run(alias, id);
    })();
    return { id, canonical, aliases: aliases.sort(), createdAt: timestamp };
  }

  public saveKnowledgeImportBatch(batch: KnowledgeImportBatch): KnowledgeImportBatch {
    this.database.prepare(`
      INSERT INTO knowledge_import_batches (
        id, format, status, total_count, created_count, duplicate_count,
        rejected_count, errors_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        created_count = excluded.created_count,
        duplicate_count = excluded.duplicate_count,
        rejected_count = excluded.rejected_count,
        errors_json = excluded.errors_json
    `).run(
      batch.id, batch.format, batch.status, batch.totalCount, batch.createdCount,
      batch.duplicateCount, batch.rejectedCount, JSON.stringify(batch.errors), batch.createdAt,
    );
    return batch;
  }

  public listKnowledgeImportBatches(): KnowledgeImportBatch[] {
    return asRows(this.database.prepare('SELECT * FROM knowledge_import_batches ORDER BY created_at DESC').all())
      .map((row) => ({
        id: String(row.id),
        format: row.format as KnowledgeImportBatch['format'],
        status: row.status as KnowledgeImportBatch['status'],
        totalCount: Number(row.total_count),
        createdCount: Number(row.created_count),
        duplicateCount: Number(row.duplicate_count),
        rejectedCount: Number(row.rejected_count),
        errors: parseJson<KnowledgeImportBatch['errors']>(row.errors_json),
        createdAt: String(row.created_at),
      }));
  }

  public listReferenceAssets(): ReferenceAsset[] {
    return asRows(this.database.prepare('SELECT * FROM reference_assets ORDER BY created_at DESC').all())
      .map(toReferenceAsset);
  }

  public getReferenceAssetForKnowledge(knowledgeId: string): ReferenceAsset | null {
    const row = asRow(this.database.prepare('SELECT * FROM reference_assets WHERE knowledge_id = ?').get(knowledgeId));
    return row ? toReferenceAsset(row) : null;
  }

  public createReferenceAsset(asset: ReferenceAsset, duplicate: {
    knowledgeId: string;
    kind: KnowledgeItem['duplicateKind'];
  } | null): ReferenceAsset {
    return this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO reference_assets (
          id, knowledge_id, original_name, storage_path, mime_type, byte_size,
          width, height, sha256, perceptual_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        asset.id, asset.knowledgeId, asset.originalName, asset.storagePath, asset.mimeType,
        asset.byteSize, asset.width, asset.height, asset.sha256, asset.perceptualHash, asset.createdAt,
      );
      if (duplicate) {
        this.database.prepare(`
          UPDATE knowledge_items
          SET lifecycle = 'excluded', lifecycle_reason = 'Duplicate reference asset.',
              duplicate_of_id = ?, duplicate_kind = ?, updated_at = ?
          WHERE id = ?
        `).run(duplicate.knowledgeId, duplicate.kind, asset.createdAt, asset.knowledgeId);
      }
      return asset;
    })();
  }

  public listTrainingKnowledge(): KnowledgeItem[] {
    return asRows(this.database.prepare(`
      SELECT * FROM knowledge_items
      WHERE lifecycle = 'active' AND duplicate_of_id IS NULL
        AND rights_status = 'verified'
        AND json_extract(provenance_json, '$.trainingEligible') = 1
      ORDER BY id
    `).all()).map(toKnowledge);
  }

  public listRequests(): DesignRequest[] {
    return asRows(this.database.prepare('SELECT * FROM design_requests ORDER BY created_at DESC').all()).map((row) =>
      toRequest(row, this.listRequestReferences(String(row.id))),
    );
  }

  public getRequest(id: string): DesignRequest | null {
    const row = asRow(this.database.prepare('SELECT * FROM design_requests WHERE id = ?').get(id));
    return row ? toRequest(row, this.listRequestReferences(id)) : null;
  }

  public createRequest(input: DesignRequestInput): DesignRequest {
    const references = (input.references ?? []).map((reference) => ({
      ...reference,
      url: canonicalReferenceUrl(reference.url),
    }));
    if (new Set(references.map((reference) => reference.url)).size !== references.length) {
      throw new Error('Duplicate request reference URL.');
    }
    const request: DesignRequest = {
      prompt: input.prompt,
      projectName: input.projectName,
      audience: input.audience,
      objective: input.objective,
      concepts: input.concepts,
      avoid: input.avoid,
      outputMode: input.outputMode,
      references: [],
      id: randomUUID(),
      intent: input.prompt.includes('イラスト') ? 'create-illustration' : 'create-design',
      status: 'draft',
      createdAt: now(),
    };
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO design_requests (
          id, prompt, project_name, audience, objective, concepts_json, avoid_json,
          output_mode, intent, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        request.id,
        request.prompt,
        request.projectName,
        request.audience,
        request.objective,
        JSON.stringify(request.concepts),
        JSON.stringify(request.avoid),
        request.outputMode,
        request.intent,
        request.status,
        request.createdAt,
      );
      const insertReference = this.database.prepare(`
        INSERT INTO request_references (
          id, request_id, url, role, note, status, analysis_json, decision_reason,
          knowledge_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?)
      `);
      request.references = references.map((reference) => {
        const item: RequestReference = {
          id: randomUUID(),
          requestId: request.id,
          ...reference,
          status: 'pending',
          analysis: null,
          decisionReason: null,
          knowledgeId: null,
          createdAt: request.createdAt,
          updatedAt: request.createdAt,
        };
        insertReference.run(
          item.id, item.requestId, item.url, item.role, item.note, item.createdAt, item.updatedAt,
        );
        return item;
      });
    })();
    return request;
  }

  public listRequestReferences(requestId?: string): RequestReference[] {
    const rows = requestId
      ? this.database.prepare('SELECT * FROM request_references WHERE request_id = ? ORDER BY created_at').all(requestId)
      : this.database.prepare('SELECT * FROM request_references ORDER BY created_at DESC').all();
    return asRows(rows).map(toRequestReference);
  }

  public getRequestReference(id: string): RequestReference | null {
    const row = asRow(this.database.prepare('SELECT * FROM request_references WHERE id = ?').get(id));
    return row ? toRequestReference(row) : null;
  }

  public recordRequestReferenceAnalysis(
    id: string,
    analysis: RequestReferenceAnalysisInput,
  ): RequestReference | null {
    const timestamp = now();
    const result = this.database.prepare(`
      UPDATE request_references
      SET status = 'analyzed', analysis_json = ?, decision_reason = NULL, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'analyzed')
    `).run(JSON.stringify(analysis), timestamp, id);
    return result.changes === 0 ? null : this.getRequestReference(id);
  }

  public reviewRequestReference(
    id: string,
    status: Extract<RequestReferenceStatus, 'approved' | 'rejected' | 'unavailable'>,
    reason: string,
    knowledgeId: string | null,
  ): RequestReference | null {
    const timestamp = now();
    const result = this.database.prepare(`
      UPDATE request_references
      SET status = ?, decision_reason = ?, knowledge_id = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'analyzed')
    `).run(status, reason, knowledgeId, timestamp, id);
    return result.changes === 0 ? null : this.getRequestReference(id);
  }

  public approveRequestReference(
    id: string,
    reason: string,
    knowledgeInput: KnowledgeInput,
  ): RequestReference | null {
    return this.database.transaction(() => {
      const reference = this.getRequestReference(id);
      if (reference?.status !== 'analyzed') return null;
      const contexts = this.resolveContexts(knowledgeInput.contexts);
      const normalizedInput = { ...knowledgeInput, contexts };
      const fingerprint = knowledgeMetadataFingerprint(normalizedInput, contexts);
      const knowledge = this.findKnowledgeByFingerprint(fingerprint)
        ?? this.createKnowledge(normalizedInput);
      return this.reviewRequestReference(id, 'approved', reason, knowledge.id);
    })();
  }

  public setRequestStatus(id: string, status: DesignRequest['status']): void {
    this.database.prepare('UPDATE design_requests SET status = ? WHERE id = ?').run(status, id);
  }

  public savePlan(plan: DesignPlan): DesignPlan {
    this.database
      .prepare(`
        INSERT INTO design_plans (
          id, request_id, version, plan_json, created_at,
          family_id, variant_strategy, candidate_index, fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        plan.id,
        plan.requestId,
        plan.version,
        JSON.stringify(plan),
        plan.createdAt,
        plan.familyId,
        plan.variantStrategy,
        plan.candidateIndex,
        plan.fingerprint,
      );
    this.setRequestStatus(plan.requestId, 'planned');
    return plan;
  }

  public savePlanFamily(family: PlanFamily, plans: DesignPlan[]): { family: PlanFamily; plans: DesignPlan[] } {
    return this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO plan_families (id, request_id, provider, strategies_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(family.id, family.requestId, family.provider, JSON.stringify(family.strategies), family.createdAt);
      for (const plan of plans) this.savePlan(plan);
      return { family, plans };
    })();
  }

  public listPlanFamilies(): PlanFamily[] {
    return asRows(this.database.prepare('SELECT * FROM plan_families ORDER BY created_at DESC').all()).map((row) => ({
      id: String(row.id),
      requestId: String(row.request_id),
      provider: row.provider as PlanFamily['provider'],
      strategies: parseJson<PlanFamily['strategies']>(row.strategies_json),
      createdAt: String(row.created_at),
    }));
  }

  public createAiRun(input: Omit<AiRun, 'id' | 'createdAt'>): AiRun {
    const run: AiRun = { ...input, id: randomUUID(), createdAt: now() };
    this.database
      .prepare(`
        INSERT INTO ai_runs (
          id, request_id, purpose, provider, model, status, fallback_used,
          input_tokens, output_tokens, latency_ms, error_code, attempt_count, error, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.id,
        run.requestId,
        run.purpose,
        run.provider,
        run.model,
        run.status,
        run.fallbackUsed ? 1 : 0,
        run.inputTokens,
        run.outputTokens,
        run.latencyMs,
        run.errorCode,
        run.attemptCount,
        run.error,
        run.createdAt,
      );
    return run;
  }

  public listAiRuns(): AiRun[] {
    return asRows(this.database.prepare('SELECT * FROM ai_runs ORDER BY created_at DESC').all()).map((row) => ({
      id: String(row.id),
      requestId: String(row.request_id),
      purpose: 'planning',
      provider: row.provider as AiRun['provider'],
      model: row.model === null ? null : String(row.model),
      status: row.status as AiRun['status'],
      fallbackUsed: Boolean(row.fallback_used),
      inputTokens: row.input_tokens === null ? null : Number(row.input_tokens),
      outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
      latencyMs: Number(row.latency_ms),
      attemptCount: Number(row.attempt_count),
      errorCode: row.error_code === null ? null : row.error_code as AiRun['errorCode'],
      error: row.error === null ? null : String(row.error),
      createdAt: String(row.created_at),
    }));
  }

  public sumAnthropicTokensSince(createdAt: string): number {
    const row = this.database
      .prepare(`
        SELECT COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS tokens
        FROM ai_runs
        WHERE provider = 'anthropic' AND created_at >= ?
      `)
      .get(createdAt) as { tokens: number } | undefined;
    return Number(row?.tokens ?? 0);
  }

  public listPlans(): DesignPlan[] {
    return asRows(this.database.prepare('SELECT * FROM design_plans ORDER BY created_at DESC').all()).map(toPlan);
  }

  public getPlan(id: string): DesignPlan | null {
    const row = asRow(this.database.prepare('SELECT * FROM design_plans WHERE id = ?').get(id));
    return row ? toPlan(row) : null;
  }

  public listStyleProfiles(): StyleProfile[] {
    return asRows(this.database.prepare('SELECT * FROM style_profiles ORDER BY created_at DESC').all()).map((row) =>
      toStyleProfile(row),
    );
  }

  public createStyleProfile(input: StyleProfileInput): StyleProfile {
    const profile: StyleProfile = { ...input, id: randomUUID(), version: 1, createdAt: now() };
    this.database
      .prepare(`
        INSERT INTO style_profiles (
          id, name, description, medium, traits_json, palette_json,
          composition_rules_json, forbidden_traits_json, version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        profile.id,
        profile.name,
        profile.description,
        profile.medium,
        JSON.stringify(profile.traits),
        JSON.stringify(profile.palette),
        JSON.stringify(profile.compositionRules),
        JSON.stringify(profile.forbiddenTraits),
        profile.version,
        profile.createdAt,
      );
    return profile;
  }

  public saveCreationRun(run: Omit<CreationRun, 'artifacts'>): void {
    this.database
      .prepare(`
        INSERT INTO creation_runs (
          id, plan_id, output_mode, figma_file_key, status, summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(run.id, run.planId, run.outputMode, run.figmaFileKey, run.status, run.summary, run.createdAt);
  }

  public saveArtifact(artifact: Artifact): Artifact {
    this.database
      .prepare('INSERT INTO artifacts (id, run_id, kind, path, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(artifact.id, artifact.runId, artifact.kind, artifact.path, artifact.sha256, artifact.createdAt);
    return artifact;
  }

  public listRuns(): CreationRun[] {
    const runs = asRows(this.database.prepare('SELECT * FROM creation_runs ORDER BY created_at DESC').all());
    const artifactQuery = this.database.prepare('SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at');
    return runs.map((row) => ({
      id: String(row.id),
      planId: String(row.plan_id),
      outputMode: row.output_mode as CreationRun['outputMode'],
      figmaFileKey: row.figma_file_key === null ? null : String(row.figma_file_key),
      status: row.status as CreationRun['status'],
      summary: String(row.summary),
      artifacts: asRows(artifactQuery.all(String(row.id))).map((artifactRow) => toArtifact(artifactRow)),
      createdAt: String(row.created_at),
    }));
  }

  public getRun(id: string): CreationRun | null {
    const row = asRow(this.database.prepare('SELECT * FROM creation_runs WHERE id = ?').get(id));
    if (!row) return null;
    const artifacts = asRows(
      this.database.prepare('SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at').all(id),
    ).map((artifactRow) => toArtifact(artifactRow));
    return {
      id: String(row.id),
      planId: String(row.plan_id),
      outputMode: row.output_mode as CreationRun['outputMode'],
      figmaFileKey: row.figma_file_key === null ? null : String(row.figma_file_key),
      status: row.status as CreationRun['status'],
      summary: String(row.summary),
      artifacts,
      createdAt: String(row.created_at),
    };
  }

  public getArtifact(id: string): Artifact | null {
    const row = asRow(this.database.prepare('SELECT * FROM artifacts WHERE id = ?').get(id));
    return row ? toArtifact(row) : null;
  }

  public listFigmaDeliveries(): FigmaDelivery[] {
    return asRows(this.database.prepare('SELECT * FROM figma_deliveries ORDER BY created_at DESC').all()).map(toFigmaDelivery);
  }

  public getFigmaDelivery(runId: string, operationKey: string): FigmaDelivery | null {
    const row = asRow(this.database.prepare(
      'SELECT * FROM figma_deliveries WHERE run_id = ? AND operation_key = ?',
    ).get(runId, operationKey));
    return row ? toFigmaDelivery(row) : null;
  }

  public getCompletedFigmaDelivery(runId: string): FigmaDelivery | null {
    const row = asRow(this.database.prepare(
      "SELECT * FROM figma_deliveries WHERE run_id = ? AND status = 'completed' LIMIT 1",
    ).get(runId));
    return row ? toFigmaDelivery(row) : null;
  }

  public createFigmaDelivery(input: FigmaDeliveryInput): FigmaDelivery {
    const delivery: FigmaDelivery = { ...input, id: randomUUID(), createdAt: now() };
    return this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO figma_deliveries (
          id, run_id, operation_key, file_key, status, page_id, desktop_node_id, mobile_node_id,
          created_node_ids_json, mutated_node_ids_json, observed_node_ids_json,
          desktop_structure_json, mobile_structure_json,
          desktop_screenshot_captured, mobile_screenshot_captured, error, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        delivery.id,
        delivery.runId,
        delivery.operationKey,
        delivery.fileKey,
        delivery.status,
        delivery.pageId,
        delivery.desktopNodeId,
        delivery.mobileNodeId,
        JSON.stringify(delivery.createdNodeIds),
        JSON.stringify(delivery.mutatedNodeIds),
        JSON.stringify(delivery.observedNodeIds),
        delivery.desktopStructure === null ? null : JSON.stringify(delivery.desktopStructure),
        delivery.mobileStructure === null ? null : JSON.stringify(delivery.mobileStructure),
        delivery.desktopScreenshotCaptured ? 1 : 0,
        delivery.mobileScreenshotCaptured ? 1 : 0,
        delivery.error,
        delivery.createdAt,
      );
      const run = asRow(this.database.prepare('SELECT output_mode FROM creation_runs WHERE id = ?').get(input.runId));
      if (!run) throw new Error('Creation Run disappeared while recording Figma delivery.');
      const hasHtml = run.output_mode === 'both';
      const runStatus = input.status === 'completed' ? 'completed' : hasHtml ? 'partial' : input.status;
      const summary = input.status === 'completed'
        ? '要求された出力とFigma deliveryの検証が完了しました。'
        : hasHtml
          ? `HTMLは生成済みですが、Figma deliveryは${input.status}です。`
          : `Figma deliveryは${input.status}です。`;
      this.database.prepare(`
        UPDATE creation_runs
        SET figma_file_key = COALESCE(figma_file_key, ?), status = ?, summary = ?
        WHERE id = ?
      `).run(input.fileKey, runStatus, summary, input.runId);
      return delivery;
    })();
  }

  public claimMcpOperation(idempotencyKey: string, tool: string, requestHash: string): McpOperationClaim {
    return this.database.transaction((): McpOperationClaim => {
      const timestamp = now();
      const leaseExpiresAt = new Date(Date.now() + mcpLeaseDurationMs).toISOString();
      const row = asRow(this.database.prepare('SELECT * FROM mcp_operations WHERE idempotency_key = ?').get(idempotencyKey));
      if (!row) {
        const ownerToken = randomUUID();
        this.database.prepare(`
          INSERT INTO mcp_operations (
            idempotency_key, tool, request_hash, status, result_json, error,
            lease_expires_at, created_at, updated_at, owner_token
          ) VALUES (?, ?, ?, 'running', NULL, NULL, ?, ?, ?, ?)
        `).run(idempotencyKey, tool, requestHash, leaseExpiresAt, timestamp, timestamp, ownerToken);
        return { state: 'execute', ownerToken };
      }
      if (row.tool !== tool || row.request_hash !== requestHash) return { state: 'conflict' };
      if (row.status === 'completed') {
        return { state: 'replay', result: parseJson<Record<string, unknown>>(row.result_json) };
      }
      if (row.status === 'failed') return { state: 'failed' };
      if (row.status === 'running' && String(row.lease_expires_at) > timestamp) return { state: 'in_progress' };
      return { state: 'indeterminate' };
    })();
  }

  public renewMcpOperation(idempotencyKey: string, ownerToken: string): boolean {
    const timestamp = now();
    const leaseExpiresAt = new Date(Date.now() + mcpLeaseDurationMs).toISOString();
    const update = this.database.prepare(`
      UPDATE mcp_operations
      SET lease_expires_at = ?, updated_at = ?
      WHERE idempotency_key = ? AND owner_token = ? AND status = 'running'
    `).run(leaseExpiresAt, timestamp, idempotencyKey, ownerToken);
    return update.changes === 1;
  }

  public completeMcpOperation(idempotencyKey: string, ownerToken: string, result: Record<string, unknown>): void {
    const update = this.database.prepare(`
      UPDATE mcp_operations
      SET status = 'completed', result_json = ?, error = NULL, updated_at = ?
      WHERE idempotency_key = ? AND owner_token = ? AND status = 'running'
    `).run(JSON.stringify(result), now(), idempotencyKey, ownerToken);
    if (update.changes !== 1) throw new Error('MCP operation ownership was lost before completion.');
  }

  public failMcpOperation(idempotencyKey: string, ownerToken: string, error: string): void {
    const update = this.database.prepare(`
      UPDATE mcp_operations
      SET status = 'failed', error = ?, updated_at = ?
      WHERE idempotency_key = ? AND owner_token = ? AND status = 'running'
    `).run(error.slice(0, 1_000), now(), idempotencyKey, ownerToken);
    if (update.changes !== 1) throw new Error('MCP operation ownership was lost before failure could be recorded.');
  }

  public createEvaluation(input: EvaluationInput): Evaluation {
    const evaluation: Evaluation = { ...input, id: randomUUID(), createdAt: now() };
    this.database
      .prepare(`
        INSERT INTO evaluations (
          id, artifact_id, evaluator_type, scores_json, rationale, decision, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        evaluation.id,
        evaluation.artifactId,
        evaluation.evaluatorType,
        JSON.stringify(evaluation.scores),
        evaluation.rationale,
        evaluation.decision,
        evaluation.createdAt,
      );
    return evaluation;
  }

  public listEvaluations(): Evaluation[] {
    return asRows(this.database.prepare('SELECT * FROM evaluations ORDER BY created_at DESC').all()).map((row) => ({
        id: String(row.id),
        artifactId: String(row.artifact_id),
        evaluatorType: row.evaluator_type as Evaluation['evaluatorType'],
        scores: parseJson<Evaluation['scores']>(row.scores_json),
        rationale: String(row.rationale),
        decision: row.decision as Evaluation['decision'],
        createdAt: String(row.created_at),
    }));
  }

  public listComparisons(): Array<{ id: string; createdAt: string } & ComparisonInput> {
    return asRows(this.database.prepare('SELECT * FROM pairwise_comparisons ORDER BY created_at DESC').all()).map((row) => ({
        id: String(row.id),
        requestId: String(row.request_id),
        artifactAId: String(row.artifact_a_id),
        artifactBId: String(row.artifact_b_id),
        preferredArtifactId: String(row.preferred_artifact_id),
        rationale: String(row.rationale),
        createdAt: String(row.created_at),
    }));
  }

  public createComparison(input: ComparisonInput): { id: string; createdAt: string } & ComparisonInput {
    const comparison = { ...input, id: randomUUID(), createdAt: now() };
    return this.database.transaction(() => {
      this.database
        .prepare(`
          INSERT INTO pairwise_comparisons (
            id, request_id, artifact_a_id, artifact_b_id, preferred_artifact_id, rationale, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          comparison.id,
          comparison.requestId,
          comparison.artifactAId,
          comparison.artifactBId,
          comparison.preferredArtifactId,
          comparison.rationale,
          comparison.createdAt,
        );
      this.setRequestStatus(input.requestId, 'reviewed');
      return comparison;
    })();
  }

  public count(table: 'design_requests' | 'knowledge_items' | 'design_plans' | 'creation_runs' | 'evaluations'): number {
    const result = asRow(this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get());
    return Number(result?.count ?? 0);
  }

  public countApprovedArtifacts(): number {
    const result = asRow(
      this.database
        .prepare(
          "SELECT COUNT(DISTINCT artifact_id) AS count FROM evaluations WHERE decision = 'approved' AND evaluator_type = 'human'",
        )
        .get(),
    );
    return Number(result?.count ?? 0);
  }
}
