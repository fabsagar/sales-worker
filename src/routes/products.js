import { errorResponse, successResponse, validateRequired, validateNumber, sanitizeString } from '../utils/helpers.js';
import { requireAdmin } from '../middleware/auth.js';

// GET /api/products
export async function handleGetProducts(request, env, user) {
    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const category = url.searchParams.get('category') || '';
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 5000);
    const offset = (page - 1) * limit;
    const sort = url.searchParams.get('sort') || 'newest';

    let query = 'SELECT * FROM products WHERE is_active = 1';
    const params = [];

    if (search) {
        query += ' AND (name LIKE ? OR description LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }
    if (category) {
        query += ' AND category = ?';
        params.push(category);
    }

    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const totalResult = await env.DB.prepare(countQuery).bind(...params).first();
    const total = totalResult?.total || 0;

    let orderBy = 'created_at DESC, id DESC';
    if (sort === 'oldest') orderBy = 'created_at ASC, id ASC';
    else if (sort === 'name_asc') orderBy = 'name ASC, id ASC';
    else if (sort === 'name_desc') orderBy = 'name DESC, id DESC';

    query += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const { results } = await env.DB.prepare(query).bind(...params).all();

    return successResponse({
        products: results,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
}

// GET /api/products/:id
export async function handleGetProduct(request, env, user, params) {
    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1')
        .bind(params.id).first();
    if (!product) return errorResponse('Product not found', 404);

    return successResponse({ product });
}

// POST /api/products
export async function handleCreateProduct(request, env, user) {
    const denied = requireAdmin(user);
    if (denied) return denied;

    let body;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

    const missing = validateRequired(body, ['name', 'purchase_price']);
    if (missing) return errorResponse(missing);

    if (!validateNumber(body.purchase_price, 0)) return errorResponse('Invalid purchase_price');
    if (body.default_selling_price !== undefined && body.default_selling_price !== null && body.default_selling_price !== '' && !validateNumber(body.default_selling_price, 0)) return errorResponse('Invalid default_selling_price');
    if (body.stock_quantity !== undefined && !validateNumber(body.stock_quantity, 0)) return errorResponse('Invalid stock_quantity');

    // Reject base64 images — use the /api/upload endpoint instead
    if (body.image_url && body.image_url.length > 2000) {
        return errorResponse('image_url too long. Please upload images via the upload endpoint first.', 400);
    }

    const result = await env.DB.prepare(
        `INSERT INTO products (name, description, category, purchase_price, default_selling_price, stock_quantity, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        sanitizeString(body.name, 200),
        sanitizeString(body.description || '', 1000),
        sanitizeString(body.category || '', 100),
        parseFloat(body.purchase_price),
        body.default_selling_price != null && body.default_selling_price !== '' ? parseFloat(body.default_selling_price) : 0,
        parseInt(body.stock_quantity || 0),
        sanitizeString(body.image_url || '', 2000)
    ).run();

    const productId = result.meta.last_row_id;
    const stockQty = parseInt(body.stock_quantity || 0);

    // Initial stock entry if exists
    if (stockQty > 0) {
        await env.DB.prepare(
            'INSERT INTO product_stock_entries (product_id, quantity, remaining_quantity, purchase_price) VALUES (?, ?, ?, ?)'
        ).bind(productId, stockQty, stockQty, parseFloat(body.purchase_price)).run();
    }

    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first();
    return successResponse({ product }, 'Product created');
}

// POST /api/products/:id/stock
export async function handleAddStock(request, env, user, params) {
    const denied = requireAdmin(user);
    if (denied) return denied;

    let body;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

    const missing = validateRequired(body, ['quantity', 'purchase_price']);
    if (missing) return errorResponse(missing);

    const qty = parseInt(body.quantity);
    const price = parseFloat(body.purchase_price);

    if (!validateNumber(qty, 1)) return errorResponse('Invalid quantity');
    if (!validateNumber(price, 0)) return errorResponse('Invalid purchase_price');

    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(params.id).first();
    if (!product) return errorResponse('Product not found', 404);

    // Update atoms
    const batchStmts = [
        env.DB.prepare(
            'INSERT INTO product_stock_entries (product_id, quantity, remaining_quantity, purchase_price) VALUES (?, ?, ?, ?)'
        ).bind(params.id, qty, qty, price),
        env.DB.prepare(
            'UPDATE products SET stock_quantity = stock_quantity + ?, purchase_price = MAX(purchase_price, ?), updated_at = datetime("now") WHERE id = ?'
        ).bind(qty, price, params.id)
    ];

    await env.DB.batch(batchStmts);

    const updated = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(params.id).first();
    return successResponse({ product: updated }, `Added ${qty} units to stock`);
}

// PUT /api/products/:id
export async function handleUpdateProduct(request, env, user, params) {
    const denied = requireAdmin(user);
    if (denied) return denied;

    let body;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

    const existing = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(params.id).first();
    if (!existing) return errorResponse('Product not found', 404);

    const fields = [];
    const values = [];

    if (body.name !== undefined) { fields.push('name = ?'); values.push(sanitizeString(body.name, 200)); }
    if (body.description !== undefined) { fields.push('description = ?'); values.push(sanitizeString(body.description, 1000)); }
    if (body.category !== undefined) { fields.push('category = ?'); values.push(sanitizeString(body.category, 100)); }
    if (body.purchase_price !== undefined) {
        if (!validateNumber(body.purchase_price, 0)) return errorResponse('Invalid purchase_price');
        fields.push('purchase_price = ?'); values.push(parseFloat(body.purchase_price));
    }
    if (body.default_selling_price !== undefined && body.default_selling_price !== null && body.default_selling_price !== '') {
        if (!validateNumber(body.default_selling_price, 0)) return errorResponse('Invalid default_selling_price');
        fields.push('default_selling_price = ?'); values.push(parseFloat(body.default_selling_price));
    }
    if (body.stock_quantity !== undefined) {
        if (!validateNumber(body.stock_quantity, 0)) return errorResponse('Invalid stock_quantity');
        fields.push('stock_quantity = ?'); values.push(parseInt(body.stock_quantity));
    }
    if (body.image_url !== undefined) { fields.push('image_url = ?'); values.push(sanitizeString(body.image_url, 500)); }

    if (fields.length === 0) return errorResponse('No fields to update');

    fields.push("updated_at = datetime('now')");
    values.push(params.id);

    await env.DB.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(params.id).first();
    return successResponse({ product }, 'Product updated');
}

// DELETE /api/products/:id
export async function handleDeleteProduct(request, env, user, params) {
    const denied = requireAdmin(user);
    if (denied) return denied;

    const existing = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(params.id).first();
    if (!existing) return errorResponse('Product not found', 404);

    // Soft delete
    await env.DB.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?")
        .bind(params.id).run();

    return successResponse({}, 'Product deleted');
}

// GET /api/products/categories
export async function handleGetCategories(request, env) {
    const { results } = await env.DB.prepare(
        'SELECT DISTINCT category FROM products WHERE is_active = 1 ORDER BY category'
    ).all();
    return successResponse({ categories: results.map(r => r.category) });
}
