import { createRequire } from 'node:module';
import type { INestApplication, Type } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';

const require = createRequire(import.meta.url);
const [major, minor] = (require('@nestjs/core/package.json').version as string).split('.').map(Number);

/** `@nestjs/platform-node` exists from NestJS 12.3 on; CI also runs the suite on 12.0. */
const hasNodeAdapter = major > 12 || (major === 12 && minor >= 3);

export type AdapterName = 'express' | 'fastify' | 'node';

export const adapters: { name: AdapterName; create: () => Promise<unknown> }[] = [
  { name: 'express', create: async () => new ExpressAdapter() },
  { name: 'fastify', create: async () => new FastifyAdapter() },
  ...(hasNodeAdapter
    ? [{ name: 'node' as const, create: async () => new (await import('@nestjs/platform-node')).NodeAdapter() }]
    : []),
];

/**
 * Compiles `module`, boots it on the given adapter and listens on loopback. `setup` runs before `init()`, for global
 * prefixes, pipes and filters.
 */
export async function createApp(
  adapter: AdapterName,
  module: Type<unknown>,
  options: {
    override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
    setup?: (app: INestApplication) => void | Promise<void>;
  } = {},
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [module] });
  if (options.override) {
    builder = options.override(builder);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication((await adapters.find((a) => a.name === adapter)!.create()) as any, {
    logger: false,
  });
  await options.setup?.(app);
  await app.listen(0, '127.0.0.1');
  return app;
}

/** The base URL of a listening app. */
export async function urlOf(app: INestApplication, path = '/mcp'): Promise<URL> {
  const address = app.getHttpServer().address() as { port: number };
  return new URL(path, `http://127.0.0.1:${address.port}`);
}
