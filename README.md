<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[travis-image]: https://api.travis-ci.org/nestjs/nest.svg?branch=master
[travis-url]: https://travis-ci.org/nestjs/nest
[linux-image]: https://img.shields.io/travis/nestjs/nest/master.svg?label=linux
[linux-url]: https://travis-ci.org/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore"><img src="https://img.shields.io/npm/dm/@nestjs/core.svg" alt="NPM Downloads" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec"><img src="https://img.shields.io/badge/Donate-PayPal-dc3d53.svg"/></a>
  <a href="https://twitter.com/nestframework"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Model Context Protocol](https://modelcontextprotocol.io) module for [Nest](https://github.com/nestjs/nest): tools, resources and prompts are methods of your providers, declared with decorators and a schema (Zod, ArkType, Valibot or JSON Schema), and run through Nest's guards, interceptors, pipes and exception filters. The server is served over Streamable HTTP from your existing Nest application (Express, Fastify or the Node adapter), statelessly so it scales behind any load balancer, to clients of both the 2026-07-28 and the 2025 protocol revisions, and over stdio from a standalone application context. It can act as an OAuth 2.1 resource server with protected resource metadata, `WWW-Authenticate` challenges, per-tool scopes and a token verifier of your own, and comes with an in-memory test client. Built on the official MCP TypeScript SDK (`@modelcontextprotocol/server`).

## Installation

```bash
$ npm i --save @nestjs/mcp @modelcontextprotocol/server zod
```

Zod 4.2 or later; any other [Standard Schema](https://standardschema.dev) library that produces JSON Schema works too.

## Quick Start

[Overview & Tutorial](https://docs.nestjs.com/mcp/overview)

Import the module, and decorate the methods of a provider:

```ts
import { Injectable, Module } from '@nestjs/common';
import { McpModule, Resource, Tool, type McpContext } from '@nestjs/mcp';
import * as z from 'zod';

@Injectable()
export class NotesTools {
  constructor(private readonly notes: NotesService) {}

  @Tool({
    description: 'Save a note',
    inputSchema: z.object({ text: z.string().describe('What to remember') }),
  })
  add({ text }: { text: string }, ctx: McpContext) {
    return this.notes.add(text, ctx.authInfo?.clientId);
  }

  @Resource({ uri: 'notes://all', mimeType: 'application/json' })
  all() {
    return this.notes.all();
  }
}

@Module({
  imports: [McpModule.forRoot({ name: 'notes', version: '1.0.0' })],
  providers: [NotesService, NotesTools],
})
export class AppModule {}
```

`app.listen(3000)` now serves the MCP endpoint at `http://localhost:3000/mcp`, a route like any other (the global prefix and middleware apply to it). Guards, interceptors, pipes and filters run around every call; `McpExecutionContext.create(context)` reads the call in them, as `GqlExecutionContext` does for GraphQL.

Over stdio, for a host that launches the server, serve the same module from an application context, logging to stderr:

```ts
const app = await NestFactory.createApplicationContext(AppModule, { logger: new McpStdioLogger() });
await app.get(McpStdioServer).listen(); // until the client closes stdin
await app.close();
```

In tests, `connectMcpClient(app)` from `@nestjs/mcp/testing` connects an MCP client to the application in memory.

The [sample](sample) is a notes server with a guard and an interceptor, served over both transports: `npm run build && npx tsc -p sample/tsconfig.json`, then `node sample/dist/main.js` (HTTP) or `node sample/dist/stdio.js` (stdio).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](LICENSE).
