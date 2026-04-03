-- Migration: Add is_active to retailers for soft delete support
ALTER TABLE retailers ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_retailers_is_active ON retailers(is_active);
