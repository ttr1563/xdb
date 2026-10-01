import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('XDB MCP stdio entrypoint', () => {
  it('starts outside the project directory and serves tools over stdio', async () => {
    const projectRoot = process.cwd();
    const directory = mkdtempSync(path.join(tmpdir(), 'xdb-mcp-stdio-'));
    temporaryDirectories.push(directory);
    const transport = new StdioClientTransport({
      command: path.join(projectRoot, 'node_modules/.bin/tsx'),
      args: [path.join(projectRoot, 'src/server/mcp/main.ts')],
      cwd: directory,
      env: {
        ...getDefaultEnvironment(),
        XDB_DATABASE_PATH: path.join(directory, 'xdb.sqlite'),
        XDB_ARTIFACTS_PATH: path.join(directory, 'artifacts'),
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'xdb-stdio-test-client', version: '1.0.0' });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('xdb_create_plan');

      const result = await client.callTool({
        name: 'xdb_classify_design_input',
        arguments: { input: '医療予約サービスの信頼感があるLPをデザインして' },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ intent: 'create-design' });
    } finally {
      await client.close();
    }
  });
});
