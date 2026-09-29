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

  return database;
}
