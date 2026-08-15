// ============================================================
// AUTOMATIC SITEMAP UPDATER
// Updates sitemap.xml when new songs are published
// ============================================================

const fs = require('fs');
const path = require('path');

// Configuration
const SITEMAP_PATH = process.env.SITEMAP_PATH || path.join(__dirname, '../DEPLOY-THIS/sitemap.xml');
const SITE_URL = process.env.SITE_URL || 'https://main.djmusta.pages.dev';

/**
 * Update sitemap.xml with new song entry
 * @param {Object} song - Song object with id, title, artist, slug
 */
function updateSitemap(song) {
    try {
        // Read current sitemap
        let sitemap = fs.readFileSync(SITEMAP_PATH, 'utf8');
        
        // Create SEO-friendly slug from title
        const slug = createSlug(song.title);
        const songUrl = `${SITE_URL}/song/${slug}`;
        
        // Create new URL entry
        const newEntry = `  <url>
    <loc>${songUrl}</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
`;
        
        // Check if URL already exists
        if (sitemap.includes(songUrl)) {
            console.log(`✓ Sitemap already contains: ${songUrl}`);
            return;
        }
        
        // Insert before closing </urlset> tag
        sitemap = sitemap.replace('</urlset>', newEntry + '</urlset>');
        
        // Write updated sitemap
        fs.writeFileSync(SITEMAP_PATH, sitemap, 'utf8');
        
        console.log(`✓ Sitemap updated with: ${songUrl}`);
        console.log(`  Song: ${song.title} by ${song.artist}`);
        
        return true;
    } catch (error) {
        console.error('✗ Error updating sitemap:', error.message);
        return false;
    }
}

/**
 * Create SEO-friendly slug from song title
 * @param {String} title - Song title
 * @returns {String} URL-safe slug
 */
function createSlug(title) {
    if (!title) return 'untitled-song';
    
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with dashes
        .replace(/^-+|-+$/g, '')       // Remove leading/trailing dashes
        .substring(0, 60);              // Max 60 chars for reasonable URLs
}

/**
 * Generate complete sitemap from database
 * @param {Array} songs - Array of approved songs
 */
function generateSitemap(songs = []) {
    try {
        let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
`;
        
        // Add each song with SEO-friendly URL
        songs.forEach(song => {
            const slug = createSlug(song.title);
            sitemap += `  <url>
    <loc>${SITE_URL}/song/${slug}</loc>
    <lastmod>${new Date(song.created_at || song.approved_at || Date.now()).toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
`;
        });
        
        sitemap += '</urlset>\n';
        
        // Write sitemap
        fs.writeFileSync(SITEMAP_PATH, sitemap, 'utf8');
        
        console.log(`✓ Sitemap generated with ${songs.length} songs`);
        return true;
    } catch (error) {
        console.error('✗ Error generating sitemap:', error.message);
        return false;
    }
}

/**
 * Remove song from sitemap
 * @param {String} songId - Song ID or slug
 */
function removeSongFromSitemap(songId) {
    try {
        let sitemap = fs.readFileSync(SITEMAP_PATH, 'utf8');
        
        // Find and remove the song's URL entry
        const urlPattern = new RegExp(`  <url>\\s*<loc>${SITE_URL}/song/[^<]*${songId}[^<]*</loc>[^<]*(?:<[^>]+>[^<]*</[^>]+>\\s*)*</url>\\s*`, 'g');
        
        sitemap = sitemap.replace(urlPattern, '');
        
        fs.writeFileSync(SITEMAP_PATH, sitemap, 'utf8');
        
        console.log(`✓ Removed song ${songId} from sitemap`);
        return true;
    } catch (error) {
        console.error('✗ Error removing from sitemap:', error.message);
        return false;
    }
}

/**
 * Notify search engines about sitemap update
 */
async function pingSearchEngines() {
    const sitemapUrl = encodeURIComponent(`${SITE_URL}/sitemap.xml`);
    
    const pingUrls = [
        `https://www.google.com/ping?sitemap=${sitemapUrl}`,
        `https://www.bing.com/ping?sitemap=${sitemapUrl}`
    ];
    
    for (const url of pingUrls) {
        try {
            const https = require('https');
            await new Promise((resolve, reject) => {
                https.get(url, (res) => {
                    console.log(`✓ Pinged search engine: ${url.split('//')[1].split('/')[0]}`);
                    resolve();
                }).on('error', reject);
            });
        } catch (error) {
            console.log(`✗ Failed to ping: ${url}`);
        }
    }
}

module.exports = {
    updateSitemap,
    generateSitemap,
    removeSongFromSitemap,
    pingSearchEngines,
    createSlug
};
