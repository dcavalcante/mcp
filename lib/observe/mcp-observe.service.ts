import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

/** A variable, so that bundlers and the compiler leave the optional package alone. */
const OBSERVE_PACKAGE: string = '@nestjs/observe';

/** The part of `@nestjs/observe`'s `TracerService` used here. */
interface ObserveTracer {
  setOperationId(operationId: string): void;
}

/**
 * Names NestJS Observe operations after MCP calls (`tools/call add`), when `@nestjs/observe` is installed and its
 * module imported: every call arrives as the same `POST /mcp`, which would otherwise be all an operation is called.
 * Nothing happens without it; it is never a dependency.
 */
@Injectable()
export class McpObserve implements OnApplicationBootstrap {
  private readonly logger = new Logger('McpModule');
  private tracer: ObserveTracer | undefined;

  constructor(private readonly moduleRef: ModuleRef) {}

  async onApplicationBootstrap() {
    let observe: { TracerService?: abstract new (...args: never[]) => ObserveTracer };
    try {
      observe = await import(OBSERVE_PACKAGE);
    } catch {
      return; // not installed
    }
    if (!observe.TracerService) {
      return;
    }
    try {
      const tracer = this.moduleRef.get(observe.TracerService, { strict: false });
      if (typeof tracer?.setOperationId === 'function') {
        this.tracer = tracer;
      }
    } catch {
      // Installed, but ObserveModule is not imported by this application.
    }
  }

  /** Names the current request's operation. Never fails the call. */
  nameOperation(operationId: string): void {
    if (!this.tracer) {
      return;
    }
    try {
      this.tracer.setOperationId(operationId);
    } catch (error) {
      this.tracer = undefined;
      this.logger.warn(`NestJS Observe could not name the operation; MCP calls are no longer named: ${String(error)}`);
    }
  }
}
