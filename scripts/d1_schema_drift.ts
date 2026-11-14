/**
 * REMOTE D1 SCHEMA DRIFT CHECK (read-only)
 *
 * Delegates to `runD1SchemaDriftCheck` in `@wesdizzle/app-kit/scripts`.
 *
 * USAGE:
 *   npx tsx scripts/d1_schema_drift.ts          # exits 1 if remote is missing objects
 *   npx tsx scripts/d1_schema_drift.ts --report # always exits 0
 */

import { runD1SchemaDriftCheck } from '@wesdizzle/app-kit/scripts';

runD1SchemaDriftCheck();
