/**
 * ============================================================
 * DJ MUSTA — Cloudflare Worker for SEO Song Pre-rendering
 * Deploy this in: Cloudflare Dashboard → Workers & Pages → Workers
 * Then bind it to djmusta.com via a Route
 *
 * What it does:
 *  - When Google (or anyone) visits /song/some-song-title
 *    it fetches the real song data from your API and returns
 *    a fully-rendered HTML page with all meta tags filled in.
 *  - Normal visitors get the same page, which auto-redirects
 *    them into your SPA after 2 seconds.
 *  - All other pages (/new-music, /gospel, etc.) pass through
 *    to your static Cloudflare Pages site as normal.
 * ============================================================
 */

const API_BASE   = 'https://mustabackend-nenb.onrender.com';
const SITE_URL   = 'https://djmusta.com';
const SITE_NAME  = 'DJ Musta Music';
const DEFAULT_IMG = `${SITE_URL}/banner.jpg`;
const FAVICON    = `${SITE_URL}/favicon.svg`;

// ────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Intercept /song/* routes
    if (path.startsWith('/song/')) {
      return handleSongRoute(path, url);
    }

    // Intercept /artist/* routes
    if (path.startsWith('/artist/')) {
      return handleArtistRoute(path, url);
    }

    // Everything else — pass through to Cloudflare Pages
    return fetch(request);
  }
};

// ────────────────────────────────────────────────────────────
// HANDLE /song/:slug
// ────────────────────────────────────────────────────────────
async function handleSongRoute(path, url) {
  const slug = path.replace('/song/', '').replace(/\/$/, '');

  if (!slug) {
    return Response.redirect(SITE_URL, 302);
  }

  try {
    console.log(`[Worker] Handling /song/${slug}`);
    
    // 1. Try to find the song by slug from the API
    const song = await fetchSongBySlug(slug);

    if (!song) {
      // Song not found — serve a basic meta page that redirects home
      console.log(`[Worker] Song not found for slug: ${slug}`);
      return serveNotFound(slug);
    }

    console.log(`[Worker] Found song: ${song.title} by ${song.artist}`);
    // 2. Serve a fully pre-rendered HTML page for this song
    return serveSongPage(song, url);

  } catch (err) {
    console.error('[Worker] Unhandled error:', err);
    // On any error, fall back to the main site
    return Response.redirect(SITE_URL, 302);
  }
}

// ────────────────────────────────────────────────────────────
// HANDLE /artist/:name
// ────────────────────────────────────────────────────────────
async function handleArtistRoute(path, url) {
  const artistName = path.replace('/artist/', '').replace(/\/$/, '');

  if (!artistName) {
    return Response.redirect(SITE_URL, 302);
  }

  try {
    console.log(`[Worker] Handling /artist/${artistName}`);
    
    // Fetch all songs by this artist
    const songs = await fetchSongsByArtist(artistName);

    if (!songs || songs.length === 0) {
      console.log(`[Worker] No songs found for artist: ${artistName}`);
      return serveArtistNotFound(artistName);
    }

    console.log(`[Worker] Found ${songs.length} songs for ${artistName}`);
    return serveArtistPage(artistName, songs, url);

  } catch (err) {
    console.error('[Worker] Artist route error:', err);
    return Response.redirect(SITE_URL, 302);
  }
}

