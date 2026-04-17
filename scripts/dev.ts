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
    console.log(`[${name}] Starting: ${command} ${args.join(' ')}`);
    
    let resolvedCommand = command;
    if (process.platform === 'win32') {
        if (command === 'npx') resolvedCommand = 'npx.cmd';
        if (command === 'npm') resolvedCommand = 'npm.cmd';
    }

    const proc = spawn(resolvedCommand, args, { 
        stdio: 'inherit', 
        shell: true
    });
    
    proc.on('error', (err) => {
        console.error(`[${name}] Spawn error: ${err.message}`);
    });

    proc.on('close', (code) => {
        console.log(`[${name}] Process exited with code ${code}`);
    });
    
    return proc;
}

console.log('--- Initializing Hybrid Development Environment ---');

/**
 * STEP 1: Database Synchronization
 */
try {
    const syncCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    console.log('[Sync] Synchronizing local D1 database...');
    execSync(`${syncCommand} tsx scripts/sync_local_d1.ts`, { stdio: 'inherit' });
} catch (e) {
    console.error('[Sync] Failed. Continuing anyway...');
}

/**
 * STEP 2: Parallel Server Launch
 */
const processes: ChildProcess[] = [
    startProcess('API Proxy', 'npx', ['tsx', 'scripts/local_server.ts']),
    startProcess('Frontend ', 'npx', ['ng', 'serve'])
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
