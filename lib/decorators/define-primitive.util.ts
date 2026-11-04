import { MCP_PRIMITIVE_METADATA } from '../mcp.constants.js';
import type { McpPrimitiveMetadata } from '../interfaces/primitive-options.interface.js';

const DECORATORS: Record<McpPrimitiveMetadata['kind'], string> = {
  tool: '@Tool()',
  resource: '@Resource()',
  'resource-template': '@ResourceTemplate()',
  prompt: '@Prompt()',
};

/** Records `metadata` on the decorated method. A method serves one primitive. */
export function definePrimitive(metadata: McpPrimitiveMetadata): MethodDecorator {
  const decorator = DECORATORS[metadata.kind];
  return (target, key, descriptor) => {
    const method = descriptor.value;
    const where = `${typeof target === 'function' ? target.name : target.constructor.name}.${String(key)}`;
    if (typeof method !== 'function') {
      throw new TypeError(`${decorator} goes on a method, and ${where} is not one.`);
    }

    const existing: McpPrimitiveMetadata | undefined = Reflect.getOwnMetadata(MCP_PRIMITIVE_METADATA, method);
    if (existing) {
      throw new TypeError(
        `${where} has both ${DECORATORS[existing.kind]} and ${decorator}: a method serves one MCP primitive.`,
      );
    }
    Reflect.defineMetadata(MCP_PRIMITIVE_METADATA, metadata, method);
    return descriptor;
  };
}
