### Model Context Protocol (MCP)

The online store for cat food and supplies answers a lot of email: "where is my order?", "can I change the delivery address?", "is the salmon kibble back in stock?". The support team works in an AI assistant (Claude, ChatGPT, an agent in their help desk), and the assistant can only answer when it can see what the order API sees.

The [Model Context Protocol](https://modelcontextprotocol.io) (MCP) is how an assistant reaches an application. The application runs an **MCP server**, and exposes three kinds of things to the assistant, the **MCP client**:

- **Tools**, actions the model calls with arguments: look up an order, change its address.
- **Resources**, data the client reads by URI: the catalog, one order.
- **Prompts**, templates the user picks: "draft a reply about this order".

`@nestjs/mcp` turns methods of your providers into tools, resources and prompts with a decorator each. They run through the guards, interceptors, pipes and exception filters your routes use, and the server is served from the Nest application you already have: over Streamable HTTP for remote assistants, and over stdio for one that launches it as a local process.

In this tutorial, you'll give the store's order API an MCP server:

- Tools to find an order and to change its delivery address, with schemas the model sees and the server validates.
- The catalog as a resource, and each order as a resource template.
- A prompt for drafting a reply.
- A guard that lets only the support team change orders, and an interceptor that logs each call.
- OAuth 2.1 on the HTTP endpoint, with the store's identity provider, and a scope for changing orders.
- The same server over stdio, and tests that call it in memory.

#### Installation

Install the package, the MCP TypeScript SDK it builds on, and Zod, for the schemas:

```bash
$ npm i --save @nestjs/mcp @modelcontextprotocol/server zod
```

> info **Hint** The schemas can come from any [Standard Schema](https://standardschema.dev) library that produces JSON Schema: Zod 4.2 or later and ArkType as they are, Valibot through `toStandardJsonSchema()` from `@valibot/to-json-schema`, and a JSON Schema document you already have through `fromJsonSchema()` from `@modelcontextprotocol/server`. Zod 3 schemas are refused at startup: the SDK cannot turn them into JSON Schema.

#### Register the module

Import `McpModule` in the root module. `name` and `version` identify the server to clients; `instructions` tells the model how to use it:

```typescript
@@filename(app.module)
import { Module } from '@nestjs/common';
import { McpModule } from '@nestjs/mcp';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'cat-store',
      version: '1.0.0',
      instructions: 'Look orders up with find-order before changing them.',
    }),
    OrdersModule,
  ],
})
export class AppModule {}
```

The module looks for tools, resources and prompts on every provider of the application, at startup. `include: [OrdersModule]` limits the search to the modules you list.

#### Tools

A tool is a method decorated with `@Tool()`. `inputSchema` describes its arguments: the SDK advertises it to the client as JSON Schema, and validates every call against it before the method runs. `.describe()` texts reach the model, which reads them to fill the arguments in:

```typescript
@@filename(orders/orders.tools)
import { Injectable, NotFoundException } from '@nestjs/common';
import { Tool, type McpContext } from '@nestjs/mcp';
import * as z from 'zod';
import { OrdersService } from './orders.service';

@Injectable()
export class OrdersTools {
  constructor(private readonly orders: OrdersService) {}

  @Tool({
    name: 'find-order',
    description: 'Find an order by its id, or the latest orders of a customer by email',
    inputSchema: z.object({
      orderId: z.string().optional().describe('The order id, such as ord_123'),
      email: z.email().optional().describe("The customer's email address"),
    }),
    annotations: { readOnlyHint: true },
  })
  async find({ orderId, email }: { orderId?: string; email?: string }) {
    const orders = orderId ? [await this.orders.findById(orderId)] : await this.orders.latestFor(email!);
    if (orders.length === 0 || !orders[0]) {
      throw new NotFoundException('No such order');
    }
    return orders;
  }

  @Tool({
    name: 'change-address',
    description: 'Change the delivery address of an order that has not shipped yet',
    inputSchema: z.object({ orderId: z.string(), address: z.string().min(10) }),
    outputSchema: z.object({ orderId: z.string(), address: z.string(), status: z.string() }),
  })
  async changeAddress({ orderId, address }: { orderId: string; address: string }, ctx: McpContext) {
    const order = await this.orders.changeAddress(orderId, address, ctx.authInfo?.clientId);
    return { orderId: order.id, address: order.address, status: order.status };
  }
}
```

Register the class as a provider, as any other:

```typescript
@@filename(orders/orders.module)
@Module({
  providers: [OrdersService, OrdersTools],
})
export class OrdersModule {}
```

The method is called with the validated arguments and the call's [context](/mcp/overview#the-call-context). What it returns becomes the tool's result:

| The method returns | The client gets |
| --- | --- |
| A string | One text block |
| Another value, with an `outputSchema` | The value as `structuredContent` (validated against the schema), and as a JSON text block |
| Another value, without one | A JSON text block |
| A `CallToolResult` (`{ content, structuredContent?, isError? }`) | It, as it is, for images, audio, embedded resources and links |
| `undefined` | An empty result |

The name defaults to the method's (`find`); tool names have 1 to 128 characters out of `A-Z a-z 0-9 _ - .`, and two tools with one name fail at startup. `annotations` are hints for the client, such as `readOnlyHint: true`, which lets it run the tool without asking the user first.

#### Resources

A resource is data the client reads, and shows the user or hands the model. `@Resource()` serves a fixed URI, `@ResourceTemplate()` every URI that matches an [RFC 6570](https://datatracker.ietf.org/doc/html/rfc6570) template, whose variables the method receives:

```typescript
@@filename(orders/orders.tools)
@Resource({ uri: 'catalog://products', description: 'Every product and its stock', mimeType: 'application/json' })
catalog() {
  return this.catalog.all();
}

@ResourceTemplate({ uriTemplate: 'orders://{orderId}', description: 'One order', mimeType: 'application/json' })
async order({ orderId }: { orderId: string }) {
  const order = await this.orders.findById(orderId);
  if (!order) {
    throw new NotFoundException();
  }
  return order;
}
```

A string is sent as text of the `mimeType`, a `Uint8Array` or `Buffer` as a binary blob, a `ReadResourceResult` (`{ contents: [...] }`) as it is, and anything else as JSON. A `NotFoundException` is answered with the spec's resource-not-found error.

#### Prompts

A prompt is a message template the user picks in the client. Its arguments are a schema too, and the client asks the user for each one:

```typescript
@@filename(orders/orders.tools)
@Prompt({
  name: 'draft-reply',
  description: 'Draft a reply to a customer about an order',
  argsSchema: z.object({
    orderId: z.string().describe('The order the customer wrote about'),
    tone: z.enum(['formal', 'friendly']).describe('How the reply sounds'),
  }),
})
async draftReply({ orderId, tone }: { orderId: string; tone: 'formal' | 'friendly' }) {
  const order = await this.orders.findById(orderId);
  return `Draft a ${tone} reply to the customer of order ${orderId}. The order: ${JSON.stringify(order)}`;
}
```

A string is one user message; an array of messages, or a `GetPromptResult` (`{ messages: [...] }`), is sent as it is.

#### Try it

Start the application, and the endpoint is at `http://localhost:3000/mcp`. The [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) lists and calls everything the server exposes:

```bash
$ npx @modelcontextprotocol/inspector
```

Choose **Streamable HTTP**, enter the URL, and **Connect**. Assistants that connect to remote MCP servers take the same URL.

#### The call context

The second argument of every MCP method is an `McpContext`:

| Property | What it is |
| --- | --- |
| `kind`, `name`, `uri` | `'tool'`, `'resource'` or `'prompt'`; the tool's or prompt's name, or the resource's; the URI being read |
| `authInfo` | The verified access token, with [authorization](/mcp/overview#authorization): `clientId`, `scopes`, `expiresAt`, `extra` |
| `request` | The HTTP platform's request (Express, Fastify, the Node adapter), with its headers and whatever middleware set on it; for the in-memory test client, a plain `{ method, url, headers }` object; `undefined` over stdio |
| `requestInfo` | The web-standard `Request` the SDK served |
| `transport`, `era` | `'http'` or `'stdio'`; `'modern'` (protocol revision 2026-07-28) or `'legacy'` (the 2025 revisions) |
| `signal` | An `AbortSignal`, aborted when the client cancels the call or goes away: pass it on to `fetch()` and your database |
| `reportProgress(progress, total?, message?)` | Sends a progress notification, when the client asked for them |
| `server` | The SDK's own request context, for the rest (`mcpReq.envelope`, `mcpReq.inputResponses`) |

```typescript
@Tool({ name: 'export-orders', description: 'Export a month of orders as CSV' })
async export(_input: unknown, ctx: McpContext) {
  const pages = await this.orders.pages();
  for (let page = 0; page < pages; page++) {
    ctx.signal.throwIfAborted();
    await this.orders.exportPage(page, { signal: ctx.signal });
    await ctx.reportProgress(page + 1, pages);
  }
  return 'Exported';
}
```

**Asking the user.** A tool that needs the user's confirmation, or a missing value, returns `inputRequired()` from `@modelcontextprotocol/server`: the client asks the user, and calls the tool again with the answer, which `acceptedContent()` reads and validates:

```typescript
@Tool({ name: 'cancel-order', description: 'Cancel an order', inputSchema: z.object({ orderId: z.string() }) })
cancel({ orderId }: { orderId: string }, ctx: McpContext) {
  const Confirmation = z.object({ confirm: z.boolean() });
  const answer = acceptedContent(ctx.server.mcpReq.inputResponses, 'confirm', Confirmation);
  if (!answer) {
    return inputRequired({
      inputRequests: { confirm: inputRequired.elicit({ message: `Cancel order ${orderId}?`, requestedSchema: Confirmation }) },
    });
  }
  return answer.confirm ? this.orders.cancel(orderId) : 'Kept the order';
}
```

> warning **Warning** Over HTTP, this works with clients of the 2026-07-28 revision. A client of a 2025 revision is asked through a request from the server, which needs a session, and the endpoint keeps none: the call ends with a tool error. Over stdio, both work.

#### Guards, interceptors, pipes and filters

Every call runs through Nest's enhancers, bound on the class, on the method or globally, as for a route. The execution context's type is `'mcp'`, and `McpExecutionContext` reads the call, as `GqlExecutionContext` does for a GraphQL resolver. Only the support team may change an order:

```typescript
@@filename(orders/support-team.guard)
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { McpExecutionContext } from '@nestjs/mcp';

@Injectable()
export class SupportTeamGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const mcp = McpExecutionContext.create(context);
    return mcp.getAuthInfo()?.extra?.team === 'support';
  }
}
```

```typescript
@@filename(orders/orders.tools)
@Tool({ name: 'change-address', ... })
@UseGuards(SupportTeamGuard)
async changeAddress(...) {}
```

`McpExecutionContext.create(context)` has `getInput()` (the arguments), `getContext()` (the `McpContext`), `getKind()`, `getName()`, `getRequest()` and `getAuthInfo()`. Interceptors see the method's return value before it becomes the result, and can time, log or transform it. Pipes see the input as the call's `body`, so a global `ValidationPipe({ transform: true })` validates a DTO class you type the input with, as it does for a route. Custom parameter decorators made with `createParamDecorator()` work after the input and the context, as on GraphQL resolvers: `add(input, ctx, @CurrentUser() user)`.

> warning **Warning** Global guards, interceptors and filters (`app.useGlobalGuards()`, `APP_GUARD`) run on MCP calls too, as they do on GraphQL resolvers, and on the HTTP request that carries them. An enhancer written for HTTP routes that reads `context.switchToHttp().getRequest()` should check `context.getType() === 'http'` first.

**Errors.** What a tool throws becomes a result with `isError: true`, which the model reads and can recover from: the message of an `HttpException` (a `BadRequestException('The address has no postcode')`), and `Internal server error` for any other error, which Nest's exception handler logs and whose message never reaches the client. Resources and prompts answer with JSON-RPC errors: a `NotFoundException` as resource-not-found, a `BadRequestException` as invalid params, another `HttpException` as an internal error carrying its message and status. An exception filter can answer instead: what it returns is the result, and a `ProtocolError` (from `@modelcontextprotocol/server`) it throws is the JSON-RPC error.

```typescript
@Catch(PaymentProviderError)
export class PaymentProviderFilter implements ExceptionFilter {
  catch(exception: PaymentProviderError, host: ArgumentsHost) {
    if (host.getType<McpContextType>() !== 'mcp') {
      throw exception;
    }
    return { content: [{ type: 'text', text: 'Payments are down; try again in a few minutes.' }], isError: true };
  }
}
```

#### The HTTP endpoint

The endpoint is a controller the module adds, at `path` (default `'mcp'`): the global prefix, versioning, middleware, CORS and HTTP guards apply to it as to any route, so with `app.setGlobalPrefix('api')` it's at `/api/mcp`, and `app.setGlobalPrefix('api', { exclude: ['mcp'] })` keeps it at `/mcp`. `endpointVersion` sets its version when versioning is on (`VERSION_NEUTRAL` keeps it at `/mcp` despite a `defaultVersion`), and `decorators` applies class decorators to it, such as `[Public()]` to exempt it from a global authentication guard, or `[UseGuards(ApiKeyGuard)]`.

It serves every request statelessly: each request gets a server instance of its own, and nothing is kept between requests. Several instances of the application behind a load balancer need no session affinity and share nothing. Clients of the 2026-07-28 protocol revision and of the 2025 ones are served on the same endpoint; `http: { legacy: 'reject' }` makes it 2026-07-28 only.

A few settings matter in production:

- **Pages from other sites.** The endpoint checks the `Origin` header: a request from a web page on another site, made by a user's browser, gets 403. A request without an `Origin` header passes, so assistants, CLIs and hosted connectors, which aren't browsers and send none, are unaffected. By default, only pages on `localhost`, `127.0.0.1` and `[::1]` are let through. To serve a browser-based client, list its hostname, `http: { allowedOrigins: ['support.catstore.example'] }` (the list replaces the default), or turn the check off with `allowedOrigins: false`.
- **DNS rebinding.** A server bound to `localhost` can also be reached by a page whose own domain resolves to `127.0.0.1`: its requests name that domain as their `Host`. Name the hosts the server answers to, `http: { allowedHosts: ['localhost', '127.0.0.1', '[::1]'] }`, and requests with another `Host` header get 403. The `Host` header isn't checked unless you set `allowedHosts`.
- **Body size.** Tool arguments arrive in the request body, which your platform's body parser reads first: Express's default limit is 100 KB. Raise it with `app.useBodyParser('json', { limit: '4mb' })`.
- **CORS.** A browser-based client on another origin needs it listed in both places: in `allowedOrigins`, by hostname, and in your CORS configuration, which also allows the `Authorization`, `Content-Type`, `Mcp-Protocol-Version`, `Mcp-Method` and `Mcp-Name` request headers and exposes `WWW-Authenticate`: `app.enableCors({ origin: ['https://support.catstore.example'], exposedHeaders: ['WWW-Authenticate'] })`.

#### Authorization

The order API's MCP server answers questions about customers, so it requires a signed-in user. In MCP, the server is an OAuth 2.1 **resource server**: the client gets an access token from the store's identity provider (Auth0, Keycloak, Entra ID, WorkOS, your own), and sends it with every request. The server verifies it, and never issues tokens. Configure `auth`:

```typescript
@@filename(app.module)
McpModule.forRoot({
  name: 'cat-store',
  version: '1.0.0',
  auth: {
    verifier: IdentityProviderTokenVerifier,
    resource: 'https://api.catstore.example/mcp',
    authorizationServers: ['https://auth.catstore.example'],
    scopesSupported: ['orders:read'],
  },
}),
```

- `resource` is the canonical URL of the MCP server. Clients ask the identity provider for a token for it, and the server accepts only tokens issued for it (their audience), as the spec requires.
- `authorizationServers` are the issuers whose tokens it accepts. The module serves them, with `scopesSupported`, as the [protected resource metadata](https://datatracker.ietf.org/doc/html/rfc9728) (RFC 9728) at `/.well-known/oauth-protected-resource/mcp`, where clients discover how to sign in.
- A request without a valid token gets 401 with a `WWW-Authenticate: Bearer` challenge that points at the metadata. That challenge is what starts the client's sign-in.

The **verifier** decides which tokens are valid. It's a class of yours with `verifyAccessToken(token)`, which returns the token's `AuthInfo`, or `null` to refuse it. Nest instantiates it, so it injects what it needs. For JWT access tokens, `JwtVerifier` from `@nestjs/authentication` checks the signature against the identity provider's keys, the issuer, the audience and the expiry:

```typescript
@@filename(auth/identity-provider-token.verifier)
import { Injectable } from '@nestjs/common';
import { JwtVerifier } from '@nestjs/authentication';
import type { McpTokenVerifier } from '@nestjs/mcp';
import type { AuthInfo } from '@modelcontextprotocol/server';

const RESOURCE = 'https://api.catstore.example/mcp';

@Injectable()
export class IdentityProviderTokenVerifier implements McpTokenVerifier {
  private readonly jwt = new JwtVerifier({
    jwks: 'https://auth.catstore.example/.well-known/jwks.json',
    issuer: 'https://auth.catstore.example',
    audience: RESOURCE,
    type: 'at+jwt',
  });

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    // A bad signature, an expired token or another audience throws a JwtError: answered with 401.
    const claims = await this.jwt.verify(token);
    return {
      token,
      clientId: String(claims.client_id ?? claims.sub),
      scopes: typeof claims.scope === 'string' ? claims.scope.split(' ') : [],
      expiresAt: claims.exp,
      resource: new URL(RESOURCE),
      extra: { team: claims.team },
    };
  }
}
```

An error with `status: 401` (`JwtError`, `UnauthorizedException`) refuses the token; any other error (the keys could not be fetched) is answered with 500. Opaque tokens go through your identity provider's introspection endpoint instead, behind the same method.

**Scopes.** `scopes` on a tool, a resource or a prompt names what the token must carry for it. A call without them is answered, before the method runs, with 403 and the missing scopes in the challenge, and the client asks the user to grant them (step-up authorization). `requiredScopes` in `auth` requires scopes on every request:

```typescript
@Tool({ name: 'change-address', ..., scopes: ['orders:write'] })
```

Declaring `scopes` without `auth` fails at startup, because nothing would check them. The token is `ctx.authInfo` in methods, and `McpExecutionContext.create(context).getAuthInfo()` in guards, for decisions scopes don't express.

**With `@nestjs/authentication` and `@nestjs/authorization`.** Their global guards run on every MCP call. The authentication guard authenticates the call with your providers, from the HTTP request it arrived in: a `JwtBearerProvider` that accepts the identity provider's tokens accepts the MCP client's. `@CurrentUser()` and `AuthenticationContext` then work in tools, and `@Can()` policies decide each call:

```typescript
@@filename(orders/orders.tools)
@Tool({ name: 'refund', description: 'Refund an order', inputSchema: z.object({ orderId: z.string() }) })
@Can(OrderPolicy, 'refund')
refund({ orderId }: { orderId: string }, ctx: McpContext, @CurrentUser() agent: Agent) {
  return this.orders.refund(orderId, agent);
}
```

Exempt the endpoint's route from the authentication guard with `decorators: [Public()]`, and let `auth` answer its unauthenticated requests: the guard's own challenge doesn't point MCP clients at the metadata. A refusal on a call is a tool error, `Unauthorized` or `Forbidden`, and a tool that declares no `@Can()` is denied, as a route is. Over stdio there is no request, so a call is anonymous unless a provider of your own authenticates it from the environment.

> info **Hint** This needs `@nestjs/authentication` 0.1.3 and `@nestjs/authorization` 0.1.1 or later, the first versions that know MCP calls (context type `'mcp'`). With earlier ones, the global guard finds no credentials on a call: mark the providers of your tools `@Public()`.

#### Over stdio

An assistant on the user's machine (Claude Desktop, Claude Code, an IDE) can launch the server as a local process, and talk to it over its stdin and stdout. Serve the same module from a standalone application context:

```typescript
@@filename(stdio)
import { NestFactory } from '@nestjs/core';
import { McpStdioLogger, McpStdioServer } from '@nestjs/mcp';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: new McpStdioLogger() });
  await app.get(McpStdioServer).listen();
  await app.close();
}
bootstrap();
```

stdout carries the protocol, and Nest's default logger writes to it: `McpStdioLogger` writes every level to stderr, which clients show as the server's log. `listen()` resolves when the client closes stdin, and `app.close()` then lets the process exit. Over stdio, the spec takes credentials from the environment, not from OAuth, so `scopes` aren't checked there; guards still run. Set `path: false` in an application that serves stdio only.

#### Testing

`connectMcpClient()` from `@nestjs/mcp/testing` connects an MCP client to the application in memory, through the same handler as the HTTP endpoint (authorization included), without a socket:

```typescript
@@filename(orders/orders.tools.spec)
import { Test } from '@nestjs/testing';
import { connectMcpClient } from '@nestjs/mcp/testing';

describe('OrdersTools', () => {
  it('finds an order', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const client = await connectMcpClient(moduleRef, { token: 'test-token' });

    const result = await client.callTool({ name: 'find-order', arguments: { orderId: 'ord_123' } });
    expect(result.isError).toBeFalsy();

    await client.close();
    await moduleRef.close();
  });
});
```

`era: 'legacy'` connects with the 2025 handshake; `headers` adds request headers. Override the verifier in the testing module to accept test tokens. The client needs `@modelcontextprotocol/client` as a dev dependency.

#### Async configuration

`forRootAsync()` takes the options from a factory, a `useClass` or a `useExisting` provider. `path`, `endpointVersion`, `decorators` and `imports` stay at the top level, because the module's routes are known when it is defined; a verifier from the factory is an instance:

```typescript
McpModule.forRootAsync({
  imports: [ConfigModule, AuthModule],
  inject: [ConfigService, IdentityProviderTokenVerifier],
  useFactory: (config: ConfigService, verifier: IdentityProviderTokenVerifier) => ({
    name: 'cat-store',
    version: config.get('VERSION'),
    auth: {
      verifier,
      resource: config.get('MCP_RESOURCE'),
      authorizationServers: [config.get('IDENTITY_PROVIDER_URL')],
    },
  }),
}),
```

#### NestJS Observe

With [NestJS Observe](https://observe.nestjs.com) (`@nestjs/observe`) in the application, every MCP call names its operation, `tools/call find-order` or `resources/read orders://{orderId}`, instead of all of them being `POST /mcp`. There is nothing to configure.

#### Production checklist

- `auth` configured on a server reachable from the network, with `resource` its public URL.
- `allowedHosts` on a server bound to `localhost`.
- The browser-based clients that call the server, if any, in `allowedOrigins` and in your CORS origins: by default, only pages on localhost get through.
- The body parser's limit above your largest tool arguments.
- Tool descriptions and `.describe()` texts written for the model: they're all it knows about your tools.
- `annotations.readOnlyHint` on the tools that change nothing, so clients don't ask the user before each call.

#### Example

A working example is available [here](https://github.com/nestjs/mcp/tree/master/sample).

#### Reference

##### Module options

| Option | Default | Description |
| --- | --- | --- |
| `name`, `version` | | Required. The server's identity, sent to clients |
| `title`, `description`, `websiteUrl`, `icons` | | More of it, for clients to show |
| `instructions` | | How the model should use the server |
| `include` | every module | The modules whose providers are searched for tools, resources and prompts |
| `path` | `'mcp'` | The HTTP endpoint's route. `false` for none. Top level of `forRootAsync()` |
| `endpointVersion` | | The endpoint's version, with versioning enabled. Top level of `forRootAsync()` |
| `decorators` | `[]` | Class decorators applied to the endpoint's controller. Top level of `forRootAsync()` |
| `imports` | `[]` | Modules whose exports a `verifier` class injects. Top level of `forRootAsync()` |
| `http.legacy` | `'stateless'` | `'reject'` serves the 2026-07-28 revision only |
| `http.responseMode` | `'auto'` | `'json'` or `'sse'` pin the response shape of 2026-07-28 requests |
| `http.allowedOrigins` | `localhost`, `127.0.0.1`, `[::1]` | The hostnames a request's `Origin` header may name; requests without one pass. A list replaces the default, `false` turns the check off |
| `http.allowedHosts` | not checked | The hostnames the `Host` header must name |
| `http.maxRequestBodySize` | 4 MiB | For bodies the platform did not parse |
| `auth.verifier` | | A class or an instance with `verifyAccessToken(token)` |
| `auth.resource` | | The server's canonical URL, and the audience of its tokens |
| `auth.authorizationServers` | | The issuers whose tokens are accepted |
| `auth.scopesSupported`, `auth.requiredScopes` | | Scopes advertised, and scopes every request needs |
| `auth.resourceName`, `auth.resourceDocumentation` | | More protected resource metadata |
| `stdio.legacy` | `'serve'` | `'reject'` refuses connections that open with the 2025 handshake |

##### Decorators

| Decorator | Options | The method is called with |
| --- | --- | --- |
| `@Tool()` | `name`, `title`, `description`, `inputSchema`, `outputSchema`, `annotations`, `icons`, `_meta`, `scopes` | The validated arguments, the context |
| `@Resource()` | `uri`, `name`, `title`, `description`, `mimeType`, `size`, `annotations`, `icons`, `_meta`, `cacheHint`, `scopes` | `{}`, the context (`ctx.uri`) |
| `@ResourceTemplate()` | `uriTemplate`, and the same | The template's variables, the context |
| `@Prompt()` | `name`, `title`, `description`, `argsSchema`, `icons`, `_meta`, `scopes` | The validated arguments, the context |
