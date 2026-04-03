import { errorResponse, successResponse, validateRequired, validateNumber, sanitizeString } from '../utils/helpers.js';
import { requireAdmin, requireSalesperson } from '../middleware/auth.js';

// POST /api/orders
export async function handleCreateOrder(request, env, user) {
    try {
        const deniedRole = requireSalesperson(user);
        if (deniedRole) return deniedRole;

        let body;
        try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

        console.log(`[Order] Creating order for retailer ${body.retailer_id} by user ${user.id}`);

        const missing = validateRequired(body, ['retailer_id', 'items']);
        if (missing) return errorResponse(missing);

        if (!Array.isArray(body.items) || body.items.length === 0) {
            return errorResponse('Order must have at least one item');
        }

        // Step 1: Validate retailer and fetch all products
        const retailerId = parseInt(body.retailer_id);
        const retailer = await env.DB.prepare('SELECT id FROM retailers WHERE id = ?').bind(retailerId).first();
        if (!retailer) return errorResponse('Retailer not found', 404);

        const productIds = body.items.map(i => parseInt(i.product_id)).filter(id => !isNaN(id));
        if (productIds.length === 0) return errorResponse('No valid product IDs provided');

        const idPlaceholders = productIds.map(() => '?').join(',');
        const productsRes = await env.DB.prepare(
            `SELECT id, name, purchase_price, stock_quantity FROM products WHERE id IN (${idPlaceholders}) AND is_active = 1`
        ).bind(...productIds).all();

        const productMap = new Map(productsRes.results.map(p => [Number(p.id), p]));

        // Step 1.5: Fetch active batches for FIFO
        const batchesRes = await env.DB.prepare(
            `SELECT * FROM product_stock_entries WHERE product_id IN (${idPlaceholders}) AND remaining_quantity > 0 ORDER BY created_at ASC`
        ).bind(...productIds).all();
        const batchMap = new Map();
        for (const b of batchesRes.results) {
            if (!batchMap.has(Number(b.product_id))) batchMap.set(Number(b.product_id), []);
            batchMap.get(Number(b.product_id)).push(b);
        }

        // Step 2: Validate items and compute totals
        let totalAmount = 0;
        let totalProfit = 0;
        const processedItems = [];

        for (const item of body.items) {
            const itemMissing = validateRequired(item, ['product_id', 'quantity', 'selling_price']);
            if (itemMissing) return errorResponse(`Item validation error: ${itemMissing}`);

            const pid = Number(item.product_id);
            const product = productMap.get(pid);
            if (!product) return errorResponse(`Product ${pid} not found or inactive`, 404);

            const qty = parseInt(item.quantity);
            if (isNaN(qty) || qty < 1) return errorResponse(`Invalid quantity for product ${product.name}`);
            if (product.stock_quantity < qty) {
                return errorResponse(`Insufficient stock for "${product.name}". Available: ${product.stock_quantity}`);
            }

            const sellingPrice = parseFloat(item.selling_price);
            if (isNaN(sellingPrice) || sellingPrice < 0) return errorResponse(`Invalid price for product ${product.name}`);

            // FIFO Consumption
            let remainingToConsume = qty;
            let totalCostForThisItem = 0;
            const batchesUsed = []; // {batchId, qtyTaken}
            const productBatches = batchMap.get(pid) || [];

            for (const batch of productBatches) {
                if (remainingToConsume <= 0) break;
                const take = Math.min(batch.remaining_quantity, remainingToConsume);
                totalCostForThisItem += take * batch.purchase_price;
                batchesUsed.push({ id: batch.id, quantity: take });
                batch.remaining_quantity -= take;
                remainingToConsume -= take;
            }

            if (remainingToConsume > 0) {
                return errorResponse(`Insufficient batch stock for "${product.name}" despite total stock being enough. This is a data integrity error.`);
            }

            const avgPurchasePrice = totalCostForThisItem / qty;
            const profit = (sellingPrice * qty) - totalCostForThisItem;

            totalAmount += sellingPrice * qty;
            totalProfit += profit;

            processedItems.push({
                product_id: product.id,
                product_name: product.name,
                quantity: qty,
                purchase_price: avgPurchasePrice,
                selling_price: sellingPrice,
                profit,
                batchesUsed
            });
        }

        // Step 3: Insert order
        const orderStmt = env.DB.prepare(
            `INSERT INTO orders (salesperson_id, retailer_id, total_amount, total_profit, notes, status)
          VALUES (?, ?, ?, ?, ?, 'approved')`
        ).bind(user.id, retailerId, totalAmount, totalProfit, sanitizeString(body.notes || '', 500));

        const orderResult = await orderStmt.run();
        const orderId = orderResult.meta.last_row_id;

        // Step 4: Batch remaining operations
        const batchStatements = [];
        for (const item of processedItems) {
            const itemStmt = env.DB.prepare(
                'INSERT INTO order_items (order_id, product_id, quantity, purchase_price, selling_price) VALUES (?, ?, ?, ?, ?)'
            ).bind(orderId, item.product_id, item.quantity, item.purchase_price, item.selling_price);
            
            batchStatements.push(itemStmt);
            
            // 4b. Update product stock entries (batches)
            for (const b of item.batchesUsed) {
                batchStatements.push(
                    env.DB.prepare('UPDATE product_stock_entries SET remaining_quantity = remaining_quantity - ? WHERE id = ?')
                        .bind(b.quantity, b.id)
                );
            }

            // 4c. Update main product stock
            batchStatements.push(
                env.DB.prepare("UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = datetime('now') WHERE id = ?")
                    .bind(item.quantity, item.product_id)
            );
        }

        const admins = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all();
        console.log(`[Order] Notifying ${admins.results.length} admins...`);
        for (const admin of admins.results) {
            batchStatements.push(
                env.DB.prepare(
                    `INSERT INTO notifications (user_id, title, message, type, related_order_id, target_role)
             VALUES (?, ?, ?, 'success', ?, 'admin')`
                ).bind(
                    admin.id,
                    'New Order Received',
                    `${user.name} submitted a new order #${orderId} for ₹${totalAmount.toFixed(2)}`,
                    orderId
                )
            );
        }

        // Also notify the salesperson who created it
        batchStatements.push(
            env.DB.prepare(
                `INSERT INTO notifications (user_id, title, message, type, related_order_id, target_role)
         VALUES (?, ?, ?, 'success', ?, 'salesperson')`
            ).bind(
                user.id,
                'Order Placed Successfully',
                `Your order #${orderId} has been registered and approved. Total: ₹${totalAmount.toFixed(2)}`,
                orderId
            )
        );

        if (batchStatements.length > 0) {
            console.log(`[Order] Executing batch of ${batchStatements.length} statements...`);
            await env.DB.batch(batchStatements);
        }

        const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
        console.log(`[Order] Successfully created order ${orderId}`);
        return successResponse({ order, orderId }, 'Order created successfully');

    } catch (err) {
        console.error(`[Order] Exception:`, err);
        return errorResponse(`Failed to create order: ${err.message}`, 500);
    }
}

