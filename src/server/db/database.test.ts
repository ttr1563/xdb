import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { openDatabase } from './database.js';

describe('database migrations', () => {
  it('upgrades a version 1 database with the AI audit table', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-migration-'));
    const databasePath = path.join(directory, 'xdb.sqlite');
    try {
      const initial = openDatabase(databasePath);
      initial.exec('DROP TABLE ai_runs; DELETE FROM schema_migrations WHERE version = 2;');
      initial.close();

      const upgraded = openDatabase(databasePath);
      const version = upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number };
      const table = upgraded
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_runs'")
        .get() as { name: string } | undefined;
      expect(version.version).toBe(2);
      expect(table?.name).toBe('ai_runs');
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
