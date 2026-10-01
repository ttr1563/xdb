import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from './database.js';
import { Repository } from './repository.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Repository MCP operation ownership', () => {
  it('never reclaims an expired key after a domain write with an unknown outcome', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-repository-'));
    temporaryDirectories.push(directory);
    const database = openDatabase(path.join(directory, 'xdb.sqlite'));
    const repository = new Repository(database);
    const key = 'request:crash-window:1';
    const requestHash = createHash('sha256').update('{}').digest('hex');

    try {
      const claim = repository.claimMcpOperation(key, 'xdb_create_request', requestHash);
      expect(claim.state).toBe('execute');
      repository.createRequest({
        prompt: '安全な再実行境界を持つLPをデザインしてください',
        projectName: 'Crash Window',
        audience: '運用担当者',
        objective: '仕様確認',
        concepts: ['安全性'],
        avoid: [],
        outputMode: 'html',
      });
      database.prepare('UPDATE mcp_operations SET lease_expires_at = ? WHERE idempotency_key = ?')
        .run('2000-01-01T00:00:00.000Z', key);

      expect(repository.claimMcpOperation(key, 'xdb_create_request', requestHash)).toEqual({ state: 'indeterminate' });
      expect(repository.listRequests()).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it('fences renewal and terminal transitions by owner token', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-repository-'));
    temporaryDirectories.push(directory);
    const database = openDatabase(path.join(directory, 'xdb.sqlite'));
    const repository = new Repository(database);
    const key = 'evaluation:fenced:1';
    const requestHash = createHash('sha256').update('{}').digest('hex');

    try {
      const claim = repository.claimMcpOperation(key, 'xdb_record_evaluation', requestHash);
      if (claim.state !== 'execute') throw new Error('Expected a new operation claim.');
      expect(repository.renewMcpOperation(key, 'wrong-owner')).toBe(false);
      expect(() => repository.completeMcpOperation(key, 'wrong-owner', {})).toThrow('ownership was lost');
      expect(repository.renewMcpOperation(key, claim.ownerToken)).toBe(true);
      repository.completeMcpOperation(key, claim.ownerToken, { evaluationId: 'saved' });
      expect(repository.claimMcpOperation(key, 'xdb_record_evaluation', requestHash)).toEqual({
        state: 'replay',
        result: { evaluationId: 'saved' },
      });
    } finally {
      database.close();
    }
  });

  it('does not automatically retry a failed operation', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-repository-'));
    temporaryDirectories.push(directory);
    const database = openDatabase(path.join(directory, 'xdb.sqlite'));
    const repository = new Repository(database);
    const key = 'plan:failed:1';
    const requestHash = createHash('sha256').update('{}').digest('hex');

    try {
      const claim = repository.claimMcpOperation(key, 'xdb_create_plan', requestHash);
      if (claim.state !== 'execute') throw new Error('Expected a new operation claim.');
      repository.failMcpOperation(key, claim.ownerToken, 'provider failed');
      expect(repository.claimMcpOperation(key, 'xdb_create_plan', requestHash)).toEqual({ state: 'failed' });
    } finally {
      database.close();
    }
  });
});
