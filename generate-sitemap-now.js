#!/usr/bin/env node
// ============================================================
// MANUAL SITEMAP GENERATOR
// Run this to regenerate entire sitemap from database
// Usage: node generate-sitemap-now.js
// ============================================================

const { Pool } = require('pg');
const { generateSitemap } = require('./update-sitemap');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_6BkZsUCnzt5P@ep-blue-wildflower-axfofbmw.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10
});

async function main() {
    console.log('🔄 Starting sitemap generation...');
    console.log('📍 Database URL:', DATABASE_URL ? 'Set ✅' : 'Not set ❌');
    
    try {
        console.log('🔄 Connecting to database...');
        
        // Test connection first
        const testResult = await pool.query('SELECT NOW()');
        console.log('✅ Database connected successfully!');
        console.log('⏰ Server time:', testResult.rows[0].now);
        
        console.log('🔄 Fetching all approved songs from database...');
        
        const result = await pool.query('SELECT id, title, artist, genre, cover_image, cover_path, created_at, release_year, lyrics, producer FROM songs WHERE approved = TRUE ORDER BY created_at DESC');
        
        const songs = result.rows;
        
        console.log(`✓ Found ${songs.length} approved songs`);
        
        if (songs.length === 0) {
            console.warn('⚠️  No approved songs found in database!');
            console.log('💡 Make sure songs have approved=TRUE in the database');
        } else {
            console.log(`📋 First 3 songs:`);
            songs.slice(0, 3).forEach((s, i) => {
                console.log(`   ${i + 1}. "${s.title}" by ${s.artist}`);
            });
        }
        
        console.log('🔄 Generating sitemap.xml...');
        
        const success = generateSitemap(songs);
        
        if (success) {
            console.log('✅ Sitemap generated successfully!');
            console.log(`📍 Location: ${process.env.SITEMAP_PATH || '../frontend/sitemap.xml'}`);
            console.log(`📊 Total entries: ${songs.length + 12} (12 static pages + ${songs.length} songs)`);
            console.log('');
            console.log('🔍 Next steps:');
            console.log('   1. Check https://djmusta.com/sitemap.xml');
            console.log('   2. Search for "kinyakula" in the sitemap');
            console.log('   3. Submit sitemap to Google Search Console');
            console.log('   4. Request indexing for specific song URLs');
        } else {
            console.error('❌ Failed to generate sitemap');
            process.exit(1);
        }
        
        await pool.end();
        console.log('✅ Database connection closed');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('📋 Full error:', error);
        
        if (error.code === 'ENOTFOUND') {
            console.error('💡 Cannot reach database server. Check your internet connection.');
        } else if (error.code === 'ECONNREFUSED') {
            console.error('💡 Database server refused connection. Check DATABASE_URL.');
        } else if (error.code === '28P01') {
            console.error('💡 Authentication failed. Check database credentials.');
        }
        
        try {
            await pool.end();
        } catch (e) {
            // Ignore cleanup errors
        }
        
        process.exit(1);
    }
}

main();
