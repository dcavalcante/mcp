import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Compiles the stdio fixture app (tests/fixtures/stdio, with the library sources it imports) to tests/.tmp/stdio,
 * for the stdio specs to spawn as a real child process: Node runs no TypeScript decorators of its own.
 */
export default function setup() {
  const project = join(root, 'tests/fixtures/stdio/tsconfig.json');
  if (!existsSync(project)) {
    return;
  }
  // `typescript/bin/tsc` is not in the package's exports map.
  const tsc = join(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin/tsc');
  execFileSync(process.execPath, [tsc, '-p', project], { cwd: root, stdio: 'inherit' });
}
