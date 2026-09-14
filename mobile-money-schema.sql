-- ============================================================
-- MOBILE MONEY DATABASE SCHEMA
-- Run this SQL in your PostgreSQL database
-- ============================================================

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'UGX',
  reference VARCHAR(255) UNIQUE NOT NULL,
  payment_type VARCHAR(50),
  status VARCHAR(20) DEFAULT 'pending', -- pending, completed, failed, refunded
  network VARCHAR(20), -- mtn, airtel, mpesa
  phone VARCHAR(15),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP,
  INDEX idx_user_payments (user_id),
  INDEX idx_reference (reference),
  INDEX idx_status (status)
);

-- Artist tips table
CREATE TABLE IF NOT EXISTS artist_tips (
  id SERIAL PRIMARY KEY,
  artist_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  payment_reference VARCHAR(255) REFERENCES payments(reference),
  message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_artist_tips (artist_id),
  INDEX idx_tipper (user_id)
);

-- Premium subscriptions history
CREATE TABLE IF NOT EXISTS premium_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  payment_reference VARCHAR(255) REFERENCES payments(reference),
  plan_type VARCHAR(20), -- monthly, yearly
  started_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  auto_renew BOOLEAN DEFAULT FALSE,
  INDEX idx_user_premium (user_id)
);

-- Add premium fields to users table (if not exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_until TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_money_phone VARCHAR(15);

-- Add featured song fields to songs table
ALTER TABLE songs ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS featured_until TIMESTAMP;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS featured_payment_ref VARCHAR(255);

-- Payment statistics view
CREATE OR REPLACE VIEW payment_stats AS
SELECT 
  DATE_TRUNC('day', created_at) as date,
  payment_type,
  network,
  COUNT(*) as transaction_count,
  SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_amount,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful_count,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count
FROM payments
GROUP BY DATE_TRUNC('day', created_at), payment_type, network
ORDER BY date DESC;

-- Artist earnings view
CREATE OR REPLACE VIEW artist_earnings AS
SELECT 
  artist_id,
  COUNT(*) as tip_count,
  SUM(amount) as total_tips,
  AVG(amount) as avg_tip,
  MAX(amount) as highest_tip,
  MIN(created_at) as first_tip_date,
  MAX(created_at) as last_tip_date
FROM artist_tips
GROUP BY artist_id;

-- Insert default payment types (for reference)
CREATE TABLE IF NOT EXISTS payment_types (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'UGX',
  description TEXT,
  active BOOLEAN DEFAULT TRUE
);

INSERT INTO payment_types (code, name, amount, description) VALUES
('PREMIUM_MONTHLY', 'Premium Monthly', 10000, 'DJ Musta Premium subscription for 1 month'),
('PREMIUM_YEARLY', 'Premium Yearly', 100000, 'DJ Musta Premium subscription for 1 year - Save 17%!'),
('ARTIST_TIP_SMALL', 'Small Tip', 1000, 'Show appreciation to your favorite artist'),
('ARTIST_TIP_MEDIUM', 'Medium Tip', 5000, 'Support your favorite artist'),
('ARTIST_TIP_LARGE', 'Large Tip', 10000, 'Huge support for your favorite artist'),
('SONG_DOWNLOAD', 'Song Download', 500, 'Download high-quality song'),
('FEATURED_SONG', 'Featured Song', 50000, 'Feature your song on homepage for 7 days')
ON CONFLICT (code) DO NOTHING;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_user_status ON payments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_artist_tips_created_at ON artist_tips(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_premium_history_expires ON premium_history(expires_at);

-- ============================================================
-- SAMPLE QUERIES
-- ============================================================

-- Get total revenue
-- SELECT SUM(amount) as total_revenue FROM payments WHERE status = 'completed';

-- Get revenue by network
-- SELECT network, SUM(amount) as revenue FROM payments WHERE status = 'completed' GROUP BY network;

-- Get top tipped artists
-- SELECT artist_id, total_tips FROM artist_earnings ORDER BY total_tips DESC LIMIT 10;

-- Get premium users count
-- SELECT COUNT(*) FROM users WHERE is_premium = TRUE AND premium_until > NOW();

-- Get today's revenue
-- SELECT SUM(amount) FROM payments WHERE status = 'completed' AND DATE(created_at) = CURRENT_DATE;
