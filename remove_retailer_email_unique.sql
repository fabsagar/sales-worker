-- Migration: Remove UNIQUE constraint from retailers.email
-- 0. Disable foreign keys temporarily
PRAGMA foreign_keys = OFF;

-- 1. Create new table without UNIQUE constraint
CREATE TABLE IF NOT EXISTS retailers_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Copy data
INSERT INTO retailers_new (id, name, email, phone, address, user_id, is_active, created_at, updated_at)
SELECT id, name, email, phone, address, user_id, is_active, created_at, updated_at FROM retailers;

-- 3. Drop old table
DROP TABLE retailers;

-- 4. Rename new table
ALTER TABLE retailers_new RENAME TO retailers;

-- 5. Re-create indexes
CREATE INDEX IF NOT EXISTS idx_retailers_user_id ON retailers(user_id);
CREATE INDEX IF NOT EXISTS idx_retailers_created_at ON retailers(created_at);
CREATE INDEX IF NOT EXISTS idx_retailers_is_active ON retailers(is_active);

-- 6. Re-enable foreign keys
PRAGMA foreign_keys = ON;
