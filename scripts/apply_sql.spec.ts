import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { applySqlFile } from './apply_sql.js';

describe('applySqlFile', () => {
  const testDir = path.resolve(
    process.cwd(),
    'scripts',
    'temp',
    'test_sql_apply',
  );
  const testDbPath = path.join(testDir, 'test.sqlite');
  const testSqlPath = path.join(testDir, 'test_migration.sql');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });

    // Initialize minimal test sqlite database
    const db = new Database(testDbPath);
    db.exec(`
      CREATE TABLE test_items (
        id INTEGER PRIMARY KEY,
        name TEXT,
        val INTEGER
      );
      INSERT INTO test_items (id, name, val) VALUES (1, 'Alpha', 10);
      INSERT INTO test_items (id, name, val) VALUES (2, 'Beta', 20);
    `);
    db.close();

    // Create test SQL file
    fs.writeFileSync(
      testSqlPath,
      `
      UPDATE test_items SET val = 99 WHERE id = 1;
      INSERT INTO test_items (id, name, val) VALUES (3, 'Gamma', 30);
    `,
      'utf8',
    );
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('supports dry-run mode without modifying the database', () => {
    const result = applySqlFile(testSqlPath, {
      dryRun: true,
      dbPath: testDbPath,
    });

    expect(result.statementCount).toBe(2);

    const db = new Database(testDbPath);
    const row = db.prepare('SELECT val FROM test_items WHERE id = 1').get() as {
      val: number;
    };
    expect(row.val).toBe(10); // Unchanged!
    db.close();
  });

  it('applies SQL statements atomically to the target database', () => {
    const result = applySqlFile(testSqlPath, {
      dryRun: false,
      dbPath: testDbPath,
    });

    expect(result.statementCount).toBe(2);

    const db = new Database(testDbPath);
    const row1 = db
      .prepare('SELECT val FROM test_items WHERE id = 1')
      .get() as { val: number };
    expect(row1.val).toBe(99);

    const row3 = db
      .prepare('SELECT name, val FROM test_items WHERE id = 3')
      .get() as { name: string; val: number };
    expect(row3).toEqual({ name: 'Gamma', val: 30 });
    db.close();
  });

  it('throws an error if the SQL file does not exist', () => {
    expect(() =>
      applySqlFile(path.join(testDir, 'nonexistent.sql'), {
        dbPath: testDbPath,
      }),
    ).toThrow('SQL file not found');
  });
});
