import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, ExternalContextCreator, MetadataScanner } from '@nestjs/core';
import { McpParamsFactory, recordHandlerParams } from '../context/mcp-params.js';
import type { McpContext } from '../interfaces/mcp-context.interface.js';
import type { McpModuleOptions } from '../interfaces/mcp-module-options.interface.js';
import type {
  McpPrimitiveMetadata,
  McpSchema,
  PromptOptions,
  ResourceOptions,
  ResourceTemplateOptions,
  ToolOptions,
} from '../interfaces/primitive-options.interface.js';
import {
  MCP_CONTEXT_TYPE,
  MCP_HTTP_ENDPOINT,
  MCP_MODULE_OPTIONS,
  MCP_PARAMS_METADATA,
  MCP_PRIMITIVE_METADATA,
} from '../mcp.constants.js';
import { assertName, assertScopes, assertToolName } from '../utils/names.util.js';
import { prepareSchema } from '../utils/schema.util.js';

/** A method behind Nest's enhancers: called as `(input, context)`. */
export type McpHandler = (input: unknown, context: McpContext) => Promise<unknown>;

interface Entry<TOptions> {
  name: string;
  options: TOptions;
  handler: McpHandler;
  /** `Class.method`, for messages. */
  where: string;
}

export interface McpToolEntry extends Entry<ToolOptions> {
  inputSchema?: McpSchema;
  outputSchema?: McpSchema;
}

export interface McpResourceEntry extends Entry<ResourceOptions> {
  uri: string;
}

export interface McpResourceTemplateEntry extends Entry<ResourceTemplateOptions> {
  uriTemplate: string;
}

export interface McpPromptEntry extends Entry<PromptOptions> {
  argsSchema?: McpSchema;
}

/**
 * The application's tools, resources and prompts, found once at startup on the providers of the application (or of
 * the `include` modules), each with its method wrapped by Nest's enhancers. The servers built per request or per
 * connection register these.
 */
@Injectable()
export class McpRegistry implements OnModuleInit {
  readonly tools: McpToolEntry[] = [];
  readonly resources: McpResourceEntry[] = [];
  readonly resourceTemplates: McpResourceTemplateEntry[] = [];
  readonly prompts: McpPromptEntry[] = [];

  private readonly paramsFactory = new McpParamsFactory();
  private scanned = false;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly externalContextCreator: ExternalContextCreator,
    @Inject(MCP_MODULE_OPTIONS) private readonly options: McpModuleOptions,
    @Inject(MCP_HTTP_ENDPOINT) private readonly endpoint: { path: string | null },
  ) {}

  onModuleInit() {
    this.scan();
  }

  /** How many primitives there are. */
  get size(): number {
    return this.tools.length + this.resources.length + this.resourceTemplates.length + this.prompts.length;
  }

  /** Finds the primitives, once. */
  scan(): void {
    if (this.scanned) {
      return;
    }

    const seen = new Set<object>();
    const wrappers = this.discovery.getProviders(this.options.include ? { include: this.options.include } : undefined);
    for (const wrapper of wrappers) {
      const { instance } = wrapper;
      if (!instance || typeof instance !== 'object' || wrapper.isAlias || seen.has(instance)) {
        continue;
      }
      seen.add(instance);

      const prototype = Object.getPrototypeOf(instance);
      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const method = prototype[methodName];
        const metadata: McpPrimitiveMetadata | undefined = Reflect.getMetadata(MCP_PRIMITIVE_METADATA, method);
        if (!metadata) {
          continue;
        }

        const where = `${wrapper.metatype?.name ?? instance.constructor.name}.${methodName}`;
        if (!wrapper.isDependencyTreeStatic()) {
          throw new Error(
            `${where}: MCP tools, resources and prompts must be on singleton providers, and this one is ` +
              'request-scoped or transient (or depends on a request-scoped provider). Request-scoped providers are not ' +
              'supported yet.',
          );
        }

        recordHandlerParams(instance.constructor, methodName);
        const handler = this.externalContextCreator.create(
          instance,
          method,
          methodName,
          MCP_PARAMS_METADATA,
          this.paramsFactory,
          undefined,
          undefined,
          undefined,
          MCP_CONTEXT_TYPE,
        ) as McpHandler;
        this.add(metadata, methodName, where, handler);
      }
    }

    this.assertScopesAreEnforced();
    this.scanned = true;
  }

  private add(metadata: McpPrimitiveMetadata, methodName: string, where: string, handler: McpHandler) {
    assertScopes(metadata.options.scopes, where);
    switch (metadata.kind) {
      case 'tool': {
        const { options } = metadata;
        const name = options.name ?? methodName;
        assertToolName(name, where);
        this.assertUnique(this.tools, name, where, 'tool');
        this.tools.push({
          name,
          options,
          handler,
          where,
          inputSchema: options.inputSchema && prepareSchema(options.inputSchema, `${where} inputSchema`, 'input'),
          outputSchema: options.outputSchema && prepareSchema(options.outputSchema, `${where} outputSchema`, 'output'),
        });
        return;
      }
      case 'resource': {
        const { options } = metadata;
        const name = options.name ?? methodName;
        assertName(name, where, 'resource');
        const uri = new URL(options.uri).href;
        const existing = this.resources.find((entry) => entry.uri === uri);
        if (existing) {
          throw new Error(`${where}: the resource "${uri}" is already served by ${existing.where}.`);
        }
        this.resources.push({ name, options, handler, where, uri });
        return;
      }
      case 'resource-template': {
        const { options } = metadata;
        const name = options.name ?? methodName;
        assertName(name, where, 'resource template');
        this.assertUnique(this.resourceTemplates, name, where, 'resource template');
        const existing = this.resourceTemplates.find((entry) => entry.uriTemplate === options.uriTemplate);
        if (existing) {
          throw new Error(`${where}: the URI template "${options.uriTemplate}" is already served by ${existing.where}.`);
        }
        this.resourceTemplates.push({ name, options, handler, where, uriTemplate: options.uriTemplate });
        return;
      }
      case 'prompt': {
        const { options } = metadata;
        const name = options.name ?? methodName;
        assertName(name, where, 'prompt');
        this.assertUnique(this.prompts, name, where, 'prompt');
        this.prompts.push({
          name,
          options,
          handler,
          where,
          argsSchema: options.argsSchema && prepareSchema(options.argsSchema, `${where} argsSchema`, 'input'),
        });
        return;
      }
    }
  }

  private assertUnique(entries: Entry<unknown>[], name: string, where: string, what: string) {
    const existing = entries.find((entry) => entry.name === name);
    if (existing) {
      throw new Error(`${where}: there is already a ${what} named "${name}" (${existing.where}). Give one of them another { name }.`);
    }
  }

  /**
   * The SDK checks `scopes` only against a verified token, and lets a request without one through: scopes declared
   * on an HTTP endpoint without `auth` would protect nothing.
   */
  private assertScopesAreEnforced() {
    if (this.options.auth || this.endpoint.path === null) {
      return;
    }
    const scoped = [...this.tools, ...this.resources, ...this.resourceTemplates, ...this.prompts].find(
      (entry) => (entry.options as { scopes?: string[] }).scopes,
    );
    if (scoped) {
      throw new Error(
        `${scoped.where} declares { scopes }, which are only checked against a verified access token. Configure the ` +
          "McpModule `auth` option, or set `path: false` if the application serves stdio only.",
      );
    }
  }
}
