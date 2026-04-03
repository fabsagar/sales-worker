import { errorResponse, successResponse } from '../utils/helpers.js';

// GET /api/notifications
export async function handleGetNotifications(request, env, user) {
    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get('unread') === 'true';
    const targetRole = url.searchParams.get('target_role');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

    let query = 'SELECT n.*, o.total_amount FROM notifications n LEFT JOIN orders o ON n.related_order_id = o.id WHERE n.user_id = ?';
    const params = [user.id];

    if (targetRole) {
        query += ' AND (n.target_role = ? OR n.target_role IS NULL)';
        params.push(targetRole);
    }

    if (unreadOnly) {
        query += ' AND n.is_read = 0';
    }

    query += ' ORDER BY n.created_at DESC LIMIT ?';
    params.push(limit);

    const { results } = await env.DB.prepare(query).bind(...params).all();

    let unreadQuery = 'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0';
    const unreadParams = [user.id];
    if (targetRole) {
        unreadQuery += ' AND (target_role = ? OR target_role IS NULL)';
        unreadParams.push(targetRole);
    }
    const unreadCount = await env.DB.prepare(unreadQuery).bind(...unreadParams).first();

    return successResponse({
        notifications: results,
        unread_count: unreadCount?.count || 0,
    });
}

// PUT /api/notifications/:id/read
export async function handleMarkRead(request, env, user, params) {
    const notif = await env.DB.prepare(
        'SELECT id FROM notifications WHERE id = ? AND user_id = ?'
    ).bind(params.id, user.id).first();

    if (!notif) return errorResponse('Notification not found', 404);

    await env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').bind(params.id).run();
    return successResponse({}, 'Notification marked as read');
}

// PUT /api/notifications/read-all
export async function handleMarkAllRead(request, env, user) {
    await env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(user.id).run();
    return successResponse({}, 'All notifications marked as read');
}
