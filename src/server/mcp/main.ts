import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { seedXdbRepository, XdbService } from '../application/xdb-service.js';
import { ArtifactStore } from '../artifacts/store.js';
import { getRuntimeConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { Repository } from '../db/repository.js';

import { createXdbMcpServer } from './server.js';

function findProjectRoot(start: string): string {
  let directory = start;
  while (true) {
    if (existsSync(path.join(directory, 'design.config.json'))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('Could not locate the XDB project root.');
    directory = parent;
  }
}

const projectRoot = findProjectRoot(path.dirname(fileURLToPath(import.meta.url)));
const config = getRuntimeConfig(projectRoot);
const database = openDatabase(config.databasePath);
const repository = new Repository(database);
seedXdbRepository(repository);

const service = new XdbService({
  repository,
  config,
  artifactStore: new ArtifactStore(config.artifactsPath),
});
const handle = serveStdio(() => createXdbMcpServer({ service, repository }));

async function close(): Promise<void> {
  await handle.close();
  database.close();
}

process.once('SIGINT', () => void close().finally(() => process.exit(0)));
process.once('SIGTERM', () => void close().finally(() => process.exit(0)));
