/**
 * D1 PRE-FLIGHT COST GUARD & LOCAL-FIRST DIFF ENGINE (collection-tracker)
 *
 * Delegates SQL migration sandbox cost auditing and chunked remote execution to
 * `@wesdizzle/app-kit/scripts` while binding `collection-tracker`'s local
 * baseline path (`data/remote_baseline.db`) and protected table list.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  auditSqlCost as kitAuditSqlCost,
  CostGuardReport,
  extractTargetTable,
  isCreateIndexStatement,
  isInsertOrReplaceStatement,
  isSecondaryIndexOrigin,
  loadDeployEnv,
  printCostReport,
  runWithD1CostGuard as kitRunWithD1CostGuard,
  splitSqlStatements,
  stripLeadingSqlComments,
  TableWriteCost,
} from '@wesdizzle/app-kit/scripts';

export type { CostGuardReport, TableWriteCost };
export {
  extractTargetTable,
  isCreateIndexStatement,
  isInsertOrReplaceStatement,
  isSecondaryIndexOrigin,
  printCostReport,
  splitSqlStatements,
  stripLeadingSqlComments,
};

export interface CostGuardOptions {
  sqlFilePath: string;
  maxWrites?: number;
  baselineDbPath?: string;
  isDryRun?: boolean;
  confirm?: boolean;
  executeRemote?: boolean;
  remoteDbName?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..', '..');

export const REMOTE_BASELINE_DB_PATH = path.join(
  rootDir,
  'data',
  'remote_baseline.db',
);

export const REMOTE_MIGRATIONS_LOG_PATH = path.join(
  rootDir,
  'data',
  'remote_migrations_log.json',
);

export const PROTECTED_TABLES = [
  'games',
  'toys',
  'game_releases',
  'canonical_releases',
  'users',
  'user_games',
  'user_toys',
  'user_game_releases',
  'journal_entries',
] as const;

export function auditSqlCost(
  sqlFilePath: string,
  maxAllowedWrites = 5000,
  baselineDbPath = REMOTE_BASELINE_DB_PATH,
): CostGuardReport {
  return kitAuditSqlCost(sqlFilePath, maxAllowedWrites, {
    baselineDbPath,
    protectedTables: PROTECTED_TABLES,
  });
}

export function runWithD1CostGuard(options: CostGuardOptions): CostGuardReport {
  const executeRemote = Boolean(
    options.executeRemote || (options.confirm && !options.isDryRun),
  );
  return kitRunWithD1CostGuard({
    sqlFilePath: options.sqlFilePath,
    maxWrites: options.maxWrites ?? 5000,
    executeRemote,
    remoteDbName: options.remoteDbName || 'collection-db',
    rootDir,
    baselineDbPath: options.baselineDbPath || REMOTE_BASELINE_DB_PATH,
    migrationsLogPath: REMOTE_MIGRATIONS_LOG_PATH,
    protectedTables: PROTECTED_TABLES,
    patchWranglerConfig: <T>(fn: () => T): T => {
      const wranglerPath = path.join(rootDir, 'wrangler.toml');
      const env = loadDeployEnv(rootDir);
      const d1DatabaseId = env['D1_DATABASE_ID']?.trim();
      if (!d1DatabaseId || d1DatabaseId === 'local-dev-db') {
        throw new Error(
          '[CostGuard] D1_DATABASE_ID is required in .dev.vars or environment variables for remote execution.',
        );
      }
      const originalWrangler = fs.readFileSync(wranglerPath, 'utf-8');
      if (!originalWrangler.includes('database_id = "local-dev-db"')) {
        throw new Error(
          '[CostGuard] Expected placeholder database_id = "local-dev-db" in wrangler.toml.',
        );
      }
      const patchedWrangler = originalWrangler.replace(
        'database_id = "local-dev-db"',
        `database_id = "${d1DatabaseId}"`,
      );
      try {
        fs.writeFileSync(wranglerPath, patchedWrangler, 'utf-8');
        return fn();
      } finally {
        fs.writeFileSync(wranglerPath, originalWrangler, 'utf-8');
      }
    },
  });
}

function parseArgs(): CostGuardOptions {
  const args = process.argv.slice(2);
  let sqlFilePath = '';
  let maxWrites = 5000;
  let confirm = false;
  let isDryRun = true;

  for (const arg of args) {
    if (arg.startsWith('--file=')) {
      sqlFilePath = arg.slice(7);
    } else if (arg.startsWith('--max-writes=')) {
      maxWrites = parseInt(arg.slice(13), 10);
    } else if (arg === '--confirm') {
      confirm = true;
      isDryRun = false;
    } else if (arg === '--dry-run') {
      isDryRun = true;
      confirm = false;
    }
  }

  if (!sqlFilePath) {
    console.error(
      'Usage: npx tsx scripts/lib/d1_cost_guard.ts --file=<sql-path> [--max-writes=<N>] [--confirm | --dry-run]',
    );
    process.exit(1);
  }

  return { sqlFilePath, maxWrites, confirm, isDryRun };
}

const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  try {
    const opts = parseArgs();
    runWithD1CostGuard(opts);
  } catch (err) {
    console.error('Fatal Cost Guard Error:', err);
    process.exit(1);
  }
}
