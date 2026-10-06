import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { openDatabase } from './database.js';

function removeResearchSchema(database: ReturnType<typeof openDatabase>): void {
  database.exec(`
    DROP TABLE reference_assets;
    DROP TABLE context_aliases;
    DROP TABLE context_taxonomy;
    DROP TABLE knowledge_import_batches;
    DROP INDEX idx_knowledge_lifecycle;
    DROP INDEX idx_knowledge_fingerprint;
    DROP INDEX idx_knowledge_duplicate;
    ALTER TABLE knowledge_items DROP COLUMN lifecycle;
    ALTER TABLE knowledge_items DROP COLUMN lifecycle_reason;
    ALTER TABLE knowledge_items DROP COLUMN rights_status;
    ALTER TABLE knowledge_items DROP COLUMN metadata_fingerprint;
    ALTER TABLE knowledge_items DROP COLUMN duplicate_of_id;
    ALTER TABLE knowledge_items DROP COLUMN duplicate_kind;
    ALTER TABLE knowledge_items DROP COLUMN import_batch_id;
    ALTER TABLE knowledge_items DROP COLUMN updated_at;
    ALTER TABLE knowledge_items DROP COLUMN deleted_at;
    DELETE FROM schema_migrations WHERE version = 9;
  `);
}

function removeCandidateSchema(database: ReturnType<typeof openDatabase>): void {
  removeResearchSchema(database);
  database.exec(`
    DROP TABLE figma_deliveries;
    DROP INDEX idx_design_plans_family_candidate;
    DROP INDEX idx_design_plans_family_fingerprint;
    DROP INDEX idx_design_plans_fingerprint;
    DROP INDEX idx_plan_families_request;
    DROP TABLE plan_families;
    ALTER TABLE design_plans DROP COLUMN family_id;
    ALTER TABLE design_plans DROP COLUMN variant_strategy;
    ALTER TABLE design_plans DROP COLUMN candidate_index;
    ALTER TABLE design_plans DROP COLUMN fingerprint;
    DELETE FROM schema_migrations WHERE version >= 6;
  `);
}

