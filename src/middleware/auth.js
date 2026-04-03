import { verifyJWT } from '../utils/jwt.js';
import { errorResponse } from '../utils/helpers.js';

// =============================================
// Auth Middleware
// =============================================
export async function authMiddleware(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { error: errorResponse('Authorization token missing', 401) };
    }

    const token = authHeader.slice(7);
    try {
        const payload = await verifyJWT(token, env.JWT_SECRET);

        // Verify user still exists and is active
        const user = await env.DB.prepare(
            'SELECT id, name, email, role, is_active FROM users WHERE id = ?'
        ).bind(payload.userId).first();

        if (!user || !user.is_active) {
            return { error: errorResponse('User not found or inactive', 401) };
        }

        return { user };
    } catch (err) {
        return { error: errorResponse('Invalid or expired token', 401) };
    }
}

// =============================================
// Role-Based Access Control
// =============================================
export function requireRole(...roles) {
    return (user) => {
        if (!roles.includes(user.role)) {
            return errorResponse(`Access denied. Required role: ${roles.join(' or ')}`, 403);
        }
        return null;
    };
}

export const requireAdmin = requireRole('admin', 'user');
export const requireStrictAdmin = requireRole('admin');
export const requireSalesperson = requireRole('admin', 'salesperson', 'user');
export const requireAnyRole = requireRole('admin', 'salesperson', 'retailer', 'user');
