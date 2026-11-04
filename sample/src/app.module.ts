import { Module } from '@nestjs/common';
import { McpModule } from '@nestjs/mcp';
import { NotesModule } from './notes/notes.module.js';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'notes',
      version: '1.0.0',
      instructions: 'Save notes with `add`, find them with `search`, read one at notes://{id}.',
      // Bound to localhost below: refuse other Host headers (DNS rebinding).
      http: { allowedHosts: ['localhost', '127.0.0.1', '[::1]'] },
    }),
    NotesModule,
  ],
})
export class AppModule {}
