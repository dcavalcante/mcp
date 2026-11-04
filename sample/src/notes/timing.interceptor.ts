import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { McpExecutionContext } from '@nestjs/mcp';
import { tap, type Observable } from 'rxjs';

/** Logs how long each MCP call takes, through Nest's logger. */
@Injectable()
export class TimingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Notes');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const mcp = McpExecutionContext.create(context);
    const started = performance.now();
    return next
      .handle()
      .pipe(tap(() => this.logger.log(`${mcp.getKind()} ${mcp.getName()} took ${(performance.now() - started).toFixed(1)} ms`)));
  }
}
