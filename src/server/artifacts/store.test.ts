import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ArtifactStore } from './store.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('ArtifactStore', () => {
  it('reads a generated artifact and rejects paths outside its root', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-artifacts-'));
    temporaryDirectories.push(directory);
    const store = new ArtifactStore(directory);
    const artifact = await store.write('run-1', 'html', '<main>XDB</main>');

    await expect(store.read(artifact.path)).resolves.toBe('<main>XDB</main>');
    await expect(store.read('../outside.txt')).rejects.toThrow('escaped the configured artifact root');
  });
});
