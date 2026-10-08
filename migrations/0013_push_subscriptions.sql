-- Migration: 0013_push_subscriptions.sql
-- Description: Creates push_subscriptions table for user-configurable PWA deal notifications.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subs_created ON push_subscriptions (created_at);
