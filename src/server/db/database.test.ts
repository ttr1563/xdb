import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { openDatabase } from './database.js';

describe('database migrations', () => {
  it('upgrades a version 1 database through the latest AI audit schema', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-migration-'));
    const databasePath = path.join(directory, 'xdb.sqlite');
    try {
      const initial = openDatabase(databasePath);
      initial.exec('DROP TABLE ai_runs; DELETE FROM schema_migrations WHERE version >= 2;');
      initial.close();

      const upgraded = openDatabase(databasePath);
      const version = upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number };
      const table = upgraded
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_runs'")
        .get() as { name: string } | undefined;
      const columns = upgraded.prepare('PRAGMA table_info(ai_runs)').all() as Array<{ name: string }>;
      expect(version.version).toBe(3);
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
      initial.exec(`
        DROP INDEX idx_ai_runs_provider_created;
        ALTER TABLE ai_runs DROP COLUMN error_code;
        ALTER TABLE ai_runs DROP COLUMN attempt_count;
        DELETE FROM schema_migrations WHERE version = 3;
      `);
      initial.close();

      const upgraded = openDatabase(databasePath);
      const columns = upgraded.prepare('PRAGMA table_info(ai_runs)').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['error_code', 'attempt_count']));
      expect((upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version).toBe(3);
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
