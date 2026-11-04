/**
 * What packages that call MCP methods themselves rely on: the metadata key the decorators record under, and the
 * call context they hand a tool (`transport: 'agent'`), read through `McpExecutionContext`.
 */
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import * as z from 'zod';
import { MCP_PRIMITIVE_METADATA, McpExecutionContext, Tool, type McpAgentContext, type McpContext } from '../lib/index.js';

class OrdersTools {
  @Tool({ name: 'find-order', description: 'Find an order', inputSchema: z.object({ orderId: z.string() }) })
  find({ orderId }: { orderId: string }, ctx: McpContext) {
    return ctx.transport === 'agent' ? `${orderId} for ${ctx.user?.id}` : `${orderId} over ${ctx.transport} (${ctx.era})`;
  }
}

describe('MCP_PRIMITIVE_METADATA', () => {
  it('is where @Tool() records itself', () => {
    expect(Reflect.getMetadata(MCP_PRIMITIVE_METADATA, OrdersTools.prototype.find)).toMatchObject({
      kind: 'tool',
      options: { name: 'find-order', description: 'Find an order' },
    });
  });
});

describe('an agent call context', () => {
  const request = { method: 'POST', url: '/assistant/chat', headers: { authorization: 'Bearer token' } };
  const agent: McpAgentContext = {
    kind: 'tool',
    name: 'find-order',
    transport: 'agent',
    request,
    user: { id: 'mia' },
    scopes: ['orders:read'],
    signal: new AbortController().signal,
    reportProgress: async () => {},
  };

  function executionContext(input: unknown, context: McpContext) {
    const host = new ExecutionContextHost([input, context], OrdersTools, OrdersTools.prototype.find);
    host.setType('mcp');
    return McpExecutionContext.create(host);
  }

  it('is read by McpExecutionContext like a client call, with no session', () => {
    const mcp = executionContext({ orderId: 'ord_123' }, agent);
    expect(mcp.getType()).toBe('mcp');
    expect(mcp.getInput()).toEqual({ orderId: 'ord_123' });
    expect(mcp.getKind()).toBe('tool');
    expect(mcp.getName()).toBe('find-order');
    expect(mcp.getRequest()).toBe(request);
    expect(mcp.getAuthInfo()).toBeUndefined();
    expect(mcp.getSessionId()).toBeUndefined();
    const context = mcp.getContext();
    expect(context.transport === 'agent' && context.user).toEqual({ id: 'mia' });
  });

  it('narrows on transport in a method', () => {
    expect(new OrdersTools().find({ orderId: 'ord_123' }, agent)).toBe('ord_123 for mia');
  });
});
