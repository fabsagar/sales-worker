import { errorResponse, successResponse } from '../utils/helpers.js';
import { requireAdmin } from '../middleware/auth.js';

// GET /api/reports/daily
export async function handleDailyReport(request, env, user) {
  const denied = requireAdmin(user);
  if (denied) return denied;

  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get('days') || '30'), 365);

  const { results } = await env.DB.prepare(`
    SELECT 
      date(o.created_at) as date,
      COUNT(o.id) as order_count,
      SUM(o.total_amount) as revenue,
      SUM(o.total_profit) as profit
    FROM orders o
    WHERE o.status = 'approved'
      AND o.created_at >= date('now', '-' || ? || ' days')
    GROUP BY date(o.created_at)
    ORDER BY date ASC
  `).bind(days).all();

  return successResponse({ data: results, days });
}

// GET /api/reports/monthly
export async function handleMonthlyReport(request, env, user) {
  const denied = requireAdmin(user);
  if (denied) return denied;

  const url = new URL(request.url);
  const months = Math.min(parseInt(url.searchParams.get('months') || '12'), 36);

  const { results } = await env.DB.prepare(`
    SELECT 
      strftime('%Y-%m', o.created_at) as month,
      COUNT(o.id) as order_count,
      SUM(o.total_amount) as revenue,
      SUM(o.total_profit) as profit
    FROM orders o
    WHERE o.status = 'approved'
      AND o.created_at >= date('now', '-' || ? || ' months')
    GROUP BY strftime('%Y-%m', o.created_at)
    ORDER BY month ASC
  `).bind(months).all();

  return successResponse({ data: results, months });
}

// GET /api/reports/yearly
export async function handleYearlyReport(request, env, user) {
  const denied = requireAdmin(user);
  if (denied) return denied;

  const { results } = await env.DB.prepare(`
    SELECT 
      strftime('%Y', o.created_at) as year,
      COUNT(o.id) as order_count,
      SUM(o.total_amount) as revenue,
      SUM(o.total_profit) as profit
    FROM orders o
    WHERE o.status = 'approved'
    GROUP BY strftime('%Y', o.created_at)
    ORDER BY year ASC
  `).all();

  return successResponse({ data: results });
}

// GET /api/reports/top-products
export async function handleTopProducts(request, env, user) {
  const denied = requireAdmin(user);
  if (denied) return denied;

  const url = new URL(request.url);
  const topN = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);

  const { results } = await env.DB.prepare(`
    SELECT 
      p.id,
      p.name,
      p.category,
      SUM(oi.quantity) as total_quantity,
      SUM(oi.selling_price * oi.quantity) as total_revenue,
      SUM((oi.selling_price - oi.purchase_price) * oi.quantity) as total_profit
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status = 'approved'
    GROUP BY p.id, p.name, p.category
    ORDER BY total_profit DESC
    LIMIT ?
  `).bind(topN).all();

  return successResponse({ data: results });
}

// GET /api/reports/by-salesperson
export async function handleSalespersonReport(request, env, user) {
  const denied = requireAdmin(user);
  if (denied) return denied;

  const { results } = await env.DB.prepare(`
    SELECT 
      u.id,
      u.name,
      u.email,
      COUNT(o.id) as order_count,
      SUM(o.total_amount) as total_revenue,
      SUM(o.total_profit) as total_profit
    FROM orders o
    JOIN users u ON o.salesperson_id = u.id
    WHERE o.status = 'approved'
    GROUP BY u.id, u.name, u.email
    ORDER BY total_profit DESC
  `).all();

  return successResponse({ data: results });
}

// GET /api/reports/summary
export async function handleSummary(request, env, user) {
  const denied = requireAdmin(user);
  if (denied) return denied;

  const [
    totalOrders,
    pendingOrders,
    totalRevenue,
    totalProfit,
    totalProducts,
    lowStock,
    totalUsers
  ] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as count FROM orders").first(),
    env.DB.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").first(),
    env.DB.prepare("SELECT COALESCE(SUM(total_amount), 0) as val FROM orders WHERE status = 'approved'").first(),
    env.DB.prepare("SELECT COALESCE(SUM(total_profit), 0) as val FROM orders WHERE status = 'approved'").first(),
    env.DB.prepare("SELECT COUNT(*) as count FROM products WHERE is_active = 1").first(),
    env.DB.prepare("SELECT COUNT(*) as count FROM products WHERE stock_quantity < 10 AND is_active = 1").first(),
    env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE is_active = 1").first(),
  ]);

  return successResponse({
    summary: {
      total_orders: totalOrders?.count || 0,
      pending_orders: pendingOrders?.count || 0,
      total_revenue: totalRevenue?.val || 0,
      total_profit: totalProfit?.val || 0,
      total_products: totalProducts?.count || 0,
      low_stock_products: lowStock?.count || 0,
      total_users: totalUsers?.count || 0,
    }
  });
}
