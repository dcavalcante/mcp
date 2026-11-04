/**
 * With `@nestjs/authentication` and `@nestjs/authorization`, from the versions that know the `mcp` context type
 * (0.1.3 and 0.1.1).
 *
 * The MCP endpoint is the OAuth resource server (`auth`, with the docs page's verifier, built on `JwtVerifier`), and
 * `decorators: [Public()]` exempts its route from the global `AuthenticationGuard`, so MCP clients get the spec's
 * challenge. The guard then authenticates each tool call, with the app's own `JwtBearerProvider`, from the request
 * the call arrived in: `@CurrentUser()` and `AuthenticationContext` work in tools, `@Can()` policies decide each
 * call, and the tools' providers need no `@Public()`.
 */
import { generateKeyPairSync } from 'node:crypto';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import {
  AuthenticationContext,
  AuthenticationModule,
  AuthenticationRegistry,
  CurrentUser,
  JwtBearerProvider,
  JwtSigner,
  JwtVerifier,
  Public,
  type JwtClaims,
} from '@nestjs/authentication';
import { AuthorizationModule, Can, Policy } from '@nestjs/authorization';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { Test } from '@nestjs/testing';
import * as z from 'zod';
import { McpModule, Tool, type McpContext, type McpTokenVerifier } from '../lib/index.js';
import { connectMcpClient } from '../lib/testing/index.js';
import { createApp, urlOf } from './support/adapters.js';
import { connect, text } from './support/clients.js';
import { challengeOf, modernRequest } from './support/raw.js';

const RESOURCE = 'https://api.catstore.example/mcp';
const ISSUER = 'https://auth.catstore.example';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

const signer = (options: Partial<ConstructorParameters<typeof JwtSigner>[0]> = {}) =>
  new JwtSigner({ key: privateKey, issuer: ISSUER, audience: RESOURCE, ttl: '15m', type: 'at+jwt', ...options });
const tokenFor = (sub: string, team: string) =>
  signer().sign({ sub, client_id: 'support-desk', scope: 'orders:read', team });

interface Agent {
  id: string;
  team: string;
}

/** The verifier of the docs page: the endpoint's OAuth gate. */
@Injectable()
class IdentityProviderTokenVerifier implements McpTokenVerifier {
  private readonly jwt = new JwtVerifier({ key: publicKey, issuer: ISSUER, audience: RESOURCE, type: 'at+jwt' });

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const claims = await this.jwt.verify(token);
    return {
      token,
      clientId: String(claims.client_id ?? claims.sub),
      scopes: typeof claims.scope === 'string' ? claims.scope.split(' ') : [],
      expiresAt: claims.exp,
      resource: new URL(RESOURCE),
    };
  }
}

/** The app's own credential provider for the identity provider's tokens, as its HTTP routes use it. */
@Injectable()
class AgentAuth extends JwtBearerProvider<Agent> {
  constructor(registry: AuthenticationRegistry) {
    super({ key: publicKey, issuer: ISSUER, audience: RESOURCE, type: 'at+jwt' });
    registry.registerProvider(this);
  }

  validate(claims: JwtClaims) {
    return claims.sub ? { id: claims.sub, team: String(claims.team) } : null;
  }
}

@Policy()
class OrderPolicy {
  view(user: Agent | null) {
    return user !== null;
  }

  refund(user: Agent | null) {
    return user?.team === 'support';
  }
}

/** No `@Public()`: every call is authenticated, and checked by its `@Can()`. */
@Injectable()
class OrderTools {
  constructor(private readonly auth: AuthenticationContext<Agent>) {}

  @Tool({ description: 'Who is calling' })
  @Can(OrderPolicy, 'view')
  whoami(_input: unknown, _ctx: McpContext, @CurrentUser() agent: Agent) {
    return { id: agent.id, team: agent.team, fromContext: this.auth.user?.id };
  }

  @Tool({ description: 'Refund an order', inputSchema: z.object({ orderId: z.string() }) })
  @Can(OrderPolicy, 'refund')
  refund({ orderId }: { orderId: string }) {
    return `refunded ${orderId}`;
  }

  @Tool({ description: 'Declares no policy' })
  forgotten() {
    return 'leaked';
  }
}

