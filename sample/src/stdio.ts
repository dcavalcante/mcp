import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { McpStdioLogger, McpStdioServer } from '@nestjs/mcp';
import { AppModule } from './app.module.js';

/** stdio, for a host that launches the server: `node sample/dist/stdio.js`. */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: new McpStdioLogger() });
  await app.get(McpStdioServer).listen();
  await app.close();
}

void bootstrap();
