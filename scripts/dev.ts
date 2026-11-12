import * as fs from 'fs';
import * as path from 'path';
import { runHybridDev } from '@wesdizzle/app-kit/scripts';

const rootDir = process.cwd();
fs.mkdirSync(path.join(rootDir, 'dist', 'tracker', 'browser'), {
  recursive: true,
});

runHybridDev({
  cwd: rootDir,
  banner: '--- Initializing Hybrid Development Environment ---',
  preCommands: [
    {
      label: '[D1] Ensuring local D1 schema is initialized...',
      command: 'npx',
      args: [
        'wrangler',
        'd1',
        'execute',
        'collection-db',
        '--local',
        '--file=migrations/schema.sql',
      ],
    },
  ],
  processes: [
    {
      name: 'Wrangler Worker',
      command: 'npx',
      args: ['wrangler', 'dev', '--local', '--port', '8787'],
    },
    {
      name: 'Frontend',
      command: 'npm',
      args: ['start'],
    },
  ],
});
