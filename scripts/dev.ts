/**
 * HYBRID DEVELOPMENT ORCHESTRATOR (TS)
 * 
 * This script is the single entry point for local development. It manages the 
 * lifecycle of three concurrent servers and ensures the database is correctly
 * synchronized before the API becomes active.
 */

import { spawn, execSync, ChildProcess } from 'child_process';

/**
 * Spawns a child process with 'inherit' stdio to preserve color/formatting.
 * @param name - Human-readable name for logging.
 * @param command - The command to run.
 * @param args - Arguments for the command.
 */
function startProcess(name: string, command: string, args: string[]): ChildProcess {
    console.log(`[${name}] Starting: ${command} ${args.join(' ')}`);
    
    const isWin = process.platform === 'win32';
    const proc = isWin 
        ? spawn('cmd.exe', ['/c', `${command} ${args.join(' ')}`], { stdio: 'inherit' })
        : spawn(command, args, { stdio: 'inherit', shell: true });
    
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
    console.log('[Sync] Synchronizing local D1 database...');
    const isWin = process.platform === 'win32';
    if (isWin) {
        execSync(`cmd.exe /c npx.cmd tsx scripts/sync_local_d1.ts`, { stdio: 'inherit' });
    } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        execSync(`npx tsx scripts/sync_local_d1.ts`, { stdio: 'inherit', shell: true } as any);
    }
} catch (e) {
    console.error('[Sync] Failed. Continuing anyway...', e);
}

/**
 * STEP 2: Parallel Server Launch
 */
const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const processes: ChildProcess[] = [
    startProcess('API Proxy', cmd, ['tsx', 'scripts/local_server.ts']),
    startProcess('Frontend ', cmd, ['ng', 'serve'])
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
