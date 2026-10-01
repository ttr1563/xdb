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
  KnowledgeInput,
  KnowledgeItem,
  PlanFamily,
  StyleProfile,
  StyleProfileInput,
} from '../../shared/contracts.js';

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
    createdAt: String(row.created_at),
  };
}

function toRequest(row: SqlRow): DesignRequest {
  return {
    id: String(row.id),
    prompt: String(row.prompt),
    projectName: String(row.project_name),
    audience: String(row.audience),
    objective: String(row.objective),
    concepts: parseJson<string[]>(row.concepts_json),
    avoid: parseJson<string[]>(row.avoid_json),
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

export class Repository {
  public constructor(private readonly database: Database.Database) {}

  public listKnowledge(): KnowledgeItem[] {
    return asRows(this.database.prepare('SELECT * FROM knowledge_items ORDER BY created_at DESC').all()).map((row) =>
      toKnowledge(row),
    );
  }

  public createKnowledge(input: KnowledgeInput): KnowledgeItem {
    const item: KnowledgeItem = { ...input, id: randomUUID(), createdAt: now() };
    this.database
      .prepare(`
        INSERT INTO knowledge_items (
          id, title, summary, kind, contexts_json, concepts_json, evidence, provenance_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        item.createdAt,
      );
    return item;
  }

  public listRequests(): DesignRequest[] {
    return asRows(this.database.prepare('SELECT * FROM design_requests ORDER BY created_at DESC').all()).map((row) =>
      toRequest(row),
    );
  }

  public getRequest(id: string): DesignRequest | null {
    const row = asRow(this.database.prepare('SELECT * FROM design_requests WHERE id = ?').get(id));
    return row ? toRequest(row) : null;
  }

  public createRequest(input: DesignRequestInput): DesignRequest {
    const request: DesignRequest = {
      ...input,
      id: randomUUID(),
      intent: input.prompt.includes('イラスト') ? 'create-illustration' : 'create-design',
      status: 'draft',
      createdAt: now(),
    };
    this.database
      .prepare(`
        INSERT INTO design_requests (
          id, prompt, project_name, audience, objective, concepts_json, avoid_json,
          output_mode, intent, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
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
    return request;
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
