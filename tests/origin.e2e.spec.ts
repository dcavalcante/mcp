/**
 * Origin validation, on by default on every HTTP platform: requests without an `Origin` header (assistants, CLIs,
 * hosted connectors) and localhost pages pass, a page from another site gets 403. A list replaces the default, and
 * `false` turns the check off. The `Host` header is only checked with `allowedHosts`.
 */
import { Injectable, Module, type INestApplication, type Type } from '@nestjs/common';
import { McpModule, Tool, type McpHttpOptions } from '../lib/index.js';
import { adapters, createApp, urlOf } from './support/adapters.js';
import { connect, text } from './support/clients.js';
import { legacyRequest, statusWithHost } from './support/raw.js';

@Injectable()
class EchoTools {
  @Tool({ description: 'Echoes' })
  echo() {
    return 'echo';
  }
}

function moduleWith(http?: McpHttpOptions): Type<unknown> {
  @Module({ imports: [McpModule.forRoot({ name: 'origins', version: '1.0.0', ...(http && { http }) })], providers: [EchoTools] })
  class OriginModule {}
  return OriginModule;
}

const statusFrom = async (url: URL, origin?: string) =>
  (await legacyRequest(url, 'tools/list', {}, origin === undefined ? {} : { origin })).status;

describe.each(adapters.map((adapter) => adapter.name))('Origin validation on %s', (adapter) => {
  describe('by default', () => {
    let app: INestApplication;
    let url: URL;

    beforeAll(async () => {
      app = await createApp(adapter, moduleWith());
      url = await urlOf(app);
    });

    afterAll(async () => {
      await app?.close();
    });

    it('lets requests without an Origin header through: clients outside a browser send none', async () => {
      expect(await statusFrom(url)).toBe(200);
      const client = await connect(url, 'modern');
      expect(text(await client.callTool({ name: 'echo', arguments: {} }))).toBe('echo');
      await client.close();
    });

    it.each(['http://localhost:6274', 'http://127.0.0.1:5173', 'http://[::1]:8080'])('lets a page from %s through', async (origin) => {
      expect(await statusFrom(url, origin)).toBe(200);
    });

    it('refuses a page from another site with 403', async () => {
      const response = await legacyRequest(url, 'tools/list', {}, { origin: 'https://evil.example' });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid Origin: evil.example' },
        id: null,
      });
      // The opaque origin of a sandboxed page or a file:// document.
      expect(await statusFrom(url, 'null')).toBe(403);
    });

    it('does not check the Host header without allowedHosts', async () => {
      expect(await statusWithHost(url, 'evil.example')).toBe(200);
    });
  });

  describe('with a list of origins', () => {
    let app: INestApplication;
    let url: URL;

    beforeAll(async () => {
      // An extension's origin carries its id as the hostname; `<scheme>://*` admits every extension of a browser.
      app = await createApp(adapter, moduleWith({ allowedOrigins: ['app.example.com', 'abcdefgh', 'moz-extension://*'] }));
      url = await urlOf(app);
    });

    afterAll(async () => {
      await app?.close();
    });

    it('lets the listed origins through, and only them: the list replaces the localhost default', async () => {
      expect(await statusFrom(url, 'https://app.example.com')).toBe(200);
      expect(await statusFrom(url, 'chrome-extension://abcdefgh')).toBe(200);
      expect(await statusFrom(url, 'chrome-extension://zyxwvuts')).toBe(403);
      expect(await statusFrom(url, 'moz-extension://5c1a7e2b-0d6f-4f3a-9b8e-2f1d3c4b5a69')).toBe(200);
      expect(await statusFrom(url, 'http://localhost:6274')).toBe(403);
      expect(await statusFrom(url, 'https://evil.example')).toBe(403);
      expect(await statusFrom(url)).toBe(200);
    });
  });

  describe('turned off', () => {
    let app: INestApplication;
    let url: URL;

    beforeAll(async () => {
      app = await createApp(adapter, moduleWith({ allowedOrigins: false }));
      url = await urlOf(app);
    });

    afterAll(async () => {
      await app?.close();
    });

    it('lets any origin through', async () => {
      expect(await statusFrom(url, 'https://evil.example')).toBe(200);
      expect(await statusFrom(url, 'null')).toBe(200);
    });
  });

  describe('with allowedHosts', () => {
    let app: INestApplication;
    let url: URL;

    beforeAll(async () => {
      app = await createApp(adapter, moduleWith({ allowedHosts: ['localhost', '127.0.0.1', '[::1]'] }));
      url = await urlOf(app);
    });

    afterAll(async () => {
      await app?.close();
    });

    it('refuses another Host, as a DNS-rebinding page sends it', async () => {
      expect(await statusFrom(url)).toBe(200);
      expect(await statusWithHost(url, 'evil.example')).toBe(403);
      expect(await statusWithHost(url, 'localhost:3000')).toBe(200);
    });
  });
});

it('refuses an allowedOrigins option that is neither a list nor false', async () => {
  const { Test } = await import('@nestjs/testing');
  await expect(
    Test.createTestingModule({ imports: [moduleWith({ allowedOrigins: 'localhost' as never })] }).compile(),
  ).rejects.toThrow('`http.allowedOrigins` must be a list of hostnames');
});
