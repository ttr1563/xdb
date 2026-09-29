import { readFileSync } from 'node:fs';
import path from 'node:path';

import { designConfigSchema, type DesignConfig } from '../shared/contracts.js';

export interface RuntimeConfig {
  host: string;
  port: number;
  databasePath: string;
  artifactsPath: string;
  figmaMcpServer: string | null;
  imageProvider: string | null;
  design: DesignConfig;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getRuntimeConfig(cwd = process.cwd()): RuntimeConfig {
  const port = Number(process.env.XDB_PORT ?? 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('XDB_PORT must be an integer between 1 and 65535.');
  }

  const design = designConfigSchema.parse(
    JSON.parse(readFileSync(path.resolve(cwd, 'design.config.json'), 'utf8')) as unknown,
  );

  return {
    host: process.env.XDB_HOST?.trim() || '127.0.0.1',
    port,
    databasePath: path.resolve(cwd, process.env.XDB_DATABASE_PATH ?? '.data/xdb.sqlite'),
    artifactsPath: path.resolve(cwd, process.env.XDB_ARTIFACTS_PATH ?? '.data/artifacts'),
    figmaMcpServer: optionalEnv('XDB_FIGMA_MCP_SERVER'),
    imageProvider: optionalEnv('XDB_IMAGE_PROVIDER'),
    design,
  };
}
