// =============================================
// Response Helpers
// =============================================

export function jsonResponse(data, status = 200, headers = {}) {
    // Stringify with BigInt support
    const body = JSON.stringify(data, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    );

    return new Response(body, {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            ...headers,
        },
    });
}

export function errorResponse(message, status = 400, details = null) {
    return jsonResponse({
        success: false,
        error: message,
        ...(details && { details }),
    }, status);
}

export function successResponse(data, message = 'Success') {
    return jsonResponse({
        success: true,
        message,
        ...data,
    });
}

// =============================================
// Input validation helpers
// =============================================
export function validateRequired(obj, fields) {
    const missing = fields.filter(f => obj[f] === undefined || obj[f] === null || obj[f] === '');
    if (missing.length > 0) {
        return `Missing required fields: ${missing.join(', ')}`;
    }
    return null;
}

export function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateNumber(val, min = 0) {
    const n = parseFloat(val);
    return !isNaN(n) && n >= min;
}

export function sanitizeString(str, maxLen = 500) {
    if (typeof str !== 'string') return '';
    return str.trim().substring(0, maxLen);
}

// =============================================
// Route matching helper
// =============================================
export function matchRoute(pattern, pathname) {
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');

    if (patternParts.length !== pathParts.length) return null;

    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(':')) {
            params[patternParts[i].slice(1)] = pathParts[i];
        } else if (patternParts[i] !== pathParts[i]) {
            return null;
        }
    }
    return params;
}
