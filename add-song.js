#!/usr/bin/env node
/**
 * Add a song to the database directly
 * Usage: node add-song.js "Title" "Artist" "Genre" "file_url" "cover_url" [duration]
 * 
 * Example:
 * node add-song.js "Kikumi-Kukinakyo" "Julie K" "Kadongo Kamu" "https://r2.example.com/song.mp3" "https://r2.example.com/cover.jpg" "3:45"
 */

require('dotenv').config();
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not set in environment variables');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function addSong(title, artist, genre, filePath, coverPath, duration = '0:00') {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `INSERT INTO songs (title, artist, genre, file_path, cover_path, duration, approved)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE)
             RETURNING id, title, artist`,
            [title, artist, genre, filePath, coverPath || null, duration]
        );
        
        console.log('✅ Song added successfully:');
        console.log(result.rows[0]);
        return result.rows[0];
    } catch (err) {
        console.error('❌ Error adding song:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 4) {
        console.log(`
📝 Add a song to DJ Musta database

Usage: node add-song.js "Title" "Artist" "Genre" "fileUrl" ["coverUrl"] ["duration"]

Examples:
  node add-song.js "Kikumi-Kukinakyo" "Julie K" "Kadongo Kamu" "https://pub-1004f9c2790e44689198e9849c00fb9b.r2.dev/songs/song.mp3"
  
  node add-song.js "My Song" "My Artist" "Dancehall" "https://r2.url/song.mp3" "https://r2.url/cover.jpg" "3:45"

Required:
  - Title: Song title
  - Artist: Artist name
  - Genre: Genre (Kadongo Kamu, Dancehall, Gospel, Afrobeat, etc.)
  - fileUrl: Full URL to MP3 file (e.g., on R2/Cloudflare)

Optional:
  - coverUrl: Full URL to cover image
  - duration: Song duration (default: "0:00")
        `);
        process.exit(1);
    }

    const title = args[0];
    const artist = args[1];
    const genre = args[2];
    const filePath = args[3];
    const coverPath = args[4] || null;
    const duration = args[5] || '0:00';

    console.log('🎵 Adding song to database...');
    console.log({ title, artist, genre, filePath, coverPath, duration });

    try {
        await addSong(title, artist, genre, filePath, coverPath, duration);
        console.log('\n✅ Done! The song is now live on your website.');
        process.exit(0);
    } catch (err) {
        process.exit(1);
    }
}

main();