@Injectable()
@Public()
class StatusTools {
  @Tool({ description: 'Is the store up' })
  status(_input: unknown, ctx: McpContext) {
    return `up for ${ctx.authInfo?.clientId}`;
  }
}

const mcp = (decorators: ClassDecorator[]) =>
  McpModule.forRoot({
    name: 'cat-store',
    version: '1.0.0',
    decorators,
    auth: { verifier: IdentityProviderTokenVerifier, resource: RESOURCE, authorizationServers: [ISSUER] },
  });

@Module({
  imports: [AuthenticationModule.forRoot({}), AuthorizationModule.forRoot({ policies: [OrderPolicy] }), mcp([Public()])],
  providers: [AgentAuth, OrderTools, StatusTools],
})
class StoreModule {}

@Module({ imports: [AuthenticationModule.forRoot({}), mcp([])], providers: [AgentAuth, StatusTools] })
class GuardedEndpointModule {}

describe('with @nestjs/authentication and @nestjs/authorization', () => {
  let app: INestApplication;
  let url: URL;

  beforeAll(async () => {
    app = await createApp('express', StoreModule);
    url = await urlOf(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("authenticates each tool call with the app's provider: @CurrentUser() and AuthenticationContext work", async () => {
    const client = await connect(url, 'modern', { authorization: `Bearer ${tokenFor('agent-7', 'support')}` });
    try {
      expect(JSON.parse(text(await client.callTool({ name: 'whoami', arguments: {} }))!)).toEqual({
        id: 'agent-7',
        team: 'support',
        fromContext: 'agent-7',
      });
    } finally {
      await client.close();
    }
  });

  it('lets @Can() decide each call, and answers a denial with a tool error', async () => {
    const support = await connect(url, 'legacy', { authorization: `Bearer ${tokenFor('agent-7', 'support')}` });
    const sales = await connect(url, 'legacy', { authorization: `Bearer ${tokenFor('agent-9', 'sales')}` });
    try {
      expect(text(await support.callTool({ name: 'refund', arguments: { orderId: 'ord_1' } }))).toBe('refunded ord_1');
      expect(await sales.callTool({ name: 'refund', arguments: { orderId: 'ord_1' } })).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'Forbidden' }],
      });
      // A tool that declares no policy is denied, as a route is.
      expect(await support.callTool({ name: 'forgotten', arguments: {} })).toMatchObject({ isError: true });
      expect(text(await sales.callTool({ name: 'status', arguments: {} }))).toBe('up for support-desk');
    } finally {
      await support.close();
      await sales.close();
    }
  });

  it('works the same with the in-memory test client', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StoreModule] }).compile();
    const client = await connectMcpClient(moduleRef, { token: tokenFor('agent-7', 'support') });
    try {
      expect(text(await client.callTool({ name: 'refund', arguments: { orderId: 'ord_2' } }))).toBe('refunded ord_2');
    } finally {
      await client.close();
      await moduleRef.close();
    }
  });

  it.each([
    ['signed with another key', () => signer({ key: other.privateKey }).sign({ sub: 'agent-7' })],
    ['issued for another resource', () => signer({ audience: 'https://elsewhere.example/mcp' }).sign({ sub: 'agent-7' })],
    ['expired', () => signer({ now: () => Date.now() - 3_600_000 }).sign({ sub: 'agent-7' })],
  ])("answers a token %s with the endpoint's 401 and its challenge", async (_case, token) => {
    const response = await modernRequest(url, 'tools/list', {}, { authorization: `Bearer ${token()}` });
    expect(response.status).toBe(401);
    expect(challengeOf(response)).toMatchObject({
      error: 'invalid_token',
      resource_metadata: 'https://api.catstore.example/.well-known/oauth-protected-resource/mcp',
    });
  });

  it("answers with the guard's own 401, without the MCP challenge, when the endpoint is not exempted", async () => {
    const guarded = await createApp('express', GuardedEndpointModule);
    try {
      const response = await modernRequest(await urlOf(guarded), 'tools/list');
      expect(response.status).toBe(401);
      expect(challengeOf(response)?.resource_metadata).toBeUndefined();
    } finally {
      await guarded.close();
    }
  });
});
