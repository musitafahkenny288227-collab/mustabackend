/**
 * ============================================================
 * DJ MUSTA — Auto Sitemap Generator
 * ============================================================
 * Run with Node.js:
 *   node generate-sitemap.js
 *
 * This fetches ALL songs from your backend API and writes
 * a fresh sitemap.xml with every song's /song/title/artist URL.
 * Run this after uploading new songs, then redeploy.
 * ============================================================
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const API_BASE  = 'https://mustabackend-nenb.onrender.com';
const SITE_URL  = 'https://djmusta.com';
const OUT_FILE  = path.join(__dirname, 'sitemap.xml');
const TODAY     = new Date().toISOString().split('T')[0];

// ── Slug helper (must match worker.js + song-router.js) ──────
function createSlug(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
}

// ── Simple HTTP GET helper ────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse failed: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

// ── Fetch ALL songs in pages of 100 ─────────────────────────
async function fetchAllSongs() {
  const allSongs = [];
  let offset = 0;
  const limit = 100;

  console.log('Fetching songs from API...');

  while (true) {
    const url = `${API_BASE}/api/songs?limit=${limit}&offset=${offset}&category=all`;
    console.log(`  GET ${url}`);

    const data = await get(url);
    const songs = data.songs || [];

    if (!songs.length) break;

    allSongs.push(...songs);
    console.log(`  Fetched ${allSongs.length} songs so far...`);

    if (songs.length < limit) break; // last page
    offset += limit;
  }

  console.log(`✅ Total songs fetched: ${allSongs.length}`);
  return allSongs;
}

// ── Build sitemap XML ─────────────────────────────────────────
function buildSitemap(songs) {
  // Static pages
  const staticPages = [
    { url: SITE_URL,                     changefreq: 'daily',   priority: '1.0' },
    { url: `${SITE_URL}/new-music`,      changefreq: 'daily',   priority: '0.95' },
    { url: `${SITE_URL}/top-songs`,      changefreq: 'weekly',  priority: '0.92' },
    { url: `${SITE_URL}/top-artists`,    changefreq: 'weekly',  priority: '0.90' },
    { url: `${SITE_URL}/nonstops`,       changefreq: 'weekly',  priority: '0.88' },
    { url: `${SITE_URL}/gospel`,         changefreq: 'weekly',  priority: '0.88' },
  ];

  const staticXml = staticPages.map(p => `
  <url>
    <loc>${p.url}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('');

  // Song pages
  const songXml = songs.map(s => {
    const slug    = `${createSlug(s.title)}/${createSlug(s.artist)}`;
    const songUrl = `${SITE_URL}/song/${slug}`;
    const lastmod = s.created_at
      ? new Date(s.created_at).toISOString().split('T')[0]
      : TODAY;
    const title   = (s.title  || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const artist  = (s.artist || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    return `
  <url>
    <loc>${songUrl}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
    <news:news>
      <news:publication>
        <news:name>DJ Musta Music</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:title>Stream ${title} by ${artist}</news:title>
      <news:publication_date>${lastmod}</news:publication_date>
    </news:news>
  </url>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${staticXml}
${songXml}
</urlset>`;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  try {
    console.log('🎵 DJ Musta Sitemap Generator');
    console.log('================================');

    const songs  = await fetchAllSongs();
    const xml    = buildSitemap(songs);

    fs.writeFileSync(OUT_FILE, xml, 'utf8');

    console.log(`\n✅ sitemap.xml written: ${OUT_FILE}`);
    console.log(`   Static pages : 6`);
    console.log(`   Song pages   : ${songs.length}`);
    console.log(`   Total URLs   : ${songs.length + 6}`);
    console.log('\n📌 Next steps:');
    console.log('   1. Deploy your site to Cloudflare Pages');
    console.log('   2. Go to Google Search Console → Sitemaps');
    console.log('   3. Submit: https://djmusta.com/sitemap.xml');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
