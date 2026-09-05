-- ============================================================
-- SQL: Add Missing Song to DJ Musta Database
-- ============================================================
-- 
-- USAGE:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Create a new query
-- 3. Copy and paste this SQL
-- 4. Run the query
--
-- OR use psql:
-- psql "postgresql://user:password@host/database" < add-song.sql
--
-- ============================================================

INSERT INTO songs 
(title, artist, genre, duration, file_path, cover_path, approved, created_at)
VALUES 
(
    'Kikumi-Kukinakyo',                    -- title
    'Julie K',                             -- artist  
    'Kadongo Kamu',                        -- genre
    '3:45',                                -- duration
    'https://pub-1004f9c2790e44689198e9849c00fb9b.r2.dev/songs/kikumi-kukinakyo-julie-k.mp3',  -- file_path (update with actual URL)
    'https://pub-1004f9c2790e44689198e9849c00fb9b.r2.dev/covers/default-cover.svg',  -- cover_path
    true,                                  -- approved - TRUE so it shows up immediately
    NOW()                                  -- created_at
)
RETURNING id, title, artist, genre, created_at;

-- After running:
-- ✅ The song should now be accessible at:
--    https://www.djmusta.com/song/kikumi-kukinakyo/julie-k
--
-- ⚠️  IMPORTANT: Make sure the MP3 file exists at the file_path URL
--    If not, you need to:
--    1. Upload the MP3 file to your R2/Cloudflare bucket
--    2. Update the file_path URL in the database
--
-- To update the file_path:
-- UPDATE songs 
-- SET file_path = 'https://your-actual-url/song.mp3'
-- WHERE title = 'Kikumi-Kukinakyo' AND artist = 'Julie K';
