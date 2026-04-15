const { spawn } = require('child_process');
const path = require('path');

function startProcess(name, command, args) {
    console.log(`[${name}] Starting...`);
    const proc = spawn(command, args, { stdio: 'inherit', shell: true });
    
    proc.on('close', (code) => {
        console.log(`[${name}] Process exited with code ${code}`);
    });
    
    return proc;
}

console.log('--- Initializing Hybrid Development Environment ---');

// 1. Run sync
try {
    const { execSync } = require('child_process');
    console.log('[Sync] Synchronizing database...');
    execSync('node scripts/sync_local_d1.js', { stdio: 'inherit' });
} catch (e) {
    console.error('[Sync] Failed. Continuing anyway...');
}

// 2. Start all processes
const wranglerBin = path.join('node_modules', 'wrangler', 'bin', 'wrangler.js');
const ngBin = path.join('node_modules', '@angular', 'cli', 'bin', 'ng.js');

const processes = [
    startProcess('API Proxy', 'node', ['scripts/local_server.js']),
    startProcess('D1 Worker', 'node', [wranglerBin, 'dev', '--local']),
    startProcess('Frontend ', 'node', [ngBin, 'serve'])
];

// Handle cleanup
process.on('SIGINT', () => {
    console.log('\n--- Shutting down dev environment ---');
    processes.forEach(p => p.kill('SIGINT'));
    process.exit();
});
