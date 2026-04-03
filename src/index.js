/**
 * Sales Management API - Cloudflare Worker
 * Main entry point - routes all API requests
 */

import { jsonResponse, errorResponse, matchRoute } from './utils/helpers.js';
import { authMiddleware } from './middleware/auth.js';
import { handleGoogleLogin, handleGetMe } from './routes/auth.js';
import {
    handleGetProducts, handleGetProduct, handleCreateProduct,
    handleUpdateProduct, handleDeleteProduct, handleGetCategories,
    handleAddStock,
} from './routes/products.js';
import {
    handleGetRetailers, handleGetRetailer, handleCreateRetailer,
    handleUpdateRetailer, handleDeleteRetailer,
} from './routes/retailers.js';
import {
    handleCreateOrder, handleGetOrders, handleGetOrder,
    handleUpdateOrderStatus, handleExportOrders, handleUpdateOrder,
} from './routes/orders.js';
import {
    handleDailyReport, handleMonthlyReport, handleYearlyReport,
    handleTopProducts, handleSalespersonReport, handleSummary,
} from './routes/reports.js';
import {
    handleGetNotifications, handleMarkRead, handleMarkAllRead,
} from './routes/notifications.js';
import { handleUploadImage, handleGetImage } from './routes/upload.js';

// =============================================
// CORS Preflight handler
// =============================================
function handleOptions(request) {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
        },
    });
}

// =============================================
// Main Router
// =============================================
export default {
    async fetch(request, env, ctx) {
        // Outermost catch — always returns CORS headers even on crash
        try {
            const url = new URL(request.url);
            const method = request.method;
            const path = url.pathname;

            // Handle CORS preflight
            if (method === 'OPTIONS') return handleOptions(request);

            // Strip /api prefix
            if (!path.startsWith('/api/')) {
                return errorResponse('Not found', 404);
            }

            const apiPath = path.slice(4); // remove '/api'

            try {
                // ==========================================
                // Public routes (no auth required)
                // ==========================================
                if (method === 'POST' && apiPath === '/auth/google') return handleGoogleLogin(request, env);


                // Public image serving
                if (method === 'GET' && apiPath.startsWith('/images/')) {
                    const key = apiPath.slice('/images/'.length);
                    return handleGetImage(request, env, key);
                }

                // ==========================================
                // Protected routes (auth required)
                // ==========================================
                const { user, error: authError } = await authMiddleware(request, env);
                if (authError) return authError;

                // --- Auth ---
                if (method === 'GET' && apiPath === '/me') return handleGetMe(request, env, user);

                // --- Products ---
                if (method === 'POST' && apiPath === '/upload') return handleUploadImage(request, env, user);
                if (method === 'GET' && apiPath === '/products/categories') return handleGetCategories(request, env);
                if (method === 'GET' && apiPath === '/products') return handleGetProducts(request, env, user);
                if (method === 'POST' && apiPath === '/products') return handleCreateProduct(request, env, user);
                {
                    const p = matchRoute('/products/:id/stock', apiPath);
                    if (p && method === 'POST') return handleAddStock(request, env, user, p);
                }
                {
                    const p = matchRoute('/products/:id', apiPath);
                    if (p) {
                        if (method === 'GET') return handleGetProduct(request, env, user, p);
                        if (method === 'PUT') return handleUpdateProduct(request, env, user, p);
                        if (method === 'DELETE') return handleDeleteProduct(request, env, user, p);
                    }
                }

                // --- Retailers ---
                if (method === 'GET' && apiPath === '/retailers') return handleGetRetailers(request, env, user);
                if (method === 'POST' && apiPath === '/retailers') return handleCreateRetailer(request, env, user);
                {
                    const p = matchRoute('/retailers/:id', apiPath);
                    if (p) {
                        if (method === 'GET') return handleGetRetailer(request, env, user, p);
                        if (method === 'PUT') return handleUpdateRetailer(request, env, user, p);
                        if (method === 'DELETE') return handleDeleteRetailer(request, env, user, p);
                    }
                }

                // --- Orders ---
                if (method === 'POST' && apiPath === '/orders') return handleCreateOrder(request, env, user);
                if (method === 'GET' && apiPath === '/orders') return handleGetOrders(request, env, user);
                if (method === 'GET' && apiPath === '/orders/export') return handleExportOrders(request, env, user);
                {
                    const p = matchRoute('/orders/:id', apiPath);
                    if (p) {
                        if (method === 'GET') return handleGetOrder(request, env, user, p);
                        if (method === 'PUT') return handleUpdateOrder(request, env, user, p);
                    }
                }
                {
                    const p = matchRoute('/orders/:id/status', apiPath);
                    if (p) {
                        if (method === 'PUT') return handleUpdateOrderStatus(request, env, user, p);
                    }
                }

                // --- Reports ---
                if (method === 'GET' && apiPath === '/reports/summary') return handleSummary(request, env, user);
                if (method === 'GET' && apiPath === '/reports/daily') return handleDailyReport(request, env, user);
                if (method === 'GET' && apiPath === '/reports/monthly') return handleMonthlyReport(request, env, user);
                if (method === 'GET' && apiPath === '/reports/yearly') return handleYearlyReport(request, env, user);
                if (method === 'GET' && apiPath === '/reports/top-products') return handleTopProducts(request, env, user);
                if (method === 'GET' && apiPath === '/reports/by-salesperson') return handleSalespersonReport(request, env, user);

                // --- Notifications ---
                if (method === 'GET' && apiPath === '/notifications') return handleGetNotifications(request, env, user);
                if (method === 'PUT' && apiPath === '/notifications/read-all') return handleMarkAllRead(request, env, user);
                {
                    const p = matchRoute('/notifications/:id/read', apiPath);
                    if (p && method === 'PUT') return handleMarkRead(request, env, user, p);
                }

                return errorResponse('Route not found', 404);

            } catch (err) {
                console.error('Unhandled error:', err);
                // Safe error response - err.message is usually a string, but we handle anything
                const message = err instanceof Error ? err.message : String(err);
                return errorResponse('Internal server error', 500, message);
            }
        } catch (outerErr) {
            // This is the absolute last resort. We must not throw here.
            try {
                console.error('Critical worker error:', outerErr);
                const message = outerErr instanceof Error ? outerErr.message : String(outerErr);
                return new Response(JSON.stringify({ 
                    success: false, 
                    error: 'Critical server error',
                    details: message 
                }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                    },
                });
            } catch (finalErr) {
                // If even the above fails (e.g. JSON.stringify throws), return a plain text response
                return new Response('Critical Internal Server Error', { 
                    status: 500,
                    headers: { 'Access-Control-Allow-Origin': '*' }
                });
            }
        }
    },
};
