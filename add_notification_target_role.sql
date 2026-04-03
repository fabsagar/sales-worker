-- Migration: Add target_role to notifications for role-based filtering
ALTER TABLE notifications ADD COLUMN target_role TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_target_role ON notifications(target_role);