// ────────────────────────────────────────────────────────────
// FETCH ALL SONGS BY ARTIST
// ────────────────────────────────────────────────────────────
async function fetchSongsByArtist(artistName) {
  if (!artistName) return [];

  try {
    const res = await fetch(
      `${API_BASE}/api/songs?search=${encodeURIComponent(artistName)}&limit=50`,
      { 
        headers: { 'User-Agent': 'DJMusta-SEO-Bot/1.0' },
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!res.ok) throw new Error(`API returned ${res.status}`);

    const data = await res.json();
    const allSongs = Array.isArray(data.songs) ? data.songs : [];

    // Filter to songs by this artist (close match on name)
    const artistSlug = createSlug(artistName);
    const filteredSongs = allSongs.filter(s =>
      s && s.artist && createSlug(s.artist) === artistSlug
    );

    return filteredSongs.length > 0 ? filteredSongs : allSongs.slice(0, 20);

  } catch (err) {
    console.warn('[Worker] Error fetching artist songs:', err.message);
    return [];
  }
}

// ────────────────────────────────────────────────────────────
// SERVE ARTIST PROFILE PAGE
// ────────────────────────────────────────────────────────────
function serveArtistPage(artistName, songs, requestUrl) {
  const artistSlug = createSlug(artistName);
  const artistUrl = `${SITE_URL}/artist/${artistSlug}`;
  
  // Get unique genres from songs
  const genres = [...new Set(songs.map(s => s.genre).filter(Boolean))].slice(0, 3);
  const genreText = genres.length > 0 ? genres.join(', ') : 'Ugandan Music';
  
  // Use first song's cover if available, or artist's cover
  const coverUrl = songs.find(s => s.cover_image || s.cover_path)
    ? (songs[0].cover_image || songs[0].cover_path).startsWith('http')
      ? (songs[0].cover_image || songs[0].cover_path)
      : `${API_BASE}${songs[0].cover_image || songs[0].cover_path}`
    : DEFAULT_IMG;

  const totalStreams = songs.reduce((sum, s) => sum + (Number(s.play_count) || 0), 0);
  const pageTitle = `${artistName} Songs | Free Music Stream & Download | ${SITE_NAME}`;
  const description = `Discover and stream ${songs.length} songs by ${artistName} on DJ Musta. Genres: ${genreText}. Download all ${artistName} music for free. Total: ${totalStreams.toLocaleString()} streams.`;

  // JSON-LD MusicGroup schema
  const schemaObj = {
    '@context': 'https://schema.org',
    '@type': 'MusicGroup',
    '@id': artistUrl,
    'name': artistName,
    'url': artistUrl,
    'description': description,
    'image': coverUrl,
    'genre': genres.length > 0 ? genres : ['Ugandan Music'],
    'publisher': {
      '@type': 'Organization',
      'name': SITE_NAME,
      'url': SITE_URL,
      'logo': { '@type': 'ImageObject', 'url': FAVICON }
    },
    'track': songs.slice(0, 10).map(s => ({
      '@type': 'MusicRecording',
      'name': s.title,
      'url': `${SITE_URL}/song/${createSlug(s.title)}/${createSlug(s.artist)}`,
      'image': (s.cover_image || s.cover_path)?.startsWith('http') 
        ? (s.cover_image || s.cover_path)
        : `${API_BASE}${s.cover_image || s.cover_path}`
    }))
  };
  const schema = JSON.stringify(schemaObj);

  const songListHTML = songs.slice(0, 30).map((song, i) => `
    <tr>
      <td style="padding:12px; border-bottom:1px solid #334155; text-align:center; color:#94A3B8">${i + 1}</td>
      <td style="padding:12px; border-bottom:1px solid #334155">
        <a href="/song/${createSlug(song.title)}/${createSlug(song.artist)}" style="color:#a855f7; text-decoration:none; font-weight:600">${escHtml(song.title)}</a>
      </td>
      <td style="padding:12px; border-bottom:1px solid #334155; color:#94A3B8">${escHtml(song.genre || 'N/A')}</td>
      <td style="padding:12px; border-bottom:1px solid #334155; text-align:center; color:#64748B">${song.play_count || 0}</td>
      <td style="padding:12px; border-bottom:1px solid #334155; text-align:center">
        <a href="/?song=${song.id}" style="color:#a855f7; text-decoration:none; font-weight:600">Play</a>
      </td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">

<!-- Primary SEO -->
<title>${escHtml(pageTitle)}</title>
<meta name="description" content="${escHtml(description)}">
<meta name="keywords" content="${escHtml(artistName)}, ${genreText}, Uganda music, free download, stream, DJ Musta">
<meta name="author" content="${escHtml(artistName)}">
<link rel="canonical" href="${artistUrl}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">

<!-- Open Graph -->
<meta property="og:type" content="music.musician">
<meta property="og:title" content="${escHtml(pageTitle)}">
<meta property="og:description" content="${escHtml(description)}">
<meta property="og:image" content="${escHtml(coverUrl)}">
<meta property="og:url" content="${artistUrl}">
<meta property="og:site_name" content="${SITE_NAME}">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(pageTitle)}">
<meta name="twitter:description" content="${escHtml(description)}">
<meta name="twitter:image" content="${escHtml(coverUrl)}">

<!-- Favicons -->
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="shortcut icon" href="/favicon.ico">
<meta name="theme-color" content="#a855f7">

<!-- JSON-LD Structured Data -->
<script type="application/ld+json">${schema}</script>

<!-- Breadcrumb -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE_URL}" },
    { "@type": "ListItem", "position": 2, "name": "${escHtml(artistName)}", "item": "${artistUrl}" }
  ]
}
</script>

<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-RXCS6LWMP9"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-RXCS6LWMP9');</script>

<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#F1F5F9;padding:20px}
  .container{max-width:1000px;margin:0 auto}
  .header{text-align:center;margin-bottom:40px;padding-top:20px}
  .cover{width:200px;height:200px;border-radius:14px;object-fit:cover;margin:0 auto 20px;box-shadow:0 8px 30px rgba(0,0,0,.4)}
  .artist-name{font-size:36px;font-weight:800;margin-bottom:10px;background:linear-gradient(135deg,#a855f7,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .info{display:flex;gap:20px;justify-content:center;margin-bottom:20px;flex-wrap:wrap}
  .info-item{text-align:center}
  .info-label{font-size:12px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px}
  .info-value{font-size:20px;font-weight:700;color:#F1F5F9;margin-top:5px}
  .genres{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:20px}
  .genre-tag{background:rgba(168,85,247,.2);color:#c084fc;padding:6px 14px;border-radius:50px;font-size:12px;font-weight:700;text-transform:uppercase}
  .browse-btn{background:linear-gradient(135deg,#a855f7,#6366f1);color:white;border:none;padding:14px 32px;border-radius:50px;font-size:15px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block;margin:20px 0;transition:all .2s}
  .browse-btn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(168,85,247,.4)}
  .table-section{background:#1E293B;border-radius:14px;padding:20px;overflow-x:auto}
  .table-title{font-size:18px;font-weight:700;margin-bottom:16px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:12px;border-bottom:2px solid #334155;color:#94A3B8;font-weight:700;text-transform:uppercase;font-size:12px}
  a{color:#a855f7;text-decoration:none}
  a:hover{text-decoration:underline}
  @media(max-width:768px){.artist-name{font-size:24px}.info{flex-direction:column}.cover{width:150px;height:150px}}
</style>
</head>
<body>

<div class="container">
  <div class="header">
    <img class="cover" src="${escHtml(coverUrl)}" alt="${escHtml(artistName)}" onerror="this.style.display='none'">
    <h1 class="artist-name">${escHtml(artistName)}</h1>
    
    <div class="genres">
      ${genres.map(g => `<span class="genre-tag">${escHtml(g)}</span>`).join('')}
    </div>

    <div class="info">
      <div class="info-item">
        <div class="info-label">Total Songs</div>
        <div class="info-value">${songs.length}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Total Streams</div>
        <div class="info-value">${totalStreams.toLocaleString()}</div>
      </div>
    </div>

    <a href="/?search=${encodeURIComponent(artistName)}" class="browse-btn">Browse All Songs</a>
  </div>

  <div class="table-section">
    <div class="table-title">🎵 Songs by ${escHtml(artistName)}</div>
    <table>
      <thead>
        <tr>
          <th style="width:50px">#</th>
          <th>Song Title</th>
          <th style="width:120px">Genre</th>
          <th style="width:80px">Plays</th>
          <th style="width:60px">Action</th>
        </tr>
      </thead>
      <tbody>
        ${songListHTML}
      </tbody>
    </table>
  </div>

  <div style="text-align:center; margin-top:40px; padding:20px; color:#64748B; font-size:14px">
    <p>🎵 ${songs.length} songs by ${escHtml(artistName)} on DJ Musta</p>
    <a href="${SITE_URL}" style="color:#a855f7">Back to DJ Musta</a>
  </div>
</div>

</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=7200',
      'X-Robots-Tag': 'index, follow'
    }
  });
}

// ────────────────────────────────────────────────────────────
// ARTIST NOT FOUND
// ────────────────────────────────────────────────────────────
function serveArtistNotFound(artistName) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escHtml(artistName)} | DJ Musta Uganda Music</title>
<meta name="description" content="Search for songs by ${escHtml(artistName)} and thousands of other Ugandan artists on DJ Musta.">
<link rel="canonical" href="${SITE_URL}/artist/${createSlug(artistName)}">
<meta name="robots" content="noindex, follow">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:sans-serif;background:#0F172A;color:#F1F5F9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;text-align:center}
  h1{font-size:24px;margin-bottom:10px}p{color:#94A3B8;margin-bottom:20px}
  a{color:#a855f7;font-weight:700;font-size:15px}
</style>
</head>
<body>
  <div>
    <div style="font-size:56px;margin-bottom:16px">🎤</div>
    <h1>${escHtml(artistName)}</h1>
    <p>No songs found by this artist yet. Search for more songs.</p>
    <a href="${SITE_URL}?search=${encodeURIComponent(artistName)}">🔍 Search on DJ Musta</a>
  </div>
  <script>setTimeout(()=>location.href='${SITE_URL}?search=${encodeURIComponent(artistName)}',3000)</script>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// ────────────────────────────────────────────────────────────
// FETCH SONG BY SLUG FROM API
// ────────────────────────────────────────────────────────────
async function fetchSongBySlug(slug) {
  if (!slug) return null;
  
  // slug can be "title-slug/artist-slug" or just "title-slug"
  const parts = slug.split('/');
  const titleSlug = parts[0];
  const artistSlug = parts[1] || null;
  if (!titleSlug) return null;
  
  // Convert slug back to search term
  const searchTerm = titleSlug.replace(/-/g, ' ');

  try {
    // Try search endpoint with generous limit
    const res = await fetch(
      `${API_BASE}/api/songs?search=${encodeURIComponent(searchTerm)}&limit=20`,
      { 
        headers: { 'User-Agent': 'DJMusta-SEO-Bot/1.0' },
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!res.ok) throw new Error(`API search returned ${res.status}`);

    const data = await res.json();
    const songs = Array.isArray(data.songs) ? data.songs : [];

    if (!songs.length) return null;

    // 1. Exact match: both title and artist slug match
    if (artistSlug) {
      const exact = songs.find(s =>
        s && s.title && s.artist &&
        createSlug(s.title) === titleSlug &&
        createSlug(s.artist) === artistSlug
      );
      if (exact) return exact;
    }

    // 2. Title slug matches exactly (ignore artist)
    const titleMatch = songs.find(s =>
      s && s.title && createSlug(s.title) === titleSlug
    );
    if (titleMatch) return titleMatch;

    // 3. Fuzzy: title slug starts with or contains the search slug
    const fuzzy = songs.find(s =>
      s && s.title && createSlug(s.title).includes(titleSlug.substring(0, 20))
    );
    if (fuzzy) return fuzzy;

    // 4. Return first result if only one word search term (common for short titles)
    if (searchTerm.split(' ').length <= 2) return songs[0];

    return null;

  } catch (err) {
    console.warn('Worker song search error:', err.message);
    
    // Fallback: try numeric ID if slug is a number
    if (/^\d+$/.test(titleSlug)) {
      try {
        const res2 = await fetch(`${API_BASE}/api/songs/${titleSlug}`, {
          signal: AbortSignal.timeout(8000)
        });
        if (res2.ok) {
          const data2 = await res2.json();
          return data2.song || data2 || null;
        }
      } catch (e) {
        console.warn('Worker numeric ID fallback failed:', e.message);
      }
    }
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// CREATE URL SLUG (must match song-router.js logic)
// ────────────────────────────────────────────────────────────
function createSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
}

// ────────────────────────────────────────────────────────────
// SERVE FULL PRE-RENDERED SONG PAGE
// ────────────────────────────────────────────────────────────
function serveSongPage(song, requestUrl) {
  const slug        = createSlug(song.title);
  const artistSlug  = createSlug(song.artist);
  const songUrl     = `${SITE_URL}/song/${slug}/${artistSlug}`;
  const coverRaw    = song.cover_image || song.cover_path || '';
  const coverUrl    = coverRaw
    ? (coverRaw.startsWith('http') ? coverRaw : `${API_BASE}${coverRaw}`)
    : DEFAULT_IMG;

  const pageTitle   = `${song.title} by ${song.artist} — Stream & Download Free | ${SITE_NAME}`;
  const description = `Stream and download "${song.title}" by ${song.artist} for free on DJ Musta — Uganda's #1 Music Platform. Genre: ${song.genre || 'Ugandan Music'}. Free MP3 download.`;
  const playCount   = song.play_count ? `${Number(song.play_count).toLocaleString()} streams` : '';
  const durationSec = durationToSeconds(song.duration);

  // JSON-LD MusicRecording schema (clean undefined values)
  const schemaObj = {
    '@context': 'https://schema.org',
    '@type': 'MusicRecording',
    '@id': songUrl,
    'name': song.title || 'Untitled',
    'url': songUrl,
    'description': description,
    'genre': song.genre || 'Ugandan Music',
    'image': coverUrl,
    'byArtist': {
      '@type': 'MusicGroup',
      'name': song.artist || 'Unknown Artist',
      'url': `${SITE_URL}?search=${encodeURIComponent(song.artist || 'artist')}`
    },
    'publisher': {
      '@type': 'Organization',
      'name': SITE_NAME,
      'url': SITE_URL,
      'logo': { '@type': 'ImageObject', 'url': FAVICON }
    },
    'offers': {
      '@type': 'Offer',
      'price': '0',
      'priceCurrency': 'UGX',
      'availability': 'https://schema.org/InStock',
      'url': songUrl
    },
    'potentialAction': [
      { '@type': 'ListenAction', 'target': songUrl },
      { '@type': 'DownloadAction', 'target': `${API_BASE}/api/songs/${song.id}/download-file` }
    ]
  };
  if (durationSec) schemaObj.duration = `PT${durationSec}S`;
  const schema = JSON.stringify(schemaObj);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">

<!-- Primary SEO -->
<title>${escHtml(pageTitle)}</title>
<meta name="description" content="${escHtml(description)}">
<meta name="keywords" content="${escHtml(song.title)}, ${escHtml(song.artist)}, Uganda music, free download, stream, DJ Musta, ${escHtml(song.genre || 'Ugandan music')}">
<meta name="author" content="${escHtml(song.artist)}">
<link rel="canonical" href="${songUrl}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">

<!-- Open Graph (Facebook / WhatsApp sharing) -->
<meta property="og:type" content="music.song">
<meta property="og:title" content="${escHtml(pageTitle)}">
<meta property="og:description" content="${escHtml(description)}">
<meta property="og:image" content="${escHtml(coverUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${songUrl}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="music:musician" content="${escHtml(song.artist)}">
${durationSec ? `<meta property="music:duration" content="${durationSec}">` : ''}

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(pageTitle)}">
<meta name="twitter:description" content="${escHtml(description)}">
<meta name="twitter:image" content="${escHtml(coverUrl)}">
<meta name="twitter:site" content="@djmusta">

<!-- Favicons -->
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="shortcut icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#a855f7">

<!-- Preload main site assets for fast redirect -->
<link rel="preload" href="/index.html" as="document">
<link rel="dns-prefetch" href="${API_BASE}">

<!-- JSON-LD Structured Data -->
<script type="application/ld+json">${schema}</script>

<!-- Breadcrumb JSON-LD -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE_URL}" },
    { "@type": "ListItem", "position": 2, "name": "${escHtml(song.genre || 'Music')}", "item": "${SITE_URL}/new-music" },
    { "@type": "ListItem", "position": 3, "name": "${escHtml(song.title)}", "item": "${songUrl}" }
  ]
}
</script>

