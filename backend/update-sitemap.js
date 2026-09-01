// ============================================================
// AUTOMATIC SITEMAP UPDATER
// Updates sitemap.xml when new songs are approved
// ============================================================

const fs   = require('fs');
const path = require('path');
const https = require('https');

const SITE_URL = process.env.SITE_URL || 'https://djmusta.com';

// Sitemap is served statically from Cloudflare Pages
// We ping Google/Bing after updates but don't write to a local file
// (The static sitemap.xml is deployed with the frontend)

function createSlug(text) {
    if (!text) return '';
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 60);
}

/**
 * Called when a song is approved.
 * Logs the new URL so you know what was added.
 * Full sitemap regeneration is done via the generate script.
 */
function updateSitemap(song) {
    try {
        const titleSlug  = createSlug(song.title)  || `song-${song.id}`;
        const artistSlug = createSlug(song.artist) || 'unknown';
        const songUrl    = `${SITE_URL}/song/${titleSlug}/${artistSlug}`;
        console.log(`[Sitemap] New song URL: ${songUrl}`);
        console.log(`[Sitemap] Song: "${song.title}" by ${song.artist}`);
        return true;
    } catch (e) {
        console.error('[Sitemap] Error:', e.message);
        return false;
    }
}

/**
 * Ping Google and Bing to re-crawl the sitemap
 */
async function pingSearchEngines() {
    const sitemapUrl = encodeURIComponent(`${SITE_URL}/sitemap.xml`);
    const urls = [
        `https://www.google.com/ping?sitemap=${sitemapUrl}`,
        `https://www.bing.com/ping?sitemap=${sitemapUrl}`
    ];

    for (const url of urls) {
        try {
            await new Promise((resolve) => {
                https.get(url, (res) => {
                    console.log(`[Sitemap] Pinged: ${url.split('?')[0]} → ${res.statusCode}`);
                    resolve();
                }).on('error', (e) => {
                    console.warn(`[Sitemap] Ping failed: ${e.message}`);
                    resolve();
                });
            });
        } catch (e) {
            console.warn('[Sitemap] Ping error:', e.message);
        }
    }
}

module.exports = { updateSitemap, pingSearchEngines, createSlug };
