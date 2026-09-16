-- Add Password Reset Columns to Existing Users Table
-- Run this if you already created the users table without reset_token columns

-- Add reset token columns
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255),
ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMP;

-- Success message
SELECT 'Password reset columns added successfully!' AS status;
