/**
 * The module's configuration: forRootAsync(), `include`, `path` and the global prefix, `decorators` on the endpoint's
 * controller, and the mistakes that fail at startup instead of at the first request.
 */
import {
  Injectable,
  Module,
  Scope,
  SetMetadata,
  VERSION_NEUTRAL,
  VersioningType,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  type Type,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { fromJsonSchema, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { Test } from '@nestjs/testing';
import * as z from 'zod';
import { McpModule, McpRegistry, Prompt, Resource, Tool } from '../lib/index.js';
import { connectMcpClient } from '../lib/testing/index.js';
import { StoreTokenVerifier, TokenModule } from './fixtures/auth/auth.module.js';
import { createApp, urlOf } from './support/adapters.js';
import { text } from './support/clients.js';
import { legacyRequest } from './support/raw.js';

@Injectable()
class EchoTools {
  @Tool({ description: 'Echoes', inputSchema: z.object({ value: z.string() }) })
  echo({ value }: { value: string }) {
    return value;
  }
}

@Injectable()
class BillingTools {
  @Tool({ description: 'Bills' })
  bill() {
    return 'billed';
  }
}

@Module({ providers: [BillingTools] })
class BillingModule {}

@Injectable()
class Config {
  readonly serverName = 'configured';
}

@Module({ providers: [Config], exports: [Config] })
class ConfigModule {}

async function init(module: Type<unknown>) {
  const moduleRef = await Test.createTestingModule({ imports: [module] }).compile();
  return moduleRef.init();
}

describe('McpModule', () => {
  it('takes its options from a forRootAsync() factory', async () => {
    @Module({
      imports: [
        McpModule.forRootAsync({
          imports: [ConfigModule],
          inject: [Config],
          useFactory: (config: Config) => ({ name: config.serverName, version: '2.0.0' }),
        }),
      ],
      providers: [EchoTools],
    })
    class AsyncModule {}

    const moduleRef = await init(AsyncModule);
    const client = await connectMcpClient(moduleRef);
    expect(client.getServerVersion()).toMatchObject({ name: 'configured', version: '2.0.0' });
    expect(text(await client.callTool({ name: 'echo', arguments: { value: 'hi' } }))).toBe('hi');
    await client.close();
    await moduleRef.close();
  });

  it('takes a token verifier instance from the forRootAsync() factory, and refuses a class there', async () => {
    const verifier = { verifyAccessToken: async () => null };
    @Module({
      imports: [
        McpModule.forRootAsync({
          useFactory: () => ({
            name: 'async-auth',
            version: '1.0.0',
            auth: { verifier, resource: 'https://example.com/mcp', authorizationServers: ['https://auth.example.com'] },
          }),
        }),
      ],
    })
    class InstanceModule {}
    await (await init(InstanceModule)).close();

    @Module({
      imports: [
        McpModule.forRootAsync({
          imports: [TokenModule],
          useFactory: () => ({
            name: 'async-auth',
            version: '1.0.0',
            auth: {
              verifier: StoreTokenVerifier,
              resource: 'https://example.com/mcp',
              authorizationServers: ['https://auth.example.com'],
            },
          }),
        }),
      ],
    })
    class ClassModule {}
    await expect(init(ClassModule)).rejects.toThrow(/returned `auth.verifier` as a class/);
  });

  it('only looks into the `include` modules', async () => {
    @Module({
      imports: [BillingModule, McpModule.forRoot({ name: 'billing', version: '1.0.0', include: [BillingModule] })],
      providers: [EchoTools],
    })
    class IncludeModule {}

    const moduleRef = await init(IncludeModule);
    expect(moduleRef.get(McpRegistry).tools.map((tool) => tool.name)).toEqual(['bill']);
    await moduleRef.close();
  });

  describe('the HTTP endpoint', () => {
    let app: INestApplication | undefined;

    afterEach(async () => {
      await app?.close();
      app = undefined;
    });

    it('is a route like any other: the global prefix applies, and not to the protected resource metadata', async () => {
      @Module({
        imports: [
          McpModule.forRoot({
            name: 'prefixed',
            version: '1.0.0',
            path: 'agents/mcp',
            auth: {
              verifier: {
                verifyAccessToken: (token) => ({
                  token,
                  clientId: 'agent',
                  scopes: [],
                  expiresAt: Math.floor(Date.now() / 1000) + 60,
                  resource: new URL('https://notes.example.com/api/agents/mcp'),
                }),
              },
              resource: 'https://notes.example.com/api/agents/mcp',
              authorizationServers: ['https://auth.example.com'],
            },
          }),
        ],
        providers: [EchoTools],
      })
      class PrefixedModule {}

      app = await createApp('express', PrefixedModule, { setup: (app) => void app.setGlobalPrefix('api') });
      const served = await legacyRequest(await urlOf(app, '/api/agents/mcp'), 'tools/list', {}, { authorization: 'Bearer agent' });
      expect(served.status).toBe(200);
      expect((await legacyRequest(await urlOf(app, '/agents/mcp'), 'tools/list')).status).toBe(404);

      const metadata = await fetch(await urlOf(app, '/.well-known/oauth-protected-resource/api/agents/mcp'));
      expect(metadata.status).toBe(200);
      expect(await metadata.json()).toMatchObject({ resource: 'https://notes.example.com/api/agents/mcp' });
    });

    it('takes an endpoint version, e.g. to stay at /mcp when versioning sets a default version', async () => {
      const module = (endpointVersion?: typeof VERSION_NEUTRAL) => {
        @Module({
          imports: [McpModule.forRoot({ name: 'versioned', version: '1.0.0', ...(endpointVersion && { endpointVersion }) })],
          providers: [EchoTools],
        })
        class VersionedModule {}
        return VersionedModule;
      };
      const versioned = (app: INestApplication) => void app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

      app = await createApp('express', module(), { setup: versioned });
      expect((await legacyRequest(await urlOf(app, '/v1/mcp'), 'tools/list')).status).toBe(200);
      await app.close();

      app = await createApp('express', module(VERSION_NEUTRAL), { setup: versioned });
      expect((await legacyRequest(await urlOf(app, '/mcp'), 'tools/list')).status).toBe(200);
    });

    it("leaves the global prefix's `exclude` option to opt it out", async () => {
      @Module({ imports: [McpModule.forRoot({ name: 'excluded', version: '1.0.0' })], providers: [EchoTools] })
      class ExcludedModule {}

      app = await createApp('express', ExcludedModule, { setup: (app) => void app.setGlobalPrefix('api', { exclude: ['mcp'] }) });
      expect((await legacyRequest(await urlOf(app, '/mcp'), 'tools/list')).status).toBe(200);
      expect((await legacyRequest(await urlOf(app, '/api/mcp'), 'tools/list')).status).toBe(404);
    });

    it('serves no route with `path: false`', async () => {
      @Module({ imports: [McpModule.forRoot({ name: 'stdio-only', version: '1.0.0', path: false })], providers: [EchoTools] })
      class StdioOnlyModule {}

      app = await createApp('express', StdioOnlyModule);
      expect((await legacyRequest(await urlOf(app), 'tools/list')).status).toBe(404);
    });

    it('takes class decorators, e.g. to exempt it from a global guard', async () => {
      const IS_PUBLIC = 'isPublic';
      @Injectable()
      class SignedInGuard implements CanActivate {
        constructor(private readonly reflector: Reflector) {}
        canActivate(context: ExecutionContext) {
          return context.getType() !== 'http' || this.reflector.get(IS_PUBLIC, context.getClass()) === true;
        }
      }
      const module = (decorators: ClassDecorator[]) => {
        @Module({
          imports: [McpModule.forRoot({ name: 'guarded', version: '1.0.0', decorators })],
          providers: [EchoTools, { provide: APP_GUARD, useClass: SignedInGuard }],
        })
        class GuardedModule {}
        return GuardedModule;
      };

      app = await createApp('express', module([]));
      expect((await legacyRequest(await urlOf(app), 'tools/list')).status).toBe(403);
      await app.close();

      app = await createApp('express', module([SetMetadata(IS_PUBLIC, true)]));
      expect((await legacyRequest(await urlOf(app), 'tools/list')).status).toBe(200);
    });

    it('can be modern-only', async () => {
      @Module({
        imports: [McpModule.forRoot({ name: 'modern', version: '1.0.0', http: { legacy: 'reject' } })],
        providers: [EchoTools],
      })
      class ModernOnlyModule {}

      app = await createApp('express', ModernOnlyModule);
      const response = await legacyRequest(await urlOf(app), 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'old', version: '1' },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: -32022, data: { supported: ['2026-07-28'] } } });
    });
  });

  describe('schemas', () => {
    it('converts each schema to JSON Schema once, not on every request', async () => {
      let conversions = 0;
      const base = z.object({ value: z.string() });
      const standard = base['~standard'] as StandardSchemaWithJSON['~standard'];
      type Options = Parameters<typeof standard.jsonSchema.input>[0];
      const counted = {
        '~standard': {
          ...standard,
          jsonSchema: {
            input: (options: Options) => (conversions++, standard.jsonSchema.input(options)),
            output: (options: Options) => (conversions++, standard.jsonSchema.output(options)),
          },
        },
      } as StandardSchemaWithJSON;

      @Injectable()
      class CountedTools {
        @Tool({ description: 'Counted', inputSchema: counted })
        counted({ value }: { value: string }) {
          return value;
        }
      }
      @Module({ imports: [McpModule.forRoot({ name: 'counted', version: '1.0.0' })], providers: [CountedTools] })
      class CountedModule {}

      const moduleRef = await init(CountedModule);
      const client = await connectMcpClient(moduleRef);
      for (let i = 0; i < 3; i++) {
        await client.listTools();
        await client.callTool({ name: 'counted', arguments: { value: 'x' } });
      }
      expect(conversions).toBe(1);
      await client.close();
      await moduleRef.close();
    });

    it('takes a plain JSON Schema through fromJsonSchema()', async () => {
      @Injectable()
      class JsonSchemaTools {
        @Tool({
          description: 'Greets',
          inputSchema: fromJsonSchema<{ name: string }>({
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          }),
        })
        greet({ name }: { name: string }) {
          return `Hello, ${name}`;
        }
      }
      @Module({ imports: [McpModule.forRoot({ name: 'json', version: '1.0.0' })], providers: [JsonSchemaTools] })
      class JsonSchemaModule {}

      const moduleRef = await init(JsonSchemaModule);
      const client = await connectMcpClient(moduleRef);
      expect(text(await client.callTool({ name: 'greet', arguments: { name: 'Ada' } }))).toBe('Hello, Ada');
      expect((await client.callTool({ name: 'greet', arguments: {} })).isError).toBe(true);
      await client.close();
      await moduleRef.close();
    });
  });

  describe('fails at startup', () => {
    const failing = (providers: Type<unknown>[], options: Partial<Parameters<typeof McpModule.forRoot>[0]> = {}) => {
      @Module({ imports: [McpModule.forRoot({ name: 'failing', version: '1.0.0', ...options })], providers })
      class FailingModule {}
      return init(FailingModule);
    };

    it('on two tools with one name', async () => {
      @Injectable()
      class OtherEchoTools {
        @Tool({ name: 'echo', description: 'Echoes too' })
        other() {
          return 'again';
        }
      }
      await expect(failing([EchoTools, OtherEchoTools])).rejects.toThrow(
        'OtherEchoTools.other: there is already a tool named "echo" (EchoTools.echo)',
      );
    });

    it('on a tool name outside the MCP naming rules', async () => {
      @Injectable()
      class BadNameTools {
        @Tool({ name: 'send email', description: 'Sends' })
        send() {}
      }
      await expect(failing([BadNameTools])).rejects.toThrow('"send email" is not a valid tool name');
    });

    it('on a request-scoped provider', async () => {
      @Injectable({ scope: Scope.REQUEST })
      class ScopedTools {
        @Tool({ description: 'Scoped' })
        scoped() {}
      }
      await expect(failing([ScopedTools])).rejects.toThrow('must be on singleton providers');
    });

    it('on scopes without the auth option, unless there is no HTTP endpoint', async () => {
      @Injectable()
      class ScopedTools {
        @Tool({ description: 'Deletes', scopes: ['notes:write'] })
        remove() {}

        @Prompt({ description: 'Drafts' })
        draft() {
          return 'Draft.';
        }
      }
      await expect(failing([ScopedTools])).rejects.toThrow('declares { scopes }, which are only checked');
      await (await failing([ScopedTools], { path: false })).close();
    });

    it('on a schema that is not a Standard Schema, or cannot produce JSON Schema', async () => {
      @Injectable()
      class PlainObjectTools {
        @Tool({ description: 'Plain', inputSchema: { type: 'object' } as never })
        plain() {}
      }
      await expect(failing([PlainObjectTools])).rejects.toThrow('PlainObjectTools.plain inputSchema: not a Standard Schema');

      const validateOnly = { '~standard': { version: 1, vendor: 'legacy', validate: (value: unknown) => ({ value }) } };
      @Injectable()
      class ValidateOnlyTools {
        @Tool({ description: 'No JSON Schema', inputSchema: validateOnly as never })
        validateOnly() {}
      }
      await expect(failing([ValidateOnlyTools])).rejects.toThrow('cannot produce JSON Schema');
    });

    it('on arguments that are not an object', async () => {
      @Injectable()
      class StringArgumentTools {
        @Tool({ description: 'A string', inputSchema: z.string() })
        string() {}
      }
      await expect(failing([StringArgumentTools])).rejects.toThrow('arguments are an object');
    });

    it('on a malformed auth option', async () => {
      await expect(
        failing([EchoTools], {
          auth: { verifier: StoreTokenVerifier, resource: 'notes.example.com', authorizationServers: ['https://auth.example.com'] },
          imports: [TokenModule],
        }),
      ).rejects.toThrow('`auth.resource` must be the absolute URL');
      await expect(
        failing([EchoTools], {
          auth: { verifier: StoreTokenVerifier, resource: 'https://notes.example.com/mcp', authorizationServers: [] },
          imports: [TokenModule],
        }),
      ).rejects.toThrow('`auth.authorizationServers` must list');
    });
  });

  describe('decorators', () => {
    it('refuse a second primitive on one method', () => {
      expect(() => {
        class Twice {
          @Tool()
          @Prompt()
          both() {}
        }
        return Twice;
      }).toThrow('Twice.both has both @Prompt() and @Tool()');
    });

    it('refuse a resource without an absolute URI', () => {
      expect(() => Resource({ uri: 'notes' })).toThrow('@Resource() needs { uri }');
    });
  });
});
