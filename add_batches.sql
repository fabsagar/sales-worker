-- Migration: Add Product Stock Batches & FIFO Support

CREATE TABLE IF NOT EXISTS product_stock_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    remaining_quantity INTEGER NOT NULL CHECK(remaining_quantity >= 0),
    purchase_price REAL NOT NULL CHECK(purchase_price >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stock_entries_product_id ON product_stock_entries(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_entries_remaining ON product_stock_entries(remaining_quantity);

-- Seed existing stock as a single batch for each product
INSERT INTO product_stock_entries (product_id, quantity, remaining_quantity, purchase_price)
SELECT id, stock_quantity, stock_quantity, purchase_price 
FROM products 
WHERE stock_quantity > 0;
