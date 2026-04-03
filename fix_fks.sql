-- =============================================
-- Fix Broken Foreign Keys Migration
-- =============================================

PRAGMA foreign_keys = OFF;

-- 1. Fix Retailers
ALTER TABLE retailers RENAME TO _retailers_old;
CREATE TABLE retailers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  address TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO retailers (id, name, email, phone, address, user_id, created_at, updated_at)
SELECT id, name, email, phone, address, user_id, created_at, updated_at FROM _retailers_old;
DROP TABLE _retailers_old;

-- 2. Fix Orders
ALTER TABLE orders RENAME TO _orders_old;
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  salesperson_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  retailer_id INTEGER NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  total_amount REAL NOT NULL DEFAULT 0,
  total_profit REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO orders (id, salesperson_id, retailer_id, status, total_amount, total_profit, notes, created_at, updated_at)
SELECT id, salesperson_id, retailer_id, status, total_amount, total_profit, notes, created_at, updated_at FROM _orders_old;
DROP TABLE _orders_old;

-- 3. Fix Order Items
ALTER TABLE order_items RENAME TO _order_items_old;
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  purchase_price REAL NOT NULL CHECK(purchase_price >= 0),
  selling_price REAL NOT NULL CHECK(selling_price >= 0),
  profit REAL GENERATED ALWAYS AS ((selling_price - purchase_price) * quantity) VIRTUAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO order_items (id, order_id, product_id, quantity, purchase_price, selling_price, created_at)
SELECT id, order_id, product_id, quantity, purchase_price, selling_price, created_at FROM _order_items_old;
DROP TABLE _order_items_old;

-- 4. Fix Notifications
ALTER TABLE notifications RENAME TO _notifications_old;
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info' CHECK(type IN ('info', 'success', 'warning', 'error')),
  is_read INTEGER NOT NULL DEFAULT 0,
  related_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO notifications (id, user_id, title, message, type, is_read, related_order_id, created_at)
SELECT id, user_id, title, message, type, is_read, related_order_id, created_at FROM _notifications_old;
DROP TABLE _notifications_old;

PRAGMA foreign_keys = ON;
