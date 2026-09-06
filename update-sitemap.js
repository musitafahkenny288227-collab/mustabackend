// ============================================================
// AUTOMATIC SITEMAP UPDATER
// Regenerates frontend/sitemap.xml whenever a song is approved.
// Also exported as generateSitemap() for the manual script.
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');

const SITE_URL     = process.env.SITE_URL     || 'https://djmusta.com';
// Path to the static sitemap served by Cloudflare Pages
const SITEMAP_PATH = process.env.SITEMAP_PATH || path.join(__dirname, '..', 'frontend', 'sitemap.xml');

// ============================================================
// HELPERS
// ============================================================
function createSlug(text) {
    if (!text) return '';
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 60);
}

function esc(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// BUILD XML
// ============================================================
function buildXml(songs) {
    const today = new Date().toISOString().split('T')[0];

    const staticPages = [
        { loc: `${SITE_URL}`,              changefreq: 'daily',  priority: '1.0' },
        { loc: `${SITE_URL}/new-music`,    changefreq: 'daily',  priority: '0.95' },
        { loc: `${SITE_URL}/top-songs`,    changefreq: 'weekly', priority: '0.92' },
        { loc: `${SITE_URL}/top-artists`,  changefreq: 'weekly', priority: '0.90' },
        { loc: `${SITE_URL}/nonstops`,     changefreq: 'weekly', priority: '0.88' },
        { loc: `${SITE_URL}/gospel`,       changefreq: 'weekly', priority: '0.88' },
        { loc: `${SITE_URL}/dancehall`,    changefreq: 'weekly', priority: '0.88' },
        { loc: `${SITE_URL}/afrobeat`,     changefreq: 'weekly', priority: '0.88' },
    ];

    const staticUrls = staticPages.map(p =>
        `  <url>\n    <loc>${p.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
    ).join('\n');

    const songUrls = songs.map(s => {
        const titleSlug  = createSlug(s.title)  || `song-${s.id}`;
        const artistSlug = createSlug(s.artist) || 'unknown';
        const songUrl    = `${SITE_URL}/song/${titleSlug}/${artistSlug}`;
        const lastmod    = s.created_at ? new Date(s.created_at).toISOString().split('T')[0] : today;
        const priority   = (s.release_year >= 2026 || s.lyrics) ? '0.9' : '0.8';
        const changefreq = s.release_year >= 2026 ? 'weekly' : 'monthly';

        // Optional image tag
        const coverUrl = s.cover_image || s.cover_path || '';
        const imageTag = coverUrl
            ? `\n    <image:image>\n      <image:loc>${esc(coverUrl.startsWith('http') ? coverUrl : SITE_URL + coverUrl)}</image:loc>\n      <image:title>${esc(s.title)} by ${esc(s.artist)}${s.release_year ? ' (' + s.release_year + ')' : ''}</image:title>\n      <image:caption>${esc(s.genre || 'Ugandan Music')} — ${esc(s.title)} by ${esc(s.artist)}${s.producer ? ', produced by ' + esc(s.producer) : ''} on DJ Musta. Free MP3 download.</image:caption>\n    </image:image>`
            : '';

        // Optional news tag (for songs less than 2 days old)
        const pubDate  = new Date(s.created_at || Date.now());
        const isRecent = (Date.now() - pubDate.getTime()) < 2 * 24 * 60 * 60 * 1000;
        const newsTag  = isRecent
            ? `\n    <news:news>\n      <news:publication>\n        <news:name>DJ Musta Music</news:name>\n        <news:language>en</news:language>\n      </news:publication>\n      <news:title>Stream ${esc(s.title)} by ${esc(s.artist)}</news:title>\n      <news:publication_date>${lastmod}</news:publication_date>\n    </news:news>`
            : '';

        return `  <url>\n    <loc>${songUrl}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>${imageTag}${newsTag}\n  </url>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">

${staticUrls}

  <!-- Song pages (${songs.length} songs) -->
${songUrls}
</urlset>`;
}

// ============================================================
// WRITE SITEMAP FILE
// Called from server.js after song approval AND from the manual script.
// ============================================================
function generateSitemap(songs) {
    try {
        const xml = buildXml(songs);
        fs.writeFileSync(SITEMAP_PATH, xml, 'utf8');
        console.log(`[Sitemap] ✅ Written to ${SITEMAP_PATH} — ${songs.length} songs + static pages`);
        return true;
    } catch (e) {
        console.error('[Sitemap] ❌ Write error:', e.message);
        return false;
    }
}

// ============================================================
// PING SEARCH ENGINES
// ============================================================
async function pingSearchEngines() {
    const sitemapUrl = encodeURIComponent(`${SITE_URL}/sitemap.xml`);
    const urls = [
        `https://www.google.com/ping?sitemap=${sitemapUrl}`,
        `https://www.bing.com/ping?sitemap=${sitemapUrl}`,
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

// ============================================================
// AUTO-UPDATE — called on song approval from server.js
// Receives the pool/query function so we don't need a second DB connection.
// ============================================================
async function updateSitemap(song, queryFn) {
    try {
        const titleSlug  = createSlug(song.title)  || `song-${song.id}`;
        const artistSlug = createSlug(song.artist) || 'unknown';
        const songUrl    = `${SITE_URL}/song/${titleSlug}/${artistSlug}`;
        console.log(`[Sitemap] New song URL: ${songUrl}`);
        console.log(`[Sitemap] Song: "${song.title}" by ${song.artist}`);

        // Re-fetch all approved songs and regenerate the static file
        if (typeof queryFn === 'function') {
            const result = await queryFn(
                'SELECT id, title, artist, genre, cover_image, cover_path, created_at, release_year, lyrics, producer FROM songs WHERE approved=TRUE ORDER BY created_at DESC'
            );
            generateSitemap(result.rows);
        } else {
            console.warn('[Sitemap] No queryFn provided — static sitemap.xml not updated. Call generateSitemap manually.');
        }

        return true;
    } catch (e) {
        console.error('[Sitemap] Error in updateSitemap:', e.message);
        return false;
    }
}

module.exports = { updateSitemap, pingSearchEngines, generateSitemap, createSlug };
