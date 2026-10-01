import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Artifact } from '../../shared/contracts.js';

const extensionByKind: Record<Artifact['kind'], string> = {
  html: 'html',
  'figma-plan': 'json',
  'figma-script': 'js',
  'illustration-spec': 'json',
  report: 'json',
};

export class ArtifactStore {
  public constructor(private readonly root: string) {}

  public async write(runId: string, kind: Artifact['kind'], content: string): Promise<Artifact> {
    const directory = path.join(this.root, runId);
    await mkdir(directory, { recursive: true });
    const filename = `${kind}.${extensionByKind[kind]}`;
    const absolutePath = path.join(directory, filename);
    await writeFile(absolutePath, content, 'utf8');
    return {
      id: randomUUID(),
      runId,
      kind,
      path: `${runId}/${filename}`,
      sha256: createHash('sha256').update(content).digest('hex'),
      createdAt: new Date().toISOString(),
    };
  }

  public async read(relativePath: string): Promise<string> {
    const root = path.resolve(this.root);
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) {
      throw new Error('Artifact path escaped the configured artifact root.');
    }
    return readFile(absolutePath, 'utf8');
  }
}