// GET /api/orders
export async function handleGetOrders(request, env, user) {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || '';
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
    const offset = (page - 1) * limit;

    let query = `
    SELECT o.*, 
           u.name as salesperson_name, 
           r.name as retailer_name
    FROM orders o
    JOIN users u ON o.salesperson_id = u.id
    JOIN retailers r ON o.retailer_id = r.id
    WHERE 1=1
  `;
    const params = [];

    // Salesperson sees only their own orders
    if (user.role === 'salesperson') {
        query += ' AND o.salesperson_id = ?';
        params.push(user.id);
    }

    // Retailer sees orders for their retailer profile
    if (user.role === 'retailer') {
        const retailer = await env.DB.prepare('SELECT id FROM retailers WHERE user_id = ?').bind(user.id).first();
        if (!retailer) return successResponse({ orders: [], pagination: {} });
        query += ' AND o.retailer_id = ?';
        params.push(retailer.id);
    }

    if (status) {
        query += ' AND o.status = ?';
        params.push(status);
    }

    const countQuery = query.replace(
        'SELECT o.*, \n           u.name as salesperson_name, \n           r.name as retailer_name',
        'SELECT COUNT(*) as total'
    );
    const totalResult = await env.DB.prepare(countQuery).bind(...params).first();
    const total = totalResult?.total || 0;

    query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const { results: orders } = await env.DB.prepare(query).bind(...params).all();

    return successResponse({
        orders,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
}

// GET /api/orders/:id
export async function handleGetOrder(request, env, user, params) {
    const order = await env.DB.prepare(`
    SELECT o.*, u.name as salesperson_name, r.name as retailer_name, r.email as retailer_email, r.phone as retailer_phone, r.address as retailer_address
    FROM orders o
    JOIN users u ON o.salesperson_id = u.id
    JOIN retailers r ON o.retailer_id = r.id
    WHERE o.id = ?
  `).bind(params.id).first();

    if (!order) return errorResponse('Order not found', 404);

    // Check access
    if (user.role === 'salesperson' && order.salesperson_id !== user.id) {
        return errorResponse('Access denied', 403);
    }

    const { results: items } = await env.DB.prepare(`
    SELECT oi.*, p.name as product_name, p.category, p.image_url
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = ?
  `).bind(params.id).all();

    return successResponse({ order, items });
}

// PUT /api/orders/:id/status
export async function handleUpdateOrderStatus(request, env, user, params) {
    const denied = requireAdmin(user);
    if (denied) return denied;

    let body;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

    const missing = validateRequired(body, ['status']);
    if (missing) return errorResponse(missing);

    const validStatuses = ['pending', 'approved', 'rejected'];
    if (!validStatuses.includes(body.status)) return errorResponse('Invalid status');

    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(params.id).first();
    if (!order) return errorResponse('Order not found', 404);

    await env.DB.prepare(
        "UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(body.status, params.id).run();

    // Notify salesperson
    const statusIcon = body.status === 'approved' ? '✅' : '❌';
    await env.DB.prepare(
        `INSERT INTO notifications (user_id, title, message, type, related_order_id)
     VALUES (?, ?, ?, ?, ?)`
    ).bind(
        order.salesperson_id,
        `Order #${params.id} ${body.status.charAt(0).toUpperCase() + body.status.slice(1)}`,
        `${statusIcon} Your order #${params.id} has been ${body.status} by admin.`,
        body.status === 'approved' ? 'success' : 'error',
        params.id
    ).run();

    // If rejected, restore stock
    if (body.status === 'rejected' && order.status !== 'rejected') {
        const { results: items } = await env.DB.prepare(
            'SELECT product_id, quantity, purchase_price FROM order_items WHERE order_id = ?'
        ).bind(params.id).all();

        const restoreStmts = [];
        for (const item of items) {
            // Restore to main stock
            restoreStmts.push(
                env.DB.prepare(
                    "UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = datetime('now') WHERE id = ?"
                ).bind(item.quantity, item.product_id)
            );
            // Restore to batches (create a new 'return' batch with the original average cost)
            restoreStmts.push(
                env.DB.prepare(
                    "INSERT INTO product_stock_entries (product_id, quantity, remaining_quantity, purchase_price) VALUES (?, ?, ?, ?)"
                ).bind(item.product_id, item.quantity, item.quantity, item.purchase_price)
            );
        }
        if (restoreStmts.length > 0) await env.DB.batch(restoreStmts);
    }

    const updated = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(params.id).first();
    return successResponse({ order: updated }, `Order ${body.status}`);
}

// GET /api/orders/export - CSV export
export async function handleExportOrders(request, env, user) {
    const denied = requireAdmin(user);
    if (denied) return denied;

    const { results } = await env.DB.prepare(`
    SELECT o.id, o.created_at, o.status, o.total_amount, o.total_profit,
           u.name as salesperson, r.name as retailer
    FROM orders o
    JOIN users u ON o.salesperson_id = u.id
    JOIN retailers r ON o.retailer_id = r.id
    ORDER BY o.created_at DESC
    LIMIT 1000
  `).all();

    const headers = ['Order ID', 'Date', 'Status', 'Salesperson', 'Retailer', 'Total Amount', 'Total Profit'];
    const rows = results.map(o => [
        o.id, o.created_at, o.status, o.salesperson, o.retailer,
        o.total_amount.toFixed(2), o.total_profit.toFixed(2)
    ]);

    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');

    return new Response(csv, {
        headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="orders-${new Date().toISOString().split('T')[0]}.csv"`,
            'Access-Control-Allow-Origin': '*',
        },
    });
}

// PUT /api/orders/:id
export async function handleUpdateOrder(request, env, user, params) {
    try {
        const orderId = params.id;
        let body;
        try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

        const missing = validateRequired(body, ['retailer_id', 'items']);
        if (missing) return errorResponse(missing);

        // 1. Fetch existing order and items
        const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
        if (!order) return errorResponse('Order not found', 404);

        // 2. Authorization & Status Check
        if (user.role === 'salesperson' && order.salesperson_id !== user.id) {
            return errorResponse('Access denied', 403);
        }
        if (order.status === 'rejected') {
            return errorResponse('Cannot edit a rejected order', 400);
        }

        // 3. Time window check (24 hours)
        const createdAt = new Date(order.created_at + ' Z').getTime(); // append Z for UTC
        const now = Date.now();
        const diffHours = (now - createdAt) / (1000 * 60 * 60);
        if (user.role !== 'admin' && diffHours > 24) {
            return errorResponse('Order editing window (24h) has expired', 403);
        }

        const { results: oldItems } = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(orderId).all();

        // 3.5 Validate Retailer
        const retailerId = parseInt(body.retailer_id);
        const retailerExists = await env.DB.prepare('SELECT id FROM retailers WHERE id = ?').bind(retailerId).first();
        if (!retailerExists) return errorResponse('Retailer not found', 404);

        // 4. Validate new products and fetch current stock
        const productIds = body.items.map(i => parseInt(i.product_id)).filter(id => !isNaN(id));
        if (productIds.length === 0) return errorResponse('No valid product IDs provided');

        // Include old product IDs to ensure we fetch their info for restoration
        const allProductIds = [...new Set([...productIds, ...oldItems.map(i => i.product_id)])];
        const idPlaceholders = allProductIds.map(() => '?').join(',');
        const productsRes = await env.DB.prepare(
            `SELECT id, name, purchase_price, stock_quantity FROM products WHERE id IN (${idPlaceholders})`
        ).bind(...allProductIds).all();
        const productMap = new Map(productsRes.results.map(p => [Number(p.id), p]));

        // Fetch batches for FIFO
        const batchesRes = await env.DB.prepare(
            `SELECT * FROM product_stock_entries WHERE product_id IN (${idPlaceholders}) AND remaining_quantity > 0 ORDER BY created_at ASC`
        ).bind(...allProductIds).all();
        const batchMap = new Map();
        for (const b of batchesRes.results) {
            if (!batchMap.has(Number(b.product_id))) batchMap.set(Number(b.product_id), []);
            batchMap.get(Number(b.product_id)).push(b);
        }

        // 5. Restore stock (Temporarily in memory for validation)
        for (const oldItem of oldItems) {
            const p = productMap.get(Number(oldItem.product_id));
            if (p) p.stock_quantity += oldItem.quantity;
            // Note: Batch restoration will be done via SQL insert to keep it simple and handle returns correctly
        }

        // 6. Validate new items and compute totals (using updated memory stock)
        let totalAmount = 0;
        let totalProfit = 0;
        const processedItems = [];

        for (const item of body.items) {
            const pid = Number(item.product_id);
            const product = productMap.get(pid);
            if (!product) return errorResponse(`Product ${pid} not found`, 404);

            const qty = parseInt(item.quantity);
            if (qty < 1) return errorResponse(`Invalid quantity for ${product.name}`);
            if (product.stock_quantity < qty) {
                return errorResponse(`Insufficient stock for "${product.name}" after restoration. Max available: ${product.stock_quantity}`);
            }

            const sellingPrice = parseFloat(item.selling_price);
            
            // Re-consume from batches (Simplified: we treat the update as a fresh consumption after a generic return)
            // This is slightly complex because the order of operations in batch() matters.
            // We'll create "return" entries for restoration and then consume.
            
            let remainingToConsume = qty;
            let totalCostForThisItem = 0;
            const batchesUsed = [];
            const productBatches = batchMap.get(pid) || [];

            for (const batch of productBatches) {
                if (remainingToConsume <= 0) break;
                const take = Math.min(batch.remaining_quantity, remainingToConsume);
                totalCostForThisItem += take * batch.purchase_price;
                batchesUsed.push({ id: batch.id, quantity: take });
                batch.remaining_quantity -= take;
                remainingToConsume -= take;
            }

            if (remainingToConsume > 0) {
                // If batches are short but total stock is enough, it means the restored stock needs to be consumed.
                // We'll trust the main stock quantity since we'll insert a "return" batch anyway.
                // For simplicity in this update logic, we'll use the product's purchase_price for the "overflow".
                totalCostForThisItem += remainingToConsume * product.purchase_price;
            }

            const avgPurchasePrice = totalCostForThisItem / qty;
            const profit = (sellingPrice * qty) - totalCostForThisItem;

            totalAmount += sellingPrice * qty;
            totalProfit += profit;

            processedItems.push({
                product_id: product.id,
                quantity: qty,
                purchase_price: avgPurchasePrice,
                selling_price: sellingPrice,
                batchesUsed
            });
            
            product.stock_quantity -= qty;
        }

        // 7. Prepare Database Batch
        const batchStatements = [];

        // Restore: Increment products stock and add back to entries
        for (const oldItem of oldItems) {
            batchStatements.push(
                env.DB.prepare("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?").bind(oldItem.quantity, oldItem.product_id)
            );
            batchStatements.push(
                env.DB.prepare("INSERT INTO product_stock_entries (product_id, quantity, remaining_quantity, purchase_price) VALUES (?, ?, ?, ?)")
                    .bind(oldItem.product_id, oldItem.quantity, oldItem.quantity, oldItem.purchase_price)
            );
        }

        // Delete old items
        batchStatements.push(env.DB.prepare('DELETE FROM order_items WHERE order_id = ?').bind(orderId));

        // Consume: Decrement products stock and update batches
        for (const item of processedItems) {
            batchStatements.push(
                env.DB.prepare('INSERT INTO order_items (order_id, product_id, quantity, purchase_price, selling_price) VALUES (?, ?, ?, ?, ?)')
                    .bind(orderId, item.product_id, item.quantity, item.purchase_price, item.selling_price)
            );
            
            for (const b of item.batchesUsed) {
                batchStatements.push(
                    env.DB.prepare('UPDATE product_stock_entries SET remaining_quantity = remaining_quantity - ? WHERE id = ?')
                        .bind(b.quantity, b.id)
                );
            }

            batchStatements.push(
                env.DB.prepare("UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = datetime('now') WHERE id = ?")
                    .bind(item.quantity, item.product_id)
            );
        }

        // Update Order Summary
        batchStatements.push(
            env.DB.prepare("UPDATE orders SET retailer_id = ?, total_amount = ?, total_profit = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(parseInt(body.retailer_id), totalAmount, totalProfit, sanitizeString(body.notes || '', 500), orderId)
        );

        // Notify
        const admins = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all();
        for (const admin of admins.results) {
            batchStatements.push(
                env.DB.prepare(`INSERT INTO notifications (user_id, title, message, type, related_order_id, target_role) VALUES (?, ?, ?, 'info', ?, 'admin')`)
                    .bind(admin.id, 'Order Updated', `${user.name} updated order #${orderId}. New total: ₹${totalAmount.toFixed(2)}`, orderId)
            );
        }

        await env.DB.batch(batchStatements);

        return successResponse({ orderId }, 'Order updated successfully');

    } catch (err) {
        console.error(`[Order Edit] Exception:`, err);
        return errorResponse(`Failed to update order: ${err.message}`, 500);
    }
}
