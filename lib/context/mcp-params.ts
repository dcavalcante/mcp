import type { ParamsFactory } from '@nestjs/core';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { MCP_PARAMS_METADATA } from '../mcp.constants.js';

/**
 * The parameters of an MCP method. Pipes see the input as a `body` parameter (so `ValidationPipe` validates a DTO
 * class) and the context as a `custom` one (which it skips).
 */
export enum McpParamtype {
  INPUT = RouteParamtypes.BODY,
  CONTEXT = 1001,
}

export class McpParamsFactory implements ParamsFactory {
  exchangeKeyForValue(type: number, data: unknown, args: unknown[]): unknown {
    switch (type) {
      case McpParamtype.INPUT: {
        const input = args[0] as Record<string, unknown> | undefined;
        return typeof data === 'string' && input ? input[data] : input;
      }
      case McpParamtype.CONTEXT:
        return args[1];
      default:
        return null;
    }
  }
}

/**
 * Records the two parameters of an MCP method, `(input, context)`, as parameter metadata, where no parameter
 * decorator took their place. `ExternalContextCreator` runs pipes only on parameters it has metadata for, and calls
 * the method with those alone: custom decorators (`createParamDecorator()`) on other parameters keep theirs.
 */
export function recordHandlerParams(target: Function, methodName: string): void {
  const existing: Record<string, { index: number }> = Reflect.getMetadata(MCP_PARAMS_METADATA, target, methodName) ?? {};
  const taken = new Set(Object.values(existing).map((param) => param.index));
  if (taken.has(0) && taken.has(1)) {
    return;
  }
  Reflect.defineMetadata(
    MCP_PARAMS_METADATA,
    {
      ...existing,
      ...(!taken.has(0) && { [`${McpParamtype.INPUT}:0`]: { index: 0, data: undefined, pipes: [] } }),
      ...(!taken.has(1) && { [`${McpParamtype.CONTEXT}:1`]: { index: 1, data: undefined, pipes: [] } }),
    },
    target,
    methodName,
  );
}
