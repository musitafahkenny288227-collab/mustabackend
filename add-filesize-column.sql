-- ============================================================
-- Add file_size column to songs table
-- ============================================================
-- This adds a column to track the size of each song file in bytes
-- Run this in Supabase SQL Editor or via psql
-- ============================================================

-- Add file_size column (stores size in bytes)
ALTER TABLE songs 
ADD COLUMN IF NOT EXISTS file_size BIGINT DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN songs.file_size IS 'File size in bytes (e.g., 3500000 = 3.5 MB)';

-- Verify the column was added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'songs' AND column_name = 'file_size';

-- ============================================================
-- DONE! Now the backend can store file sizes when uploading
-- ============================================================
