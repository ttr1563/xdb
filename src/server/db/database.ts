import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { KnowledgeInput } from '../../shared/contracts.js';
import { knowledgeMetadataFingerprint, normalizeTaxonomyValue } from '../domain/knowledge-quality.js';

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

const migrationSeven = `
  CREATE TABLE IF NOT EXISTS figma_deliveries (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES creation_runs(id),
    operation_key TEXT NOT NULL,
    file_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('completed', 'partial', 'failed')),
    page_id TEXT,
    desktop_node_id TEXT,
    mobile_node_id TEXT,
    created_node_ids_json TEXT NOT NULL,
    mutated_node_ids_json TEXT NOT NULL,
    desktop_structure_json TEXT,
    mobile_structure_json TEXT,
    desktop_screenshot_captured INTEGER NOT NULL CHECK (desktop_screenshot_captured IN (0, 1)),
    mobile_screenshot_captured INTEGER NOT NULL CHECK (mobile_screenshot_captured IN (0, 1)),
    error TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (run_id, operation_key)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_figma_deliveries_completed_run
    ON figma_deliveries(run_id) WHERE status = 'completed';
  CREATE INDEX IF NOT EXISTS idx_figma_deliveries_run ON figma_deliveries(run_id, created_at);
`;

const migrationEight = `
  ALTER TABLE figma_deliveries ADD COLUMN observed_node_ids_json TEXT NOT NULL DEFAULT '[]';
`;

const migrationNine = `
  ALTER TABLE knowledge_items ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle IN ('active', 'excluded', 'deleted'));
  ALTER TABLE knowledge_items ADD COLUMN lifecycle_reason TEXT;
  ALTER TABLE knowledge_items ADD COLUMN rights_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (rights_status IN ('unverified', 'verified', 'prohibited'));
  ALTER TABLE knowledge_items ADD COLUMN metadata_fingerprint TEXT;
  ALTER TABLE knowledge_items ADD COLUMN duplicate_of_id TEXT;
  ALTER TABLE knowledge_items ADD COLUMN duplicate_kind TEXT
    CHECK (duplicate_kind IN ('metadata', 'exact-asset', 'perceptual'));
  ALTER TABLE knowledge_items ADD COLUMN import_batch_id TEXT;
  ALTER TABLE knowledge_items ADD COLUMN updated_at TEXT;
  ALTER TABLE knowledge_items ADD COLUMN deleted_at TEXT;

  CREATE TABLE knowledge_import_batches (
    id TEXT PRIMARY KEY,
    format TEXT NOT NULL CHECK (format IN ('json', 'jsonl')),
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
    total_count INTEGER NOT NULL,
    created_count INTEGER NOT NULL,
    duplicate_count INTEGER NOT NULL,
    rejected_count INTEGER NOT NULL,
    errors_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE context_taxonomy (
    id TEXT PRIMARY KEY,
    canonical TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE context_aliases (
    alias TEXT PRIMARY KEY,
    taxonomy_id TEXT NOT NULL REFERENCES context_taxonomy(id) ON DELETE CASCADE
  );

  CREATE TABLE reference_assets (
    id TEXT PRIMARY KEY,
    knowledge_id TEXT NOT NULL UNIQUE REFERENCES knowledge_items(id),
    original_name TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    byte_size INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    perceptual_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX idx_knowledge_lifecycle ON knowledge_items(lifecycle, created_at);
  CREATE INDEX idx_knowledge_fingerprint ON knowledge_items(metadata_fingerprint);
  CREATE INDEX idx_knowledge_duplicate ON knowledge_items(duplicate_of_id);
  CREATE INDEX idx_reference_assets_sha256 ON reference_assets(sha256);
  CREATE INDEX idx_reference_assets_perceptual ON reference_assets(perceptual_hash);
`;

const migrationTen = `
  CREATE TABLE request_references (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES design_requests(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('inspiration', 'competitor', 'avoid', 'existing')),
    note TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'analyzed', 'approved', 'rejected', 'unavailable')),
    analysis_json TEXT,
    decision_reason TEXT,
    knowledge_id TEXT REFERENCES knowledge_items(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (request_id, url)
  );

  CREATE INDEX idx_request_references_request ON request_references(request_id, created_at);
  CREATE INDEX idx_request_references_status ON request_references(status, created_at);
  CREATE INDEX idx_request_references_knowledge ON request_references(knowledge_id);
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

  if (currentVersion < 7) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(migrationSeven);
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(7, new Date().toISOString());
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  if (currentVersion < 8) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(migrationEight);
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(8, new Date().toISOString());
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  if (currentVersion < 9) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(migrationNine);
      const rows = database.prepare(`
        SELECT id, title, summary, kind, contexts_json, concepts_json, evidence,
               provenance_json, created_at
        FROM knowledge_items
      `).all() as Array<{
        id: string;
        title: string;
        summary: string;
        kind: string;
        contexts_json: string;
        concepts_json: string;
        evidence: string;
        provenance_json: string;
        created_at: string;
      }>;
      const updateKnowledge = database.prepare(`
        UPDATE knowledge_items
        SET contexts_json = ?, provenance_json = ?, rights_status = ?,
            metadata_fingerprint = ?, updated_at = ?
        WHERE id = ?
      `);
      const insertTaxonomy = database.prepare(
        'INSERT OR IGNORE INTO context_taxonomy (id, canonical, created_at) VALUES (?, ?, ?)',
      );
      const insertAlias = database.prepare(
        'INSERT OR IGNORE INTO context_aliases (alias, taxonomy_id) VALUES (?, ?)',
      );
      for (const row of rows) {
        const contexts = (JSON.parse(row.contexts_json) as string[]).map(normalizeTaxonomyValue);
        const provenance = JSON.parse(row.provenance_json) as KnowledgeInput['provenance'];
        const rightsStatus: 'verified' | 'unverified' = provenance.trainingEligible && provenance.sourceType === 'system'
          ? 'verified'
          : 'unverified';
        const migratedProvenance = {
          ...provenance,
          rightsStatus,
          trainingEligible: rightsStatus === 'verified' && provenance.trainingEligible,
        };
        const input: KnowledgeInput = {
          title: row.title,
          summary: row.summary,
          kind: row.kind as KnowledgeInput['kind'],
          contexts,
          concepts: JSON.parse(row.concepts_json) as string[],
          evidence: row.evidence,
          provenance: migratedProvenance,
        };
        updateKnowledge.run(
          JSON.stringify(contexts),
          JSON.stringify(migratedProvenance),
          rightsStatus,
          knowledgeMetadataFingerprint(input, contexts),
          row.created_at,
          row.id,
        );
        for (const context of contexts) {
          const taxonomyId = createHash('sha256').update(context).digest('hex').slice(0, 32);
          const id = `${taxonomyId.slice(0, 8)}-${taxonomyId.slice(8, 12)}-4${taxonomyId.slice(13, 16)}-a${taxonomyId.slice(17, 20)}-${taxonomyId.slice(20, 32)}`;
          insertTaxonomy.run(id, context, row.created_at);
          insertAlias.run(context, id);
        }
      }
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(9, new Date().toISOString());
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  if (currentVersion < 10) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(migrationTen);
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(10, new Date().toISOString());
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  return database;
}
