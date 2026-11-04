import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { McpStdioLogger, McpStdioServer } from '../../../lib/index.js';
import { StdioAppModule } from './stdio.module.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(StdioAppModule, { logger: new McpStdioLogger() });
  await app.get(McpStdioServer).listen();
  await app.close();
}

void bootstrap();
