/**
 * The MCP server as an OAuth resource server, on every HTTP platform: protected resource metadata, 401 challenges
 * that point at it, audience and expiry checks, endpoint-wide and per-operation scopes (403 step-up), the verified
 * token in methods and guards, and verifier failures.
 */
import type { INestApplication } from '@nestjs/common';
import { InsufficientScopeError, SdkHttpError, type Client } from '@modelcontextprotocol/client';
import { AuthAppModule, ISSUER, ReadersOnlyAppModule, RESOURCE } from './fixtures/auth/auth.module.js';
import { adapters, createApp, urlOf } from './support/adapters.js';
import { connect, eras, text } from './support/clients.js';
import { challengeOf, legacyRequest, messageOf, modernRequest } from './support/raw.js';

const METADATA_URL = 'https://notes.example.com/.well-known/oauth-protected-resource/mcp';

describe.each(adapters.map((adapter) => adapter.name))('authorization on %s', (adapter) => {
  let app: INestApplication;
  let url: URL;

  beforeAll(async () => {
    app = await createApp(adapter, AuthAppModule);
    url = await urlOf(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the protected resource metadata at the path-aware well-known location, and at the root one', async () => {
    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      const response = await fetch(new URL(path, url));
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(await response.json()).toEqual({
        resource: RESOURCE,
        authorization_servers: [ISSUER],
        bearer_methods_supported: ['header'],
        scopes_supported: ['notes:read'],
        resource_name: 'Notes',
      });
    }
  });

  it('answers a request without a token with 401 and a challenge pointing at the metadata', async () => {
    const response = await legacyRequest(url, 'tools/list');
    expect(response.status).toBe(401);
    expect(challengeOf(response)).toEqual({
      error: 'invalid_token',
      error_description: 'Missing Authorization header',
      resource_metadata: METADATA_URL,
    });
    expect(await response.json()).toEqual({ error: 'invalid_token', error_description: 'Missing Authorization header' });
  });

  it.each([
    ['an unknown token', 'unknown', 'Invalid token'],
    ['an expired token', 'expired', 'Token has expired'],
    ['a token issued for another resource', 'elsewhere', 'Token was not issued for this resource'],
    ['a token the verifier refuses with an UnauthorizedException', 'revoked', 'Token revoked'],
    ['a token the verifier refuses with an error of status 401', 'malformed', 'signature mismatch'],
  ])('answers %s with 401 invalid_token', async (_case, token, description) => {
    const response = await modernRequest(url, 'tools/list', {}, { authorization: `Bearer ${token}` });
    expect(response.status).toBe(401);
    expect(challengeOf(response)).toMatchObject({ error: 'invalid_token', error_description: description });
  });

  it('answers a verifier failure with 500, not 401', async () => {
    const response = await modernRequest(url, 'tools/list', {}, { authorization: 'Bearer outage' });
    expect(response.status).toBe(500);
    expect(response.headers.get('www-authenticate')).toBeNull();
  });

  it("challenges a call without the tool's scopes with 403 insufficient_scope, before the method runs", async () => {
    for (const request of [legacyRequest, modernRequest]) {
      const response = await request(url, 'tools/call', { name: 'remove', arguments: {} }, { authorization: 'Bearer reader' });
      expect(response.status).toBe(403);
      expect(challengeOf(response)).toEqual({
        error: 'insufficient_scope',
        error_description: 'Insufficient scope',
        scope: 'notes:write',
        resource_metadata: METADATA_URL,
      });
    }
  });

  it('challenges resource reads and prompts with their scopes too', async () => {
    const read = await modernRequest(url, 'resources/read', { uri: 'private://1' }, { authorization: 'Bearer reader' });
    expect(read.status).toBe(403);
    expect(challengeOf(read)?.scope).toBe('notes:write');

    const prompt = await legacyRequest(url, 'prompts/get', { name: 'draft' }, { authorization: 'Bearer reader' });
    expect(prompt.status).toBe(403);

    const allowed = await legacyRequest(url, 'prompts/get', { name: 'draft' }, { authorization: 'Bearer writer' });
    expect((await messageOf(allowed)).result.messages).toHaveLength(1);
  });

  describe.each(eras)('%s client', (era) => {
    let reader: Client;
    let writer: Client;

    beforeAll(async () => {
      reader = await connect(url, era, { authorization: 'Bearer reader' });
      writer = await connect(url, era, { authorization: 'Bearer writer' });
    });

    afterAll(async () => {
      await reader?.close();
      await writer?.close();
    });

    it("hands the verified token to the method", async () => {
      const result = await reader.callTool({ name: 'whoami', arguments: {} });
      expect(JSON.parse(text(result)!)).toEqual({ clientId: 'alice', scopes: ['notes:read'] });
    });

    it('lets a token with the scopes through, and lists the scoped tools to everyone', async () => {
      expect(text(await reader.callTool({ name: 'list', arguments: {} }))).toBe('note-1, note-2');
      expect(text(await writer.callTool({ name: 'remove', arguments: {} }))).toBe('deleted');
      expect((await reader.listTools()).tools.map((tool) => tool.name)).toContain('remove');
    });

    it('surfaces the scope challenge to the client as a step-up error', async () => {
      const error = await reader.callTool({ name: 'remove', arguments: {} }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InsufficientScopeError);
      expect(error).toMatchObject({ requiredScope: 'notes:write', resourceMetadataUrl: new URL(METADATA_URL) });
    });

    it('lets guards decide on the verified token', async () => {
      expect(await reader.callTool({ name: 'export', arguments: {} })).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'Forbidden resource' }],
      });
      expect(text(await writer.callTool({ name: 'export', arguments: {} }))).toBe('exported');
    });
  });

  it('refuses to connect a client without a token', async () => {
    const error = await connect(url, 'modern').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SdkHttpError);
    expect(error).toMatchObject({ code: 'CLIENT_HTTP_AUTHENTICATION' });
  });
});

describe('endpoint-wide required scopes', () => {
  let app: INestApplication;
  let url: URL;

  beforeAll(async () => {
    app = await createApp('express', ReadersOnlyAppModule);
    url = await urlOf(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers a token without them with 403, naming them', async () => {
    const response = await modernRequest(url, 'tools/list', {}, { authorization: 'Bearer guest' });
    expect(response.status).toBe(403);
    expect(challengeOf(response)).toMatchObject({ error: 'insufficient_scope', scope: 'notes:read' });

    const allowed = await modernRequest(url, 'tools/list', {}, { authorization: 'Bearer reader' });
    expect(allowed.status).toBe(200);
  });
});
