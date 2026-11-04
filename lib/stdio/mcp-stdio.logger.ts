import { ConsoleLogger, type LogLevel } from '@nestjs/common';

/**
 * Nest's `ConsoleLogger`, writing every level to stderr. Over stdio, stdout is the protocol channel, and
 * `ConsoleLogger` writes `log`, `warn`, `debug` and `verbose` there: pass this one to the application context.
 */
export class McpStdioLogger extends ConsoleLogger {
  protected printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    _writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
    params?: Record<string, any>,
  ): void {
    super.printMessages(messages, context, logLevel, 'stderr', errorStack, params);
  }
}
