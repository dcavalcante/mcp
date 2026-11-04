import type { Readable, Writable } from 'node:stream';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { serveStdio, StdioServerTransport, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type { McpModuleOptions } from '../interfaces/mcp-module-options.interface.js';
import { MCP_MODULE_OPTIONS } from '../mcp.constants.js';
import { McpServerFactory } from '../services/mcp-server.factory.js';

export interface McpStdioListenOptions {
  /** Default `process.stdin`. */
  stdin?: Readable;
  /** Default `process.stdout`, which nothing else may write to: log with `McpStdioLogger`. */
  stdout?: Writable;
}

/**
 * Serves the MCP server over stdio, for a host that launches the application as a local process, from a standalone
 * application context:
 *
 * ```ts
 * const app = await NestFactory.createApplicationContext(AppModule, { logger: new McpStdioLogger() });
 * await app.get(McpStdioServer).listen(); // until the client closes stdin
 * await app.close();
 * ```
 *
 * The connection's opening exchange picks its protocol era (see the `stdio.legacy` option). stdout carries the
 * protocol, so the application must not write anything else there.
 */
@Injectable()
export class McpStdioServer implements OnApplicationShutdown {
  private readonly logger = new Logger('McpModule');
  private handle: StdioServerHandle | undefined;
  private onClose: (() => void) | undefined;

  constructor(
    private readonly factory: McpServerFactory,
    @Inject(MCP_MODULE_OPTIONS) private readonly options: McpModuleOptions,
  ) {}

  /** Serves stdin and stdout; resolves when the client closes stdin (or `close()` is called). */
  async listen({ stdin = process.stdin, stdout = process.stdout }: McpStdioListenOptions = {}): Promise<void> {
    if (this.handle) {
      throw new Error('McpStdioServer is already listening.');
    }

    const closed = new Promise<void>((resolve) => {
      stdin.once('end', resolve);
      stdin.once('close', resolve);
      this.onClose = resolve;
    });
    this.handle = serveStdio(({ era }) => this.factory.create({ era, transport: 'stdio' }), {
      transport: new StdioServerTransport(stdin, stdout),
      ...(this.options.stdio?.legacy && { legacy: this.options.stdio.legacy }),
      onerror: (error) => this.logger.error(`MCP stdio error: ${error.message}`, error.stack),
    });
    await closed;
    await this.close();
  }

  /** Ends the connection. */
  async close(): Promise<void> {
    const handle = this.handle;
    this.handle = undefined;
    this.onClose?.();
    await handle?.close();
  }

  async onApplicationShutdown() {
    await this.close();
  }
}
