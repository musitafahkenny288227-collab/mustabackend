/**
 * QUICK FIX: Insert missing song directly into database
 * This script adds "Kikumi-Kukinakyo" by Julie K to the songs table
 * 
 * Run with: set DATABASE_URL=your_url && node insert-song-quick.js
 * Or on PowerShell: $env:DATABASE_URL='your_url'; node insert-song-quick.js
 */

const { Pool } = require('pg');

// Try to get DATABASE_URL from environment
let DATABASE_URL = process.env.DATABASE_URL;

// If not found, try to read from Render or environment
if (!DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL not found in environment');
    console.error('');
    console.error('You need to provide DATABASE_URL. You can get this from:');
    console.error('  1. Render Dashboard → Your App → Environment');
    console.error('  2. Supabase Dashboard → Connection String');
    console.error('');
    console.error('Set it before running this script:');
    console.error('  PowerShell: $env:DATABASE_URL="postgresql://..."; node insert-song-quick.js');
    console.error('  Bash/CMD:   export DATABASE_URL="postgresql://..."; node insert-song-quick.js');
    process.exit(1);
}

async function insertSong() {
    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const client = await pool.connect();
    
    try {
        // Insert the song
        const result = await client.query(
            `INSERT INTO songs 
             (title, artist, genre, duration, file_path, cover_path, approved, created_at)
             VALUES 
             ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING id, title, artist, genre, file_path`,
            [
                'Kikumi-Kukinakyo',                    // title
                'Julie K',                             // artist  
                'Kadongo Kamu',                        // genre
                '3:45',                                // duration
                'https://pub-1004f9c2790e44689198e9849c00fb9b.r2.dev/songs/kikumi-kukinakyo-julie-k.mp3',  // file_path
                'https://pub-1004f9c2790e44689198e9849c00fb9b.r2.dev/covers/default-cover.svg',  // cover_path
                true                                   // approved - TRUE so it shows up immediately
            ]
        );

        console.log('✅ SUCCESS! Song added to database:');
        console.log('');
        console.log(`   Song ID: ${result.rows[0].id}`);
        console.log(`   Title:   ${result.rows[0].title}`);
        console.log(`   Artist:  ${result.rows[0].artist}`);
        console.log(`   Genre:   ${result.rows[0].genre}`);
        console.log('');
        console.log(`📱 You can now access it at:`);
        console.log(`   https://www.djmusta.com/song/kikumi-kukinakyo/julie-k`);
        console.log('');
        console.log('⚠️  NOTE: Make sure the MP3 file exists at the file_path URL');
        console.log(`   If the actual file is somewhere else, update the file_path in the database`);
        
        await pool.end();
        process.exit(0);

    } catch (error) {
        console.error('❌ ERROR inserting song:');
        console.error(error.message);
        
        if (error.code === '23505') {
            console.error('\n⚠️  Song with this title may already exist');
        }
        
        await pool.end();
        process.exit(1);
    }
}

console.log('🎵 Adding "Kikumi-Kukinakyo" by Julie K to database...\n');
insertSong();
