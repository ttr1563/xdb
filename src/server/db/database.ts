import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

const migrationOne = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('principle', 'pattern', 'reference', 'anti-pattern')),
    contexts_json TEXT NOT NULL,
    concepts_json TEXT NOT NULL,
    evidence TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS style_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    medium TEXT NOT NULL,
    traits_json TEXT NOT NULL,
    palette_json TEXT NOT NULL,
    composition_rules_json TEXT NOT NULL,
    forbidden_traits_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS design_requests (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    project_name TEXT NOT NULL,
    audience TEXT NOT NULL,
    objective TEXT NOT NULL,
    concepts_json TEXT NOT NULL,
    avoid_json TEXT NOT NULL,
    output_mode TEXT NOT NULL CHECK (output_mode IN ('figma', 'html', 'both')),
    intent TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'planned', 'generated', 'reviewed')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS design_plans (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES design_requests(id),
    version INTEGER NOT NULL,
    plan_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS creation_runs (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES design_plans(id),
    output_mode TEXT NOT NULL,
    figma_file_key TEXT,
    status TEXT NOT NULL CHECK (status IN ('completed', 'partial', 'blocked_external', 'failed')),
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES creation_runs(id),
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evaluations (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    evaluator_type TEXT NOT NULL CHECK (evaluator_type IN ('human', 'automatic')),
    scores_json TEXT NOT NULL,
    rationale TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'revise')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pairwise_comparisons (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES design_requests(id),
    artifact_a_id TEXT NOT NULL REFERENCES artifacts(id),
    artifact_b_id TEXT NOT NULL REFERENCES artifacts(id),
    preferred_artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    rationale TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (preferred_artifact_id IN (artifact_a_id, artifact_b_id))
  );

  CREATE TABLE IF NOT EXISTS tool_runs (
    id TEXT PRIMARY KEY,
    creation_run_id TEXT NOT NULL REFERENCES creation_runs(id),
    adapter TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    request_json TEXT NOT NULL,
    response_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_kind ON knowledge_items(kind);
  CREATE INDEX IF NOT EXISTS idx_design_plans_request ON design_plans(request_id);
  CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);
  CREATE INDEX IF NOT EXISTS idx_evaluations_artifact ON evaluations(artifact_id);
`;

const migrationTwo = `
  CREATE TABLE IF NOT EXISTS ai_runs (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES design_requests(id),
    purpose TEXT NOT NULL CHECK (purpose IN ('planning')),
    provider TEXT NOT NULL CHECK (provider IN ('local', 'anthropic')),
    model TEXT,
    status TEXT NOT NULL CHECK (status IN ('completed', 'fallback', 'failed')),
    fallback_used INTEGER NOT NULL CHECK (fallback_used IN (0, 1)),
    input_tokens INTEGER,
    output_tokens INTEGER,
    latency_ms INTEGER NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ai_runs_request ON ai_runs(request_id);
`;

const migrationThree = `
  ALTER TABLE ai_runs ADD COLUMN error_code TEXT;
  ALTER TABLE ai_runs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_ai_runs_provider_created ON ai_runs(provider, created_at);
`;

const migrationFour = `
  CREATE TABLE IF NOT EXISTS mcp_operations (
    idempotency_key TEXT PRIMARY KEY,
    tool TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    result_json TEXT,
    error TEXT,
    lease_expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_mcp_operations_updated ON mcp_operations(updated_at);
`;

const migrationFive = `
  ALTER TABLE mcp_operations ADD COLUMN owner_token TEXT;
`;

const migrationSix = `
  CREATE TABLE IF NOT EXISTS plan_families (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES design_requests(id),
    provider TEXT NOT NULL CHECK (provider IN ('local', 'anthropic')),
    strategies_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  ALTER TABLE design_plans ADD COLUMN family_id TEXT;
  ALTER TABLE design_plans ADD COLUMN variant_strategy TEXT;
  ALTER TABLE design_plans ADD COLUMN candidate_index INTEGER;
  ALTER TABLE design_plans ADD COLUMN fingerprint TEXT;

  UPDATE design_plans
  SET family_id = id,
      variant_strategy = 'baseline',
      candidate_index = 0,
      fingerprint = NULL
  WHERE family_id IS NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_design_plans_family_candidate
    ON design_plans(family_id, candidate_index);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_design_plans_family_fingerprint
    ON design_plans(family_id, fingerprint);
  CREATE INDEX IF NOT EXISTS idx_design_plans_fingerprint ON design_plans(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_plan_families_request ON plan_families(request_id);
`;

export function openDatabase(databasePath: string): Database.Database {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');

  const hasMigrations = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  const currentVersion = hasMigrations
    ? Number(
        (database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as
          | { version: number }
          | undefined)?.version ?? 0,
      )
    : 0;

  if (currentVersion < 1) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(migrationOne);
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(1, new Date().toISOString());
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  if (currentVersion < 2) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(migrationTwo);
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(2, new Date().toISOString());
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  if (currentVersion < 3) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(migrationThree);
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(3, new Date().toISOString());
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  if (currentVersion < 4) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(migrationFour);
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(4, new Date().toISOString());
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  if (currentVersion < 5) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(migrationFive);
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(5, new Date().toISOString());
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  if (currentVersion < 6) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(migrationSix);
      const legacyPlans = database.prepare(`
        SELECT id, request_id, plan_json, created_at FROM design_plans WHERE fingerprint IS NULL
      `).all() as Array<{ id: string; request_id: string; plan_json: string; created_at: string }>;
      const updatePlan = database.prepare('UPDATE design_plans SET fingerprint = ? WHERE id = ?');
      const insertFamily = database.prepare(`
        INSERT OR IGNORE INTO plan_families (id, request_id, provider, strategies_json, created_at)
        VALUES (?, ?, ?, '["baseline"]', ?)
      `);
      for (const row of legacyPlans) {
        const plan = JSON.parse(row.plan_json) as Record<string, unknown>;
        const fingerprint = createHash('sha256').update(JSON.stringify({
          designDirection: plan.designDirection,
          sections: plan.sections,
          tokens: plan.tokens,
          illustration: plan.illustration,
        })).digest('hex');
        const generation = plan.generation as { provider?: unknown } | undefined;
        const provider = generation?.provider === 'anthropic' ? 'anthropic' : 'local';
        updatePlan.run(fingerprint, row.id);
        insertFamily.run(row.id, row.request_id, provider, row.created_at);
      }
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(6, new Date().toISOString());
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  return database;
}
