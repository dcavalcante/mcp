/**
 * stdio: SDK clients of both eras spawn the compiled fixture app (tests/fixtures/stdio, a standalone application
 * context serving McpStdioServer) and talk to it over its stdin and stdout, through a guard and an interceptor.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { text } from './support/clients.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Compiled by tests/support/global-setup.ts. */
const main = join(root, 'tests/.tmp/stdio/tests/fixtures/stdio/main.js');

function spawnClient(era: 'modern' | 'legacy', env: Record<string, string> = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [main],
    env: { ...(process.env as Record<string, string>), ...env },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => (stderr += String(chunk)));
  const errors: Error[] = [];
  const client = new Client(
    { name: 'e2e-stdio', version: '1.0.0' },
    {
      capabilities: { elicitation: { form: {} } },
      ...(era === 'modern' && { versionNegotiation: { mode: { pin: '2026-07-28' } } }),
    },
  );
  client.onerror = (error) => void errors.push(error);
  client.setRequestHandler('elicitation/create', async () => ({ action: 'accept', content: { confirm: true } }));
  return { client, transport, errors, stderr: () => stderr };
}

describe.each(['modern', 'legacy'] as const)('stdio, %s client', (era) => {
  let session: ReturnType<typeof spawnClient>;

  beforeAll(async () => {
    session = spawnClient(era, { MCP_ROLE: 'admin' });
    await session.client.connect(session.transport);
  });

  afterAll(async () => {
    await session?.client.close();
  });

  it('negotiates the era', () => {
    expect(session.client.getProtocolEra()).toBe(era);
    expect(session.client.getServerVersion()).toMatchObject({ name: 'local', version: '1.0.0' });
  });

  it('calls tools through the interceptor and the guard', async () => {
    expect(text(await session.client.callTool({ name: 'add', arguments: { a: 2, b: 3 } }))).toBe('5 (via stdio)');
    expect(text(await session.client.callTool({ name: 'purge', arguments: {} }))).toBe('purged (via stdio)');
  });

  it('describes the call as a stdio one, without a request or a token', async () => {
    const result = await session.client.callTool({ name: 'whoami', arguments: {} });
    expect(JSON.parse(text(result)!)).toEqual({ transport: 'stdio', era, hasRequest: false, authInfo: null });
  });

  it('asks the user mid-call, on both eras: the connection carries the request', async () => {
    const result = await session.client.callTool({ name: 'remove', arguments: { path: '/tmp/cache' } });
    expect(text(result)).toBe('deleted /tmp/cache (via stdio)');
  });

  it('reads resources and gets prompts', async () => {
    const { contents } = await session.client.readResource({ uri: 'local://pid' });
    expect((contents[0] as { text: string }).text).toMatch(/^\d+ \(via stdio\)$/); // the class interceptor wraps resources too
    const prompt = await session.client.getPrompt({ name: 'greet', arguments: { name: 'Ada' } });
    expect(prompt.messages[0].content).toEqual({ type: 'text', text: 'Say hello to Ada. (via stdio)' });
  });

  it("keeps Nest's logs on stderr, off the protocol channel", async () => {
    await session.client.callTool({ name: 'add', arguments: { a: 1, b: 1 } });
    // The log travels on stderr, a pipe of its own, so it can arrive after the result on stdout.
    await vi.waitFor(() => {
      expect(session.stderr()).toContain('[LocalTools]');
      expect(session.stderr()).toContain('adding 1 and 1');
    });
    expect(session.errors).toEqual([]);
  });
});

it('refuses a call the guard denies, from the environment', async () => {
  const session = spawnClient('modern', { MCP_ROLE: 'reader' });
  await session.client.connect(session.transport);
  try {
    expect(await session.client.callTool({ name: 'purge', arguments: {} })).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Forbidden resource' }],
    });
  } finally {
    await session.client.close();
  }
});

it('shuts the application down when the client closes stdin', async () => {
  const child = spawn(process.execPath, [main], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += String(chunk)));
  child.stdin.end(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } },
    })}\n`,
  );
  let stdout = '';
  child.stdout.on('data', (chunk) => (stdout += String(chunk)));
  const [code] = await once(child, 'exit');
  expect(code).toBe(0);
  // Nothing but protocol messages on stdout.
  for (const line of stdout.trim().split('\n')) {
    expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0' });
  }
  expect(stderr).toContain('Starting Nest application...');
});
