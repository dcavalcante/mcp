import { Module, type DynamicModule, type Provider, type Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { McpHttpService } from './http/mcp-http.service.js';
import type { McpTokenVerifier } from './interfaces/mcp-token-verifier.interface.js';
import { MCP_TOKEN_VERIFIER } from './mcp.constants.js';
import {
  ConfigurableModuleClass,
  type McpModuleAsyncOptions,
  type McpModuleRootOptions,
  type OPTIONS_TYPE,
} from './mcp.module-definition.js';
import { McpObserve } from './observe/mcp-observe.service.js';
import { McpRegistry } from './services/mcp-registry.service.js';
import { McpServerFactory } from './services/mcp-server.factory.js';
import { McpStdioServer } from './stdio/mcp-stdio.server.js';

/**
 * `McpModule.forRoot({ name, version, ... })`, or `forRootAsync({ imports, inject, useFactory })`: an MCP server made
 * of the `@Tool()`, `@Resource()`, `@ResourceTemplate()` and `@Prompt()` methods of the application's providers,
 * served over Streamable HTTP at `path` (default `/mcp`) and, from a standalone application context, over stdio
 * (`McpStdioServer`).
 */
@Module({
  imports: [DiscoveryModule],
  providers: [McpRegistry, McpServerFactory, McpObserve, McpHttpService, McpStdioServer],
  exports: [McpRegistry, McpHttpService, McpStdioServer],
})
export class McpModule extends ConfigurableModuleClass {
  static forRoot(options: McpModuleRootOptions): DynamicModule {
    return withVerifier(super.forRoot(options as typeof OPTIONS_TYPE), options.auth?.verifier);
  }

  static forRootAsync(options: McpModuleAsyncOptions): DynamicModule {
    return withVerifier(super.forRootAsync(options), undefined);
  }
}

/** A verifier class given to `forRoot()` is a provider of the module, instantiated by Nest. */
function withVerifier(
  module: DynamicModule,
  verifier: McpTokenVerifier | Type<McpTokenVerifier> | undefined,
): DynamicModule {
  const providers: Provider[] =
    typeof verifier === 'function'
      ? [verifier, { provide: MCP_TOKEN_VERIFIER, useExisting: verifier }]
      : [{ provide: MCP_TOKEN_VERIFIER, useValue: null }];
  return { ...module, providers: [...(module.providers ?? []), ...providers] };
}