<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-RXCS6LWMP9"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-RXCS6LWMP9');</script>

<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#F1F5F9;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px}
  .card{background:#1E293B;border-radius:20px;padding:32px;max-width:480px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);border:1px solid #334155}
  .cover{width:200px;height:200px;border-radius:14px;object-fit:cover;margin:0 auto 20px;display:block;box-shadow:0 8px 30px rgba(0,0,0,.4)}
  .cover-placeholder{width:200px;height:200px;border-radius:14px;margin:0 auto 20px;background:linear-gradient(135deg,#2d1b4e,#1a1f3a);display:flex;align-items:center;justify-content:center;font-size:64px}
  .title{font-size:22px;font-weight:800;margin-bottom:6px;line-height:1.2}
  .artist{font-size:15px;color:#94A3B8;margin-bottom:4px}
  .genre{display:inline-block;background:rgba(168,85,247,.2);color:#c084fc;padding:3px 12px;border-radius:50px;font-size:11px;font-weight:700;margin-bottom:16px;text-transform:uppercase;letter-spacing:.5px}
  .plays{font-size:12px;color:#64748B;margin-bottom:20px}
  .btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:24px}
  .btn-play{background:linear-gradient(135deg,#a855f7,#6366f1);color:white;border:none;padding:12px 28px;border-radius:50px;font-size:14px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:8px;transition:all .2s}
  .btn-play:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(168,85,247,.4)}
  .btn-dl{background:rgba(16,185,129,.15);color:#34d399;border:1px solid rgba(16,185,129,.3);padding:12px 24px;border-radius:50px;font-size:14px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:8px;transition:all .2s}
  .btn-dl:hover{background:rgba(16,185,129,.25);transform:translateY(-2px)}
  .redirect-msg{font-size:12px;color:#475569;margin-top:8px}
  .site-link{color:#a855f7;font-size:13px;font-weight:600;text-decoration:none}
  .site-link:hover{text-decoration:underline}
  .progress{width:100%;height:3px;background:#334155;border-radius:2px;overflow:hidden;margin-bottom:8px}
  .progress-bar{height:100%;background:linear-gradient(90deg,#a855f7,#6366f1);border-radius:2px;animation:load 2s linear forwards}
  @keyframes load{from{width:0}to{width:100%}}
  @media(max-width:480px){.card{padding:24px}.cover,.cover-placeholder{width:160px;height:160px}}
</style>
</head>
<body>

<div class="card">
  ${coverRaw
    ? `<img class="cover" src="${escHtml(coverUrl)}" alt="${escHtml(song.title)} by ${escHtml(song.artist)}" onerror="this.style.display='none';document.getElementById('ph').style.display='flex'">`
    : ''}
  <div class="cover-placeholder" id="ph" style="display:${coverRaw ? 'none' : 'flex'}">🎵</div>

  <div class="title">${escHtml(song.title)}</div>
  <div class="artist">by ${escHtml(song.artist)}</div>
  ${song.genre ? `<span class="genre">${escHtml(song.genre)}</span>` : ''}
  ${playCount ? `<div class="plays">▶ ${playCount}</div>` : ''}

  <div class="btns">
    <a class="btn-play" href="/?song=${song.id}">▶ Stream Free</a>
    <a class="btn-dl" href="${API_BASE}/api/songs/${song.id}/download-file" target="_blank" rel="noopener">⬇ Download MP3</a>
  </div>

  <div class="progress"><div class="progress-bar"></div></div>
  <div class="redirect-msg">Opening DJ Musta player…</div>

  <br>
  <a class="site-link" href="${SITE_URL}">🎵 Browse all Uganda Music on DJ Musta</a>
</div>

<!-- Auto-redirect to full SPA player after 2s -->
<script>
  setTimeout(function() {
    window.location.href = '/?song=${song.id}';
  }, 2000);
</script>

</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=7200',
      'X-Robots-Tag': 'index, follow'
    }
  });
}

// ────────────────────────────────────────────────────────────
// 404 PAGE — song not found in API, fall through to SPA
// The SPA's song-router.js will try again client-side
// ────────────────────────────────────────────────────────────
function serveNotFound(slug) {
  const title = slug.split('/')[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  // Serve the full SPA (index.html content) so song-router.js
  // can attempt to resolve the slug client-side
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escHtml(title)} | DJ Musta Uganda Music</title>
<meta name="description" content="Stream and download ${escHtml(title)} and thousands of Ugandan songs free on DJ Musta.">
<link rel="canonical" href="${SITE_URL}/song/${slug}">
<meta name="robots" content="index, follow">
<meta property="og:title" content="${escHtml(title)} | DJ Musta">
<meta property="og:description" content="Stream and download ${escHtml(title)} free on DJ Musta — Uganda's #1 Music Platform.">
<meta property="og:image" content="${DEFAULT_IMG}">
<meta property="og:url" content="${SITE_URL}/song/${slug}">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:sans-serif;background:#0F172A;color:#F1F5F9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;text-align:center}
  h2{font-size:22px;margin-bottom:10px;color:#F1F5F9}
  p{color:#94A3B8;margin-bottom:24px;font-size:15px;line-height:1.6}
  .btn{background:linear-gradient(135deg,#a855f7,#6366f1);color:white;border:none;padding:14px 32px;border-radius:50px;font-size:15px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block;margin:8px;transition:all .2s}
  .btn:hover{transform:translateY(-2px);opacity:.9}
  .bar{width:200px;height:3px;background:#334155;border-radius:2px;margin:16px auto 8px;overflow:hidden}
  .bar-fill{height:100%;background:linear-gradient(90deg,#a855f7,#6366f1);border-radius:2px;animation:load 2s linear forwards}
  @keyframes load{from{width:0}to{width:100%}}
  .msg{font-size:12px;color:#475569}
</style>
</head>
<body>
  <div>
    <div style="font-size:56px;margin-bottom:16px">🎵</div>
    <h2>${escHtml(title)}</h2>
    <p>Loading song on DJ Musta…<br>If it doesn't load, search for it below.</p>
    <div class="bar"><div class="bar-fill"></div></div>
    <div class="msg">Redirecting to DJ Musta player…</div>
    <br><br>
    <a class="btn" href="${SITE_URL}?search=${encodeURIComponent(slug.split('/')[0].replace(/-/g, ' '))}">🔍 Search on DJ Musta</a>
  </div>
  <script>
    // Try loading the SPA which will attempt to resolve this slug client-side
    setTimeout(function() {
      window.location.href = '${SITE_URL}/?song_slug=${encodeURIComponent(slug)}';
    }, 1500);
  </script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────
function durationToSeconds(dur) {
  if (!dur) return 0;
  try {
    const parts = String(dur).trim().split(':');
    const mins = parseInt(parts[0]) || 0;
    const secs = parseInt(parts[1]) || 0;
    return Math.max(0, mins * 60 + secs);
  } catch (e) {
    return 0;
  }
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
