/**
 * HYBRID DEVELOPMENT ORCHESTRATOR (TS)
 * 
 * This script is the single entry point for local development. It manages the 
 * lifecycle of three concurrent servers and ensures the database is correctly
 * synchronized before the API becomes active.
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import * as path from 'path';

/**
 * Spawns a child process with 'inherit' stdio to preserve color/formatting.
 * @param name - Human-readable name for logging.
 * @param command - The command to run.
 * @param args - Arguments for the command.
 */
function startProcess(name: string, command: string, args: string[]): ChildProcess {
    console.log(`[${name}] Starting...`);
    const resolvedCommand = process.platform === 'win32' && command === 'npx' ? 'npx.cmd' : command;
    const proc = spawn(resolvedCommand, args, { stdio: 'inherit', shell: true });
    
    proc.on('close', (code) => {
        console.log(`[${name}] Process exited with code ${code}`);
    });
    
    return proc;
}

console.log('--- Initializing Hybrid Development Environment ---');

/**
 * STEP 1: Database Synchronization
 * We MUST sync the source-of-truth 'collection.sqlite' to the Wrangler internal state
 * folder BEFORE the worker starts, otherwise the API would be serving stale or empty data.
 */
try {
    const syncCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    execSync(`${syncCommand} tsx scripts/sync_local_d1.ts`, { stdio: 'inherit' });
} catch (e) {
    console.error('[Sync] Failed. Continuing anyway...');
}

/**
 * STEP 2: Parallel Server Launch
 * We launch three distinct layers:
 * 1. API Proxy: Handles local filesystem tasks (Discovery) and proxies to Wrangler.
 * 2. D1 Worker: Runs the actual production API logic via local Wrangler.
 * 3. Frontend: The Angular SPA.
 */
const wranglerBin = path.join('node_modules', 'wrangler', 'bin', 'wrangler.js');
const ngBin = path.join('node_modules', '@angular', 'cli', 'bin', 'ng.js');

const processes: ChildProcess[] = [
    // Use npx tsx for local TypeScript scripts
    startProcess('API Proxy', 'npx', ['tsx', 'scripts/local_server.ts']),
    startProcess('D1 Worker', 'node', [wranglerBin, 'dev', '--local']),
    startProcess('Frontend ', 'node', [ngBin, 'serve'])
];

/**
 * STEP 3: Graceful Shutdown
 * Capture Ctrl+C (SIGINT) and ensure all child processes are killed
 * to prevent port-in-use errors on the next run.
 */
process.on('SIGINT', () => {
    console.log('\n--- Shutting down dev environment ---');
    processes.forEach(p => p.kill('SIGINT'));
    process.exit();
});
