/**
 * HYBRID DEVELOPMENT ORCHESTRATOR
 * 
 * This script is the single entry point for local development. It manages the 
 * lifecycle of three concurrent servers and ensures the database is correctly
 * synchronized before the API becomes active.
 */

const { spawn } = require('child_process');
const path = require('path');

/**
 * Spawns a child process with 'inherit' stdio to preserve color/formatting.
 * @param {string} name - Human-readable name for logging.
 * @param {string} command - The command to run.
 * @param {string[]} args - Arguments for the command.
 */
function startProcess(name, command, args) {
    console.log(`[${name}] Starting...`);
    const proc = spawn(command, args, { stdio: 'inherit', shell: true });
    
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
    const { execSync } = require('child_process');
    console.log('[Sync] Synchronizing database...');
    // Run synchronously to ensure data is ready before servers start
    execSync('node scripts/sync_local_d1.js', { stdio: 'inherit' });
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

const processes = [
    startProcess('API Proxy', 'node', ['scripts/local_server.js']),
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
