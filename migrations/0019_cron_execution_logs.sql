-- Migration: 0019_cron_execution_logs.sql
-- Description: Creates persistent cron_execution_logs table and index for background job observability.

CREATE TABLE IF NOT EXISTS cron_execution_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_name TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    summary TEXT,
    details_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cron_logs_job_date ON cron_execution_logs (job_name, created_at DESC);
