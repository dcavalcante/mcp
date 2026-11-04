import { Module } from '@nestjs/common';
import { McpModule } from '../../../lib/index.js';
import { NotesService } from './notes.service.js';
import { NotesTools } from './notes.tools.js';

@Module({
  imports: [McpModule.forRoot({ name: 'notes', version: '1.0.0', instructions: 'Notes, by id.' })],
  providers: [NotesService, NotesTools],
})
export class NotesAppModule {}
