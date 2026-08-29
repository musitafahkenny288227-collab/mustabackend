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
    ssl: { rejectUnauthorized: false }
});

async function main() {
    try {
        console.log('🔄 Fetching all approved songs from database...');
        
        const result = await pool.query('SELECT id, title, artist, created_at FROM songs WHERE approved = TRUE ORDER BY created_at DESC');
        
        const songs = result.rows;
        
        console.log(`✓ Found ${songs.length} approved songs`);
        console.log('🔄 Generating sitemap.xml...');
        
        const success = generateSitemap(songs);
        
        if (success) {
            console.log('✅ Sitemap generated successfully!');
            console.log(`📍 Location: ${process.env.SITEMAP_PATH || '../DEPLOY-THIS/sitemap.xml'}`);
            console.log(`📊 Total entries: ${songs.length + 1} (homepage + ${songs.length} songs)`);
        } else {
            console.error('❌ Failed to generate sitemap');
            process.exit(1);
        }
        
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main();
