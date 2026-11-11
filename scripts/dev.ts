import { runHybridDev } from '@wesdizzle/app-kit/scripts';

runHybridDev({
  cwd: process.cwd(),
  banner: '--- Initializing Hybrid Development Environment ---',
  preCommands: [
    {
      label: '[Sync] Synchronizing local D1 database...',
      command: 'npm',
      args: ['run', 'sync-db'],
    },
  ],
  processes: [
    {
      name: 'API Proxy',
      command: 'npm',
      args: ['run', 'local-api'],
    },
    {
      name: 'Frontend',
      command: 'npm',
      args: ['start'],
    },
  ],
});
