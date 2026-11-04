/**
 * NestJS Observe: with `@nestjs/observe` installed and its TracerService in the application, every MCP call names
 * the request's operation. The package is not a dependency, so it is stood in for here by a module of the same name
 * exporting the one class used.
 */
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as z from 'zod';
import { McpModule, Prompt, ResourceTemplate, Tool } from '../lib/index.js';
import { connectMcpClient } from '../lib/testing/index.js';

const { TracerService } = vi.hoisted(() => ({
  TracerService: class TracerService {
    readonly operations: string[] = [];
    setOperationId(operationId: string) {
      this.operations.push(operationId);
    }
  },
}));

vi.mock('@nestjs/observe', () => ({ TracerService }));

@Injectable()
class ObservedTools {
  @Tool({ description: 'Adds', inputSchema: z.object({ a: z.number(), b: z.number() }) })
  add({ a, b }: { a: number; b: number }) {
    return String(a + b);
  }

  @ResourceTemplate({ uriTemplate: 'notes://{id}' })
  note({ id }: { id: string }) {
    return id;
  }

  @Prompt({ description: 'Greets' })
  greet() {
    return 'Hello.';
  }
}

@Module({
  imports: [McpModule.forRoot({ name: 'observed', version: '1.0.0' })],
  providers: [ObservedTools, TracerService],
})
class ObservedModule {}

it('names the Observe operation after each MCP call', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [ObservedModule] }).compile();
  const client = await connectMcpClient(moduleRef);
  try {
    await client.callTool({ name: 'add', arguments: { a: 1, b: 2 } });
    await client.readResource({ uri: 'notes://42' });
    await client.getPrompt({ name: 'greet' });
    expect(moduleRef.get(TracerService).operations).toEqual([
      'tools/call add',
      'resources/read notes://{id}',
      'prompts/get greet',
    ]);
  } finally {
    await client.close();
    await moduleRef.close();
  }
});
