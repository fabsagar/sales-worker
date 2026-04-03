import { errorResponse, successResponse, validateRequired, validateEmail, sanitizeString } from '../utils/helpers.js';
import { requireAdmin } from '../middleware/auth.js';
import { hashPassword } from '../utils/jwt.js';

// GET /api/users
export async function handleGetUsers(request, env, user) {
    const denied = requireAdmin(user);
    if (denied) return denied;

    const { results } = await env.DB.prepare(
        'SELECT id, name, email, role, is_active, created_at FROM users ORDER BY created_at DESC'
    ).all();
    return successResponse({ users: results });
}

// PUT /api/users/:id/status
export async function handleToggleUserStatus(request, env, user, params) {
    const denied = requireAdmin(user);
    if (denied) return denied;

    if (parseInt(params.id) === user.id) return errorResponse('Cannot deactivate yourself', 400);

    const existing = await env.DB.prepare('SELECT id, is_active FROM users WHERE id = ?').bind(params.id).first();
    if (!existing) return errorResponse('User not found', 404);

    const newStatus = existing.is_active ? 0 : 1;
    await env.DB.prepare("UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(newStatus, params.id).run();

    return successResponse({ is_active: newStatus }, `User ${newStatus ? 'activated' : 'deactivated'}`);
}

// PUT /api/users/:id/password
export async function handleChangePassword(request, env, user, params) {
    // Allow self-change or admin
    if (parseInt(params.id) !== user.id && user.role !== 'admin') {
        return errorResponse('Access denied', 403);
    }

    let body;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

    const missing = validateRequired(body, ['password']);
    if (missing) return errorResponse(missing);
    if (body.password.length < 6) return errorResponse('Password must be at least 6 characters');

    const hash = await hashPassword(body.password);
    await env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(hash, params.id).run();

    return successResponse({}, 'Password updated');
}
