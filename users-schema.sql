-- DJ MUSTA MUSIC - USERS TABLE SCHEMA
-- Run this SQL in your Supabase SQL Editor to create the users table

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100),
  profile_picture TEXT,
  bio TEXT,
  phone VARCHAR(20),
  country VARCHAR(100) DEFAULT 'Uganda',
  is_verified BOOLEAN DEFAULT FALSE,
  is_artist BOOLEAN DEFAULT FALSE,
  reset_token VARCHAR(255),
  reset_token_expiry TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- Create user_favorites table (for liked songs)
CREATE TABLE IF NOT EXISTS user_favorites (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, song_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON user_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_song ON user_favorites(song_id);

-- Create user_playlists table
CREATE TABLE IF NOT EXISTS user_playlists (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  cover_image TEXT,
  is_public BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playlists_user ON user_playlists(user_id);

-- Create playlist_songs table
CREATE TABLE IF NOT EXISTS playlist_songs (
  id SERIAL PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(playlist_id, song_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist ON playlist_songs(playlist_id);

-- Create user_listening_history table
CREATE TABLE IF NOT EXISTS user_listening_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  played_at TIMESTAMP DEFAULT NOW(),
  duration_played INTEGER -- seconds played
);

CREATE INDEX IF NOT EXISTS idx_history_user ON user_listening_history(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_song ON user_listening_history(song_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_playlists_updated_at BEFORE UPDATE ON user_playlists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Success message
SELECT 'Users schema created successfully!' AS status;
