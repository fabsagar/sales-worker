import { errorResponse, successResponse, validateRequired, sanitizeString } from '../utils/helpers.js';
import { requireAdmin, requireStrictAdmin, requireSalesperson } from '../middleware/auth.js';

// GET /api/retailers
export async function handleGetRetailers(request, env, user) {
    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const params = [];
    let query = 'SELECT r.*, u.email as user_email FROM retailers r LEFT JOIN users u ON r.user_id = u.id WHERE r.is_active = 1';

    if (search) {
        query += ' AND (r.name LIKE ? OR r.email LIKE ? OR r.phone LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY r.name ASC';
    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ retailers: results });
}

// GET /api/retailers/:id
export async function handleGetRetailer(request, env, user, params) {
    const retailer = await env.DB.prepare('SELECT * FROM retailers WHERE id = ? AND is_active = 1').bind(params.id).first();
    if (!retailer) return errorResponse('Retailer not found', 404);
    return successResponse({ retailer });
}

// POST /api/retailers
export async function handleCreateRetailer(request, env, user) {
    try {
        const denied = requireSalesperson(user);
        if (denied) return denied;

        let body;
        try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

        const missing = validateRequired(body, ['name']);
        if (missing) return errorResponse(missing);

        const result = await env.DB.prepare(
            'INSERT INTO retailers (name, email, phone, address) VALUES (?, ?, ?, ?)'
        ).bind(
            sanitizeString(body.name, 200),
            sanitizeString(body.email || '', 200),
            sanitizeString(body.phone || '', 20),
            sanitizeString(body.address || '', 500)
        ).run();

        const orderId = result.meta.last_row_id || result.meta.lastRowId;
        const retailer = await env.DB.prepare('SELECT * FROM retailers WHERE id = ?')
            .bind(orderId).first();
        return successResponse({ retailer }, 'Retailer created');
    } catch (err) {
        console.error(`[Retailer] Create exception:`, err);
        return errorResponse(`Failed to create retailer: ${err.message}`, 500);
    }
}

// PUT /api/retailers/:id
export async function handleUpdateRetailer(request, env, user, params) {
    try {
        const denied = requireSalesperson(user);
        if (denied) return denied;

        let body;
        try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

        const existing = await env.DB.prepare('SELECT id FROM retailers WHERE id = ?').bind(params.id).first();
        if (!existing) return errorResponse('Retailer not found', 404);

        const fields = [];
        const values = [];
        if (body.name !== undefined) { fields.push('name = ?'); values.push(sanitizeString(body.name, 200)); }
        if (body.email !== undefined) { fields.push('email = ?'); values.push(sanitizeString(body.email, 200)); }
        if (body.phone !== undefined) { fields.push('phone = ?'); values.push(sanitizeString(body.phone, 20)); }
        if (body.address !== undefined) { fields.push('address = ?'); values.push(sanitizeString(body.address, 500)); }

        if (fields.length === 0) return errorResponse('No fields to update');
        fields.push("updated_at = datetime('now')");
        values.push(params.id);

        await env.DB.prepare(`UPDATE retailers SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
        const retailer = await env.DB.prepare('SELECT * FROM retailers WHERE id = ?').bind(params.id).first();
        return successResponse({ retailer }, 'Retailer updated');
    } catch (err) {
        console.error(`[Retailer] Update exception:`, err);
        return errorResponse(`Failed to update retailer: ${err.message}`, 500);
    }
}

// DELETE /api/retailers/:id
export async function handleDeleteRetailer(request, env, user, params) {
    try {
        const denied = requireStrictAdmin(user);
        if (denied) return denied;

        const existing = await env.DB.prepare('SELECT id FROM retailers WHERE id = ? AND is_active = 1').bind(params.id).first();
        if (!existing) return errorResponse('Retailer not found', 404);

        // Soft delete
        await env.DB.prepare("UPDATE retailers SET is_active = 0, updated_at = datetime('now') WHERE id = ?")
            .bind(params.id).run();
        
        return successResponse({}, 'Retailer deleted');
    } catch (err) {
        console.error(`[Retailer] Delete exception:`, err);
        return errorResponse(`Failed to delete retailer: ${err.message}`, 500);
    }
}