describe('database migrations', () => {
  it('upgrades a version 1 database through the latest schema', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-migration-'));
    const databasePath = path.join(directory, 'xdb.sqlite');
    try {
      const initial = openDatabase(databasePath);
      removeCandidateSchema(initial);
      initial.exec('DROP TABLE ai_runs; DROP TABLE mcp_operations; DELETE FROM schema_migrations WHERE version >= 2;');
      initial.close();

      const upgraded = openDatabase(databasePath);
      const version = upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number };
      const table = upgraded
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_runs'")
        .get() as { name: string } | undefined;
      const columns = upgraded.prepare('PRAGMA table_info(ai_runs)').all() as Array<{ name: string }>;
      expect(version.version).toBe(9);
      expect(table?.name).toBe('ai_runs');
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['error_code', 'attempt_count']));
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('upgrades a version 2 AI audit table without losing existing runs', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-migration-'));
    const databasePath = path.join(directory, 'xdb.sqlite');
    try {
      const initial = openDatabase(databasePath);
      removeCandidateSchema(initial);
      initial.exec(`
        DROP INDEX idx_ai_runs_provider_created;
        ALTER TABLE ai_runs DROP COLUMN error_code;
        ALTER TABLE ai_runs DROP COLUMN attempt_count;
        DROP TABLE mcp_operations;
        DELETE FROM schema_migrations WHERE version >= 3;
      `);
      initial.close();

      const upgraded = openDatabase(databasePath);
      const columns = upgraded.prepare('PRAGMA table_info(ai_runs)').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['error_code', 'attempt_count']));
      expect((upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version).toBe(9);
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('upgrades a version 3 database with MCP idempotency storage', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-migration-'));
    const databasePath = path.join(directory, 'xdb.sqlite');
    try {
      const initial = openDatabase(databasePath);
      removeCandidateSchema(initial);
      initial.exec('DROP TABLE mcp_operations; DELETE FROM schema_migrations WHERE version >= 4;');
      initial.close();

      const upgraded = openDatabase(databasePath);
      const table = upgraded
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mcp_operations'")
        .get() as { name: string } | undefined;
      expect(table?.name).toBe('mcp_operations');
      const columns = upgraded.prepare('PRAGMA table_info(mcp_operations)').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain('owner_token');
      expect((upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version).toBe(9);
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('adds operation ownership fencing to a version 4 database', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-migration-'));
    const databasePath = path.join(directory, 'xdb.sqlite');
    try {
      const initial = openDatabase(databasePath);
      removeCandidateSchema(initial);
      initial.exec('ALTER TABLE mcp_operations DROP COLUMN owner_token; DELETE FROM schema_migrations WHERE version = 5;');
      initial.close();

      const upgraded = openDatabase(databasePath);
      const columns = upgraded.prepare('PRAGMA table_info(mcp_operations)').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain('owner_token');
      expect((upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version).toBe(9);
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('adds plan families and candidate metadata to a version 5 database', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-migration-'));
    const databasePath = path.join(directory, 'xdb.sqlite');
    try {
      const initial = openDatabase(databasePath);
      removeCandidateSchema(initial);
      const requestId = randomUUID();
      const planId = randomUUID();
      const createdAt = '2026-10-01T00:00:00.000Z';
      initial.prepare(`
        INSERT INTO design_requests (
          id, prompt, project_name, audience, objective, concepts_json, avoid_json,
          output_mode, intent, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        requestId,
        '移行対象のWebデザインを作成してください',
        'Legacy Plan',
        '運用担当者',
        '移行確認',
        '["安全性"]',
        '[]',
        'html',
        'create-design',
        'planned',
        createdAt,
      );
      initial.prepare(`
        INSERT INTO design_plans (id, request_id, version, plan_json, created_at)
        VALUES (?, ?, 1, ?, ?)
      `).run(planId, requestId, JSON.stringify({
        rationale: 'legacy rationale',
        designDirection: { primaryConcept: '安全性' },
        sections: [],
        tokens: [],
        illustration: null,
        knowledgeIds: [],
        generation: { provider: 'anthropic', model: 'legacy-model', fallbackUsed: false },
      }), createdAt);
      initial.close();

      const upgraded = openDatabase(databasePath);
      const columns = upgraded.prepare('PRAGMA table_info(design_plans)').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(['family_id', 'variant_strategy', 'candidate_index', 'fingerprint']),
      );
      const migrated = upgraded.prepare(`
        SELECT p.family_id, p.variant_strategy, p.candidate_index, p.fingerprint, f.provider
        FROM design_plans p JOIN plan_families f ON f.id = p.family_id WHERE p.id = ?
      `).get(planId) as Record<string, unknown>;
      expect(migrated).toMatchObject({
        family_id: planId,
        variant_strategy: 'baseline',
        candidate_index: 0,
        provider: 'anthropic',
      });
      expect(String(migrated.fingerprint)).toHaveLength(64);
      expect((upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version).toBe(9);
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('adds Figma delivery evidence storage to a version 6 database', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-migration-'));
    const databasePath = path.join(directory, 'xdb.sqlite');
    try {
      const initial = openDatabase(databasePath);
      removeResearchSchema(initial);
      initial.exec('DROP TABLE figma_deliveries; DELETE FROM schema_migrations WHERE version >= 7;');
      initial.close();

      const upgraded = openDatabase(databasePath);
      const table = upgraded.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'figma_deliveries'",
      ).get() as { name: string } | undefined;
      expect(table?.name).toBe('figma_deliveries');
      expect((upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version).toBe(9);
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('adds observed Figma node evidence to a version 7 database', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-migration-'));
    const databasePath = path.join(directory, 'xdb.sqlite');
    try {
      const initial = openDatabase(databasePath);
      removeResearchSchema(initial);
      initial.exec('ALTER TABLE figma_deliveries DROP COLUMN observed_node_ids_json; DELETE FROM schema_migrations WHERE version = 8;');
      initial.close();

      const upgraded = openDatabase(databasePath);
      const columns = upgraded.prepare('PRAGMA table_info(figma_deliveries)').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain('observed_node_ids_json');
      expect((upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version).toBe(9);
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('adds knowledge quality storage and migrates provenance in a version 8 database', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-migration-'));
    const databasePath = path.join(directory, 'xdb.sqlite');
    try {
      const initial = openDatabase(databasePath);
      removeResearchSchema(initial);
      initial.prepare(`
        INSERT INTO knowledge_items (
          id, title, summary, kind, contexts_json, concepts_json, evidence, provenance_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        'Legacy knowledge',
        'Legacy knowledge summary.',
        'pattern',
        '["Landing Page"]',
        '["clarity"]',
        'Legacy evidence.',
        JSON.stringify({
          sourceType: 'system', sourceUri: null, license: null,
          trainingEligible: true, capturedAt: '2026-10-01T00:00:00.000Z',
        }),
        '2026-10-01T00:00:00.000Z',
      );
      initial.prepare(`
        INSERT INTO knowledge_items (
          id, title, summary, kind, contexts_json, concepts_json, evidence, provenance_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        'Legacy human knowledge',
        'Legacy human knowledge summary.',
        'reference',
        '["Landing Page"]',
        '["clarity"]',
        'Legacy human evidence.',
        JSON.stringify({
          sourceType: 'human', sourceUri: null, license: null,
          trainingEligible: true, capturedAt: '2026-10-01T00:00:00.000Z',
        }),
        '2026-10-01T00:00:00.000Z',
      );
      initial.close();

      const upgraded = openDatabase(databasePath);
      const columns = upgraded.prepare('PRAGMA table_info(knowledge_items)').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        'lifecycle', 'rights_status', 'metadata_fingerprint', 'duplicate_of_id', 'updated_at',
      ]));
      const row = upgraded.prepare('SELECT provenance_json, metadata_fingerprint FROM knowledge_items LIMIT 1')
        .get() as { provenance_json: string; metadata_fingerprint: string };
      expect(JSON.parse(row.provenance_json)).toEqual(expect.objectContaining({ rightsStatus: 'verified' }));
      expect(row.metadata_fingerprint).toHaveLength(64);
      const humanRow = upgraded.prepare("SELECT provenance_json FROM knowledge_items WHERE title = 'Legacy human knowledge'")
        .get() as { provenance_json: string };
      expect(JSON.parse(humanRow.provenance_json)).toEqual(expect.objectContaining({
        rightsStatus: 'unverified', trainingEligible: false,
      }));
      expect((upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version).toBe(9);
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
