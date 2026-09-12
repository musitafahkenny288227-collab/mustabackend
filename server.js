// ============================================================
// DJ MUSTA MUSIC - BACKEND SERVER
// Node.js + PostgreSQL (Supabase)
// Run: node server.js
// ============================================================
'use strict';

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const zlib   = require('zlib');
const { URL } = require('url');
const { Pool } = require('pg');
const webpush = require('web-push');

// ============================================================
// WEB PUSH VAPID SETUP
// ============================================================
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BAonU5h2RMD7db5Zl3gGS_01GfXP0_tevIWydLGXvX4JTJOWpkku-ag-be63rkPoGCs9CSka6y--ktyq-kJvYxw';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL   = process.env.VAPID_EMAIL       || 'mailto:musitafahkenny288227@gmail.com';

try {
    if (VAPID_PRIVATE) {
        webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
        console.log('[Push] VAPID keys configured');
    } else {
        console.warn('[Push] VAPID_PRIVATE_KEY not set — push notifications disabled.');
    }
} catch(e) {
    console.warn('[Push] VAPID setup failed:', e.message);
}

// ============================================================
// EMAIL SETUP (Brevo)
// ============================================================
const EMAIL_USER = process.env.EMAIL_USER || 'musitafahkenny288227@gmail.com';
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const SITE_URL   = process.env.SITE_URL   || 'https://djmusta.com';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

async function sendEmail(to, subject, html) {
    return new Promise((resolve) => {
        const body = JSON.stringify({
            sender: { name: 'DJ Musta Music', email: EMAIL_USER },
            to: [{ email: to }],
            subject,
            htmlContent: html
        });
        const req = https.request({
            hostname: 'api.brevo.com',
            path: '/v3/smtp/email',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': BREVO_API_KEY,
                'Content-Length': Buffer.byteLength(body)
            }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log('[Email] Sent to:', to);
                    resolve(true);
                } else {
                    console.error('[Email] Failed:', res.statusCode, data);
                    resolve(false);
                }
            });
        });
        req.on('error', e => { console.error('[Email] Error:', e.message); resolve(false); });
        req.write(body);
        req.end();
    });
}

async function sendTelegramNewSong(song) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    const esc = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const message = `🎵 <b>New Song on DJ Musta</b>\n\n<b>${esc(song.title)}</b> by ${esc(song.artist)}\n\n<a href="${SITE_URL}/?song=${encodeURIComponent(song.id)}">Listen now</a>`;
    const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' });

    await new Promise(resolve => {
        const request = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, response => {
            response.on('data', () => {});
            response.on('end', resolve);
        });
        request.on('error', () => resolve());
        request.write(body);
        request.end();
    });
}

// ============================================================
// CONFIG
// ============================================================
const PORT         = process.env.PORT || 5000;
const JWT_SECRET   = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://djmusta.com';
const DATABASE_URL = process.env.DATABASE_URL;

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET     = process.env.R2_BUCKET     || 'djmusta-music';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-1004f9c2790e44689198e9849c00fb9b.r2.dev';
const R2_ENDPOINT   = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const UPLOADS = path.join(__dirname, 'uploads');

const REQUIRED_ENV = ['JWT_SECRET', 'DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY', 'R2_SECRET_KEY'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
    console.error('❌ MISSING REQUIRED ENV VARS:', missingEnv.join(', '));
    process.exit(1);
}

// ============================================================
// SITEMAP UPDATER
// ============================================================
let updateSitemap = async () => {};
let pingSearchEngines = async () => {};
try {
    const sitemapModule = require('./update-sitemap.js');
    if (typeof sitemapModule.updateSitemap === 'function') updateSitemap = sitemapModule.updateSitemap;
    if (typeof sitemapModule.pingSearchEngines === 'function') pingSearchEngines = sitemapModule.pingSearchEngines;
} catch (e) {
    console.warn('[Sitemap] update-sitemap.js not loaded:', e.message);
}

// ============================================================
// INDEXNOW
// ============================================================
async function pingGoogleIndexNow(song) {
    try {
        const toSlug = str => (str||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').substring(0,60);
        const songUrl = `${SITE_URL}/song/${toSlug(song.title)}/${toSlug(song.artist)}`;
        const body = JSON.stringify({
            host: 'djmusta.com',
            key: process.env.INDEXNOW_KEY || 'djmusta2026',
            urlList: [songUrl]
        });
        const req = https.request({
            hostname: 'api.indexnow.org',
            path: '/indexnow',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => { console.log(`[IndexNow] ${songUrl} → ${res.statusCode}`); });
        req.on('error', () => {});
        req.write(body);
        req.end();
    } catch (e) {}
}

// ============================================================
// RATE LIMITER
// ============================================================
const rateLimits = new Map();

function rateLimit(ip, max = 60, windowMs = 60000) {
    const now  = Date.now();
    const key  = String(ip || 'unknown');
    const data = rateLimits.get(key) || { count: 0, start: now };
    if (now - data.start > windowMs) {
        data.count = 0;
        data.start = now;
    }
    data.count++;
    rateLimits.set(key, data);
    return data.count > max;
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of rateLimits.entries()) {
        if (now - data.start > 60000) rateLimits.delete(ip);
    }
}, 300000);

function authRateLimit(ip) { return rateLimit(ip + ':auth', 10, 60000); }
// ✅ FIX #4: stricter per-IP limits for expensive endpoints
function downloadRateLimit(ip) { return rateLimit(ip + ':dl', 20, 60000); }
function streamRateLimit(ip)   { return rateLimit(ip + ':stream', 60, 60000); }
function uploadRateLimit(ip)   { return rateLimit(ip + ':upload', 15, 60000); }

// ============================================================
// FILE TYPE VALIDATION
// ============================================================
const BLOCKED_EXTENSIONS = new Set([
    '.exe','.bat','.cmd','.com','.sh','.bash','.zsh','.fish',
    '.ps1','.psm1','.psd1','.vbs','.vbe','.js','.jse','.wsf',
    '.wsh','.msi','.msp','.scr','.hta','.cpl','.dll','.so',
    '.php','.php3','.php4','.php5','.phtml','.asp','.aspx',
    '.jsp','.cfm','.pl','.py','.rb','.lua','.jar','.class',
    '.elf','.bin','.run','.deb','.rpm','.apk','.dmg','.iso'
]);

const ALLOWED_AUDIO_MIME = new Set(['audio/mpeg','audio/mp3','audio/wav','audio/wave','audio/x-wav','audio/mp4','audio/m4a','audio/x-m4a']);
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg','image/jpg','image/png','image/webp','image/gif']);
const ALLOWED_AUDIO_EXT  = new Set(['.mp3','.wav','.m4a']);
const ALLOWED_IMAGE_EXT  = new Set(['.jpg','.jpeg','.png','.webp','.gif']);

function getMagicType(buf) {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'mp3';
    if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return 'mp3';
    if (buf[0]===0x52 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x46 &&
        buf[8]===0x57 && buf[9]===0x41 && buf[10]===0x56 && buf[11]===0x45) return 'wav';
    if (buf[4]===0x66 && buf[5]===0x74 && buf[6]===0x79 && buf[7]===0x70) return 'm4a';
    if (buf[0]===0xFF && buf[1]===0xD8 && buf[2]===0xFF) return 'jpeg';
    if (buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47) return 'png';
    if (buf[0]===0x47 && buf[1]===0x49 && buf[2]===0x46) return 'gif';
    if (buf[0]===0x52 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x46 &&
        buf[8]===0x57 && buf[9]===0x45 && buf[10]===0x42 && buf[11]===0x50) return 'webp';
    if (buf[0]===0x4D && buf[1]===0x5A) return 'exe';
    if (buf[0]===0x7F && buf[1]===0x45 && buf[2]===0x4C && buf[3]===0x46) return 'elf';
    if (buf[0]===0x50 && buf[1]===0x4B) return 'zip';
    if (buf[0]===0x25 && buf[1]===0x50 && buf[2]===0x44 && buf[3]===0x46) return 'pdf';
    return 'unknown';
}

const AUDIO_MAGIC = new Set(['mp3','wav','m4a']);
const IMAGE_MAGIC = new Set(['jpeg','png','gif','webp']);
const DANGEROUS_MAGIC = new Set(['exe','elf','zip']);

function validateFile(fileObj, type) {
    if (!fileObj) return null;
    const ext  = path.extname(fileObj.filename || '').toLowerCase();
    const mime = (fileObj.mimetype || '').toLowerCase();
    const buf  = fileObj.data;

    if (BLOCKED_EXTENSIONS.has(ext)) return `File type not allowed.`;
    const magic = getMagicType(buf);
    if (DANGEROUS_MAGIC.has(magic)) return 'File content detected as malicious.';

    if (type === 'audio') {
        if (!ALLOWED_AUDIO_EXT.has(ext)) return `Invalid audio extension "${ext}".`;
        if (!ALLOWED_AUDIO_MIME.has(mime)) return `Invalid audio type "${mime}".`;
        if (!AUDIO_MAGIC.has(magic)) return `File content does not match an audio file.`;
    } else if (type === 'image') {
        if (!ALLOWED_IMAGE_EXT.has(ext)) return `Invalid image extension "${ext}".`;
        if (!ALLOWED_IMAGE_MIME.has(mime)) return `Invalid image type "${mime}".`;
        if (!IMAGE_MAGIC.has(magic)) return `File content does not match an image.`;
    }

    const maxSize = type === 'audio' ? 50 * 1024 * 1024 : 5 * 1024 * 1024;
    if (buf.length > maxSize) return `File too large. Max ${type === 'audio' ? '50MB' : '5MB'}.`;
    return null;
}

// ============================================================
// DATABASE
// ============================================================
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    // ✅ FIX #33: bump pool size
    max: 15
});

async function query(sql, params = []) {
    const client = await pool.connect();
    try {
        const result = await client.query(sql, params);
        return result;
    } finally {
        client.release();
    }
}

// Public user object (moved up for clarity)
function pub(u) {
    if (!u) return null;
    return {
        id: u.id,
        username: u.username,
        email: u.email,
        isAdmin: !!u.is_admin,
        isVerified: !!u.is_verified,
        isPremium: !!u.is_premium,
        profile_photo: u.profile_photo,
        createdAt: u.created_at
    };
}

// ============================================================
// PUSH / EMAIL BROADCASTS
// ============================================================
async function sendPushToSubscribers({ title, body, songId = null, url = '/' }) {
    if (!VAPID_PRIVATE) return { sent: 0, failed: 0, total: 0, skipped: true };
    const subs = await query('SELECT endpoint, p256dh, auth FROM push_subscriptions');
    let sent = 0, failed = 0;
    const expiredEndpoints = [];
    const payload = JSON.stringify({
        title, body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        url, songId,
        tag: 'djmusta-song-' + (songId || Date.now())
    });

    await Promise.allSettled(subs.rows.map(async sub => {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload, { TTL: 86400 }
            );
            sent++;
        } catch (error) {
            failed++;
            if (error.statusCode === 404 || error.statusCode === 410) expiredEndpoints.push(sub.endpoint);
        }
    }));

    if (expiredEndpoints.length) {
        await query('DELETE FROM push_subscriptions WHERE endpoint = ANY($1)', [expiredEndpoints]);
    }
    console.log(`[Push] Sent: ${sent}, Failed: ${failed}, Expired removed: ${expiredEndpoints.length}`);
    return { sent, failed, total: subs.rows.length, expiredRemoved: expiredEndpoints.length };
}

// ✅ FIX #17: cap batch size so request doesn't time out
const EMAIL_BATCH_LIMIT = 2000;

async function emailNewSongToAllUsers(song) {
    if (!BREVO_API_KEY) return { sent: 0, failed: 0, skipped: true };

    const users = await query(
        `SELECT email, username FROM users WHERE email IS NOT NULL ORDER BY created_at DESC LIMIT $1`,
        [EMAIL_BATCH_LIMIT]
    );
    const esc = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const songUrl = `${SITE_URL}/?song=${encodeURIComponent(song.id)}`;
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0a0e27;color:#e2e8f0;padding:30px;border-radius:12px">
            <h2 style="color:#a855f7">🎵 New Song on DJ Musta</h2>
            <p>${esc(song.artist)} just released a new song.</p>
            <p style="background:#1a1f3a;padding:16px;border-radius:8px;border-left:4px solid #a855f7">
                🎵 <strong>${esc(song.title)}</strong> by ${esc(song.artist)}
            </p>
            <a href="${songUrl}" style="display:inline-block;margin:20px 0;padding:14px 28px;background:#a855f7;color:white;border-radius:8px;text-decoration:none;font-weight:700">Listen Now</a>
        </div>`;

    let sent = 0, failed = 0;
    for (const user of users.rows) {
        const ok = await sendEmail(user.email, `🎵 New Song: ${song.title} - DJ Musta`, html);
        if (ok) sent++; else failed++;
        if (sent % 50 === 0) await new Promise(r => setTimeout(r, 12000));
    }
    console.log(`[Email] New song sent: ${sent}, failed: ${failed}, total: ${users.rows.length}`);
    return { sent, failed, total: users.rows.length };
}

// Keep-alive pings
setInterval(async () => {
    try { await query('SELECT 1'); } catch(e) { console.log('[DB Keep-alive] ping failed:', e.message); }
}, 4 * 60 * 1000);

setInterval(() => {
    const url = process.env.RENDER_EXTERNAL_URL || 'https://mustabackend-nenb.onrender.com';
    https.get(url + '/api/health', () => {}).on('error', () => {});
}, 10 * 60 * 1000);

// ============================================================
// INIT DATABASE
// ============================================================
async function initDB() {
    await query(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        profile_photo TEXT,
        reset_token TEXT,
        reset_token_expiry TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS songs (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        genre TEXT DEFAULT 'Other',
        duration TEXT DEFAULT '3:00',
        lyrics TEXT DEFAULT '',
        file_path TEXT NOT NULL,
        cover_path TEXT,
        uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        play_count INTEGER DEFAULT 0,
        download_count INTEGER DEFAULT 0,
        like_count INTEGER DEFAULT 0,
        approved BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS likes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, song_id)
    )`);
    await query(`CREATE TABLE IF NOT EXISTS plays (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        ip TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS downloads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        ip TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS playlists (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        cover_url TEXT,
        is_public BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS playlist_songs (
        id SERIAL PRIMARY KEY,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        position INTEGER DEFAULT 0,
        added_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(playlist_id, song_id)
    )`);
    await query(`CREATE TABLE IF NOT EXISTS artists (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        bio TEXT DEFAULT '',
        photo_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        comment TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS follows (
        id SERIAL PRIMARY KEY,
        follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        artist_name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(follower_id, artist_name)
    )`);
    await query(`CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS site_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS verification_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        artist_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        social_links TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        submitted_at TIMESTAMP DEFAULT NOW(),
        reviewed_at TIMESTAMP,
        reviewed_by INTEGER REFERENCES users(id),
        admin_notes TEXT
    )`);

    // Add missing columns
    await query(`ALTER TABLE artists ADD COLUMN IF NOT EXISTS instagram TEXT DEFAULT ''`);
    await query(`ALTER TABLE artists ADD COLUMN IF NOT EXISTS twitter TEXT DEFAULT ''`);
    await query(`ALTER TABLE artists ADD COLUMN IF NOT EXISTS facebook TEXT DEFAULT ''`);
    await query(`ALTER TABLE songs ADD COLUMN IF NOT EXISTS release_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::int`);
    await query(`ALTER TABLE songs ADD COLUMN IF NOT EXISTS producer TEXT DEFAULT ''`);
    await query(`ALTER TABLE songs ADD COLUMN IF NOT EXISTS album TEXT DEFAULT ''`);
    await query(`ALTER TABLE songs ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`);
    await query(`ALTER TABLE songs ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE songs ADD COLUMN IF NOT EXISTS is_song_of_day BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE songs ADD COLUMN IF NOT EXISTS sponsored_until TIMESTAMPTZ`);
    await query(`ALTER TABLE songs ADD COLUMN IF NOT EXISTS sponsor_name TEXT DEFAULT ''`);
    await query(`ALTER TABLE songs ADD COLUMN IF NOT EXISTS cover_image TEXT`);
    await query(`ALTER TABLE songs ADD COLUMN IF NOT EXISTS video_url TEXT DEFAULT ''`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMPTZ`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token TEXT`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token_expiry TIMESTAMPTZ`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_since TIMESTAMPTZ`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_note TEXT`);
    // ✅ FIX #28: token version for JWT invalidation
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0`);

    // ✅ FIX #23: don't hardcode 2026
    await query(`UPDATE songs SET release_year = EXTRACT(YEAR FROM NOW())::int WHERE release_year IS NULL`);

    // Seed admin
    const adminSeedPassword = process.env.ADMIN_SEED_PASSWORD;
    if (!adminSeedPassword) {
        console.warn('⚠️  ADMIN_SEED_PASSWORD env var not set — admin seeding skipped.');
    } else {
        const existing = await query('SELECT id FROM users WHERE email=$1', ['musitafahkenny288227@gmail.com']);
        if (existing.rows.length === 0) {
            await query(
                'INSERT INTO users (username, email, password, is_admin) VALUES ($1,$2,$3,TRUE)',
                ['MUSTA', 'musitafahkenny288227@gmail.com', hashPassword(adminSeedPassword)]
            );
            console.log('✅ Admin created');
        } else {
            await query('UPDATE users SET is_admin=TRUE WHERE email=$1', ['musitafahkenny288227@gmail.com']);
            console.log('✅ Admin account verified');
        }
    }
    console.log('✅ Database ready');
}

['songs','covers'].forEach(d => {
    const dir = path.join(UPLOADS, d);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ============================================================
// CRYPTO
// ============================================================
function hashPassword(pw) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(pw, salt, 10000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(pw, stored) {
    try {
        const [salt, hash] = stored.split(':');
        const attempt = crypto.pbkdf2Sync(pw, salt, 10000, 64, 'sha512').toString('hex');
        // ✅ timing-safe compare
        const a = Buffer.from(attempt, 'hex');
        const b = Buffer.from(hash, 'hex');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { return false; }
}

// ============================================================
// JWT  (✅ FIX #28: include token_version)
// ============================================================
function b64url(str) {
    return Buffer.from(str).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function b64decode(str) {
    return Buffer.from(str.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8');
}
function signJWT(payload) {
    const header = b64url(JSON.stringify({ alg:'HS256', typ:'JWT' }));
    const body   = b64url(JSON.stringify({
        ...payload,
        iat: Math.floor(Date.now()/1000),
        exp: Math.floor(Date.now()/1000) + 60*60*24*7
    }));
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    return `${header}.${body}.${sig}`;
}
function verifyJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
        // ✅ timing-safe compare
        const a = Buffer.from(expected);
        const b = Buffer.from(parts[2]);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
        const payload = JSON.parse(b64decode(parts[1]));
        if (payload.exp < Math.floor(Date.now()/1000)) return null;
        return payload;
    } catch { return null; }
}
function getUser(req) {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    return token ? verifyJWT(token) : null;
}

// ============================================================
// CORS
// ============================================================
const normalizeOrigin = origin => (origin || '').replace(/\/$/, '');

const LOCALHOST_ORIGINS = [
    'http://localhost:5000','http://localhost:3000','http://localhost:8000',
    'http://127.0.0.1:5000','http://127.0.0.1:3000','http://127.0.0.1:8000',
    'https://localhost:5000','https://localhost:3000','https://localhost:8000',
    'https://127.0.0.1:5000','https://127.0.0.1:3000','https://127.0.0.1:8000'
].map(normalizeOrigin).filter(Boolean);

const ALLOWED_ORIGINS = [
    'https://djmusta.com',
    'https://www.djmusta.com',
    'https://djmusta.pages.dev',
    'https://main.djmusta.pages.dev',
    'https://weathered-cherry-0a9e.musitafahkenny288227.workers.dev',
    FRONTEND_URL,
    ...LOCALHOST_ORIGINS
].map(normalizeOrigin).filter(Boolean);

function isAllowedOrigin(origin) {
    origin = normalizeOrigin(origin);
    if (!origin) return false;
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)) return true;
    if (origin.match(/^https:\/\/[a-z0-9]+\.djmusta\.pages\.dev$/)) return true;
    return false;
}

function corsHeaders(origin) {
    const normalizedOrigin = normalizeOrigin(origin);
    const allowed = isAllowedOrigin(normalizedOrigin);
    return {
        ...(allowed ? { 'Access-Control-Allow-Origin': normalizedOrigin } : {}),
        'Access-Control-Allow-Headers':     'Content-Type, Authorization',
        'Access-Control-Allow-Methods':     'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': 'false',
        'Vary': 'Origin'
    };
}

// ============================================================
// HTTP HELPERS
// ============================================================
// ✅ FIX #5: accept acceptEncoding explicitly instead of res._reqAcceptEncoding
function jsonRes(res, status, data, origin, cacheSeconds = 0, lastModified = null, acceptEncoding = '') {
    const body = JSON.stringify(data);
    const cacheHeader = cacheSeconds > 0
        ? `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`
        : 'no-store';
    const lastModifiedHeader = lastModified
        ? (lastModified instanceof Date ? lastModified : new Date(lastModified)).toUTCString()
        : new Date().toUTCString();

    if (acceptEncoding.includes('gzip')) {
        zlib.gzip(Buffer.from(body, 'utf8'), (err, compressed) => {
            if (err) {
                res.writeHead(status, {
                    'Content-Type': 'application/json',
                    ...corsHeaders(origin),
                    'Content-Length': Buffer.byteLength(body),
                    'Cache-Control': cacheHeader,
                    'Last-Modified': lastModifiedHeader,
                });
                res.end(body);
                return;
            }
            res.writeHead(status, {
                'Content-Type': 'application/json',
                'Content-Encoding': 'gzip',
                ...corsHeaders(origin),
                'Content-Length': compressed.length,
                'Cache-Control': cacheHeader,
                'Last-Modified': lastModifiedHeader,
                'Vary': 'Accept-Encoding, Origin',
            });
            res.end(compressed);
        });
    } else {
        res.writeHead(status, {
            'Content-Type': 'application/json',
            ...corsHeaders(origin),
            'Content-Length': Buffer.byteLength(body),
            'Cache-Control': cacheHeader,
            'Last-Modified': lastModifiedHeader,
        });
        res.end(body);
    }
}

// ✅ FIX #3 + #12: enforce max body size, clear timeout on end
const MAX_BODY_BYTES = 60 * 1024 * 1024; // 60MB

function readBody(req, maxBytes = MAX_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let finished = false;
        const timer = setTimeout(() => {
            if (!finished) { req.destroy(); reject(new Error('Request body timeout')); }
        }, 120000);

        req.on('data', c => {
            total += c.length;
            if (total > maxBytes) {
                clearTimeout(timer);
                finished = true;
                req.destroy();
                reject(new Error('Request body too large'));
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => {
            finished = true;
            clearTimeout(timer);
            resolve(Buffer.concat(chunks));
        });
        req.on('error', (e) => { clearTimeout(timer); if (!finished) { finished = true; reject(e); } });
    });
}

function parseJSON(req) {
    return readBody(req, 1024 * 1024).then(buf => {
        try { return JSON.parse(buf.toString()); } catch { return {}; }
    });
}

// ============================================================
// MULTIPART PARSER  (✅ FIX #3: body-size cap; #13: slice guard)
// ============================================================
function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const ct = req.headers['content-type'] || '';
        const bm = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
        if (!bm) return reject(new Error('No boundary'));
        const boundary = '--' + (bm[1] || bm[2]);

        readBody(req, MAX_BODY_BYTES).then(buf => {
            const fields = {};
            const files  = {};
            const bound  = Buffer.from(boundary);
            let pos = 0;

            while (pos < buf.length) {
                const bStart = indexOf(buf, bound, pos);
                if (bStart === -1) break;
                pos = bStart + bound.length;
                if (pos + 2 <= buf.length && buf[pos] === 45 && buf[pos+1] === 45) break;
                if (pos + 2 <= buf.length && buf[pos] === 13 && buf[pos+1] === 10) pos += 2;
                else if (pos + 1 <= buf.length && buf[pos] === 10) pos += 1;
                const headerEnd = indexOf(buf, Buffer.from('\r\n\r\n'), pos);
                if (headerEnd === -1) break;
                const headStr = buf.slice(pos, headerEnd).toString('utf8');
                pos = headerEnd + 4;
                const nextBound = indexOf(buf, bound, pos);
                // ✅ FIX #13: guard against negative slice
                const dataEnd = nextBound === -1 ? buf.length : Math.max(pos, nextBound - 2);
                const partData = buf.slice(pos, dataEnd);
                pos = nextBound === -1 ? buf.length : nextBound;
                const nameMatch = headStr.match(/Content-Disposition:[^\r\n]*;\s*name="([^"]+)"/i);
                const fileMatch = headStr.match(/filename="([^"]*)"/i);
                const mimeMatch = headStr.match(/Content-Type:\s*([^\r\n]+)/i);
                if (!nameMatch) continue;
                const fieldName = nameMatch[1];
                if (fileMatch && fileMatch[1]) {
                    files[fieldName] = {
                        filename: fileMatch[1],
                        mimetype: mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream',
                        data: partData
                    };
                } else if (mimeMatch) {
                    files[fieldName] = {
                        filename: fieldName + '.bin',
                        mimetype: mimeMatch[1].trim(),
                        data: partData
                    };
                } else {
                    fields[fieldName] = partData.toString('utf8');
                }
            }
            resolve({ fields, files });
        }).catch(reject);
    });
}

function indexOf(buf, search, start = 0) {
    const sl = search.length;
    for (let i = start; i <= buf.length - sl; i++) {
        let found = true;
        for (let j = 0; j < sl; j++) { if (buf[i+j] !== search[j]) { found=false; break; } }
        if (found) return i;
    }
    return -1;
}

// ============================================================
// R2 UPLOAD
// ============================================================
function r2Upload(fileObj, folder) {
    return new Promise((resolve, reject) => {
        if (!fileObj) return resolve(null);
        const safe = fileObj.filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const key  = `${folder}/${Date.now()}-${safe}`;
        const body = fileObj.data;
        const mime = fileObj.mimetype || 'application/octet-stream';
        const now  = new Date();
        const dateStamp = now.toISOString().slice(0,10).replace(/-/g,'');
        const timeStamp = now.toISOString().replace(/[-:]/g,'').slice(0,15) + 'Z';
        const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
        const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
        const canonicalHeaders = `content-type:${mime}\nhost:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${timeStamp}\n`;
        const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
        const canonicalRequest = ['PUT', `/${R2_BUCKET}/${key}`, '', canonicalHeaders, signedHeaders, bodyHash].join('\n');
        const credScope = `${dateStamp}/auto/s3/aws4_request`;
        const strToSign = `AWS4-HMAC-SHA256\n${timeStamp}\n${credScope}\n` + crypto.createHash('sha256').update(canonicalRequest).digest('hex');
        const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
        const sigKey = hmac(hmac(hmac(hmac(`AWS4${R2_SECRET_KEY}`, dateStamp), 'auto'), 's3'), 'aws4_request');
        const signature = crypto.createHmac('sha256', sigKey).update(strToSign).digest('hex');
        const authorization = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
        const req = https.request({
            hostname: host, path: `/${R2_BUCKET}/${key}`, method: 'PUT',
            headers: {
                'Content-Type': mime,
                'Content-Length': body.length,
                'x-amz-date': timeStamp,
                'x-amz-content-sha256': bodyHash,
                'Authorization': authorization
            }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) resolve(`${R2_PUBLIC_URL}/${key}`);
                else reject(new Error(`R2 failed: ${res.statusCode} ${data}`));
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function saveLocal(fileObj, folder) {
    if (!fileObj) return null;
    const dir = path.join(UPLOADS, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const safe = fileObj.filename.replace(/[^a-zA-Z0-9.\-_]/g,'_');
    const name = `${Date.now()}-${safe}`;
    fs.writeFileSync(path.join(dir, name), fileObj.data);
    return `/uploads/${folder}/${name}`;
}

// ============================================================
// STATIC FILE SERVER  (✅ FIX #25: 404 for missing files with ext)
// ============================================================
const MIME = {
    '.html':'text/html','.css':'text/css','.js':'application/javascript',
    '.json':'application/json','.mp3':'audio/mpeg','.wav':'audio/wav',
    '.m4a':'audio/mp4','.jpg':'image/jpeg','.jpeg':'image/jpeg',
    '.png':'image/png','.webp':'image/webp','.gif':'image/gif',
    '.ico':'image/x-icon','.svg':'image/svg+xml','.txt':'text/plain'
};

function serveStatic(req, res, filePath, origin) {
    // Prevent path traversal
    const resolved = path.resolve(filePath);
    const root = path.resolve(__dirname, '..');
    if (!resolved.startsWith(root)) {
        res.writeHead(403); return res.end('Forbidden');
    }

    fs.stat(resolved, (err, stat) => {
        if (err || !stat.isFile()) {
            // ✅ FIX #25: don't return index.html for missing asset paths
            const ext = path.extname(resolved).toLowerCase();
            if (ext && MIME[ext]) {
                res.writeHead(404, { 'Content-Type': 'text/plain', ...corsHeaders(origin) });
                return res.end('Not found');
            }
            const index = path.join(__dirname, '..', 'index.html');
            fs.readFile(index, (e2, data) => {
                if (e2) { res.writeHead(404); res.end('Not found'); return; }
                res.writeHead(200, { 'Content-Type':'text/html', ...corsHeaders(origin) });
                res.end(data);
            });
            return;
        }
        const ext  = path.extname(resolved).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        const isAudio = mime.startsWith('audio/');
        if (isAudio && req.headers.range) {
            const total = stat.size;
            const [s, e] = req.headers.range.replace(/bytes=/,'').split('-');
            const start = parseInt(s, 10);
            const end   = e ? parseInt(e,10) : Math.min(start + 1024*1024 - 1, total - 1);
            res.writeHead(206, {
                'Content-Range':`bytes ${start}-${end}/${total}`,
                'Accept-Ranges':'bytes',
                'Content-Length':end-start+1,
                'Content-Type':mime
            });
            fs.createReadStream(resolved, { start, end }).pipe(res);
            return;
        }
        res.writeHead(200, {
            'Content-Type':mime,
            'Content-Length':stat.size,
            'Accept-Ranges':'bytes',
            'Cache-Control': isAudio ? 'public,max-age=3600' : 'no-cache',
            ...corsHeaders(origin)
        });
        fs.createReadStream(resolved).pipe(res);
    });
}

// ============================================================
// SERVER
// ============================================================
const server = http.createServer(async (req, res) => {
    const origin   = req.headers.origin || '';
    const parsed   = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = parsed.pathname;
    const method   = req.method;

    // ✅ FIX #6/#10: x-forwarded-for can be comma-separated
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip  = xff || req.socket.remoteAddress || 'unknown';

    const acceptEncoding = req.headers['accept-encoding'] || '';

    // ✅ FIX #5: pass accept-encoding explicitly
    const jsonResBound = (status, data, cacheSeconds = 0, lastMod = null) =>
        jsonRes(res, status, data, origin, cacheSeconds, lastMod, acceptEncoding);

    if (method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(origin));
        return res.end();
    }

    if (rateLimit(ip)) {
        return jsonResBound(429, { error: 'Too many requests. Please slow down.' });
    }

    if (pathname.startsWith('/api/')) {
        try {
            await handleAPI(req, res, pathname, method, parsed, ip, origin, acceptEncoding);
        } catch(e) {
            console.error('[API Error]', e);
            if (!res.headersSent) jsonResBound(500, { error: 'Internal server error' });
        }
        return;
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    if (pathname === '/health') {
        return jsonResBound(200, { status:'ok', uptime: process.uptime() });
    }

    if (pathname.startsWith('/uploads/')) {
        return serveStatic(req, res, path.join(__dirname, pathname), origin);
    }

    if (pathname === '/sitemap.xml') {
        try {
            const songs = await query('SELECT id, title, artist, genre, cover_image, cover_path, created_at, release_year, lyrics, producer FROM songs WHERE approved=TRUE ORDER BY created_at DESC');
            const toSlug = str => str.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').substring(0,60);

            const staticPages = [
                { loc: 'https://djmusta.com',                  changefreq: 'daily',   priority: '1.0' },
                { loc: 'https://djmusta.com/new-music',        changefreq: 'daily',   priority: '0.95' },
                { loc: 'https://djmusta.com/top-songs',        changefreq: 'weekly',  priority: '0.92' },
                { loc: 'https://djmusta.com/top-artists',      changefreq: 'weekly',  priority: '0.90' },
                { loc: 'https://djmusta.com/nonstops',         changefreq: 'weekly',  priority: '0.88' },
                { loc: 'https://djmusta.com/gospel',           changefreq: 'weekly',  priority: '0.88' },
                { loc: 'https://djmusta.com/artist-upload',    changefreq: 'monthly', priority: '0.80' },
                { loc: 'https://djmusta.com/about',            changefreq: 'monthly', priority: '0.60' },
                { loc: 'https://djmusta.com/contact',          changefreq: 'monthly', priority: '0.60' },
                { loc: 'https://djmusta.com/copyright',        changefreq: 'yearly',  priority: '0.40' },
                { loc: 'https://djmusta.com/privacy-policy',   changefreq: 'yearly',  priority: '0.30' },
                { loc: 'https://djmusta.com/terms',            changefreq: 'yearly',  priority: '0.30' },
            ];
            const today = new Date().toISOString().split('T')[0];

            const staticUrls = staticPages.map(p => `  <url>
    <loc>${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n');

            const seenSongUrls = new Set();
            const songUrls = songs.rows.map(s => {
                const titleSlug  = toSlug(s.title) || `song-${s.id}`;
                const artistSlug = toSlug(s.artist) || 'unknown';
                let songUrl = `https://djmusta.com/song/${titleSlug}/${artistSlug}`;
                if (seenSongUrls.has(songUrl)) songUrl = `https://djmusta.com/song/${titleSlug}-${s.id}/${artistSlug}`;
                seenSongUrls.add(songUrl);
                return { s, songUrl };
            }).map(({ s, songUrl }) => {
                const lastmod    = s.created_at ? new Date(s.created_at).toISOString().split('T')[0] : today;
                const esc        = str => (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
                const coverUrl   = s.cover_image || s.cover_path || '';
                const priority   = (s.release_year >= new Date().getFullYear() || s.lyrics) ? '0.9' : '0.8';
                const imageTag   = coverUrl ? `
    <image:image>
      <image:loc>${esc(coverUrl.startsWith('http') ? coverUrl : 'https://djmusta.com' + coverUrl)}</image:loc>
      <image:title>${esc(s.title)} by ${esc(s.artist)}</image:title>
      <image:caption>${esc(s.genre || 'Ugandan Music')} — ${esc(s.title)} by ${esc(s.artist)}</image:caption>
    </image:image>` : '';
                return `  <url>
    <loc>${songUrl}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>${imageTag}
  </url>`;
            }).join('\n');

            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${staticUrls}
${songUrls}
</urlset>`;
            res.writeHead(200, { 'Content-Type':'application/xml', 'Cache-Control':'public,max-age=3600', ...corsHeaders(origin) });
            return res.end(xml);
        } catch(e) {
            res.writeHead(500); return res.end('Sitemap error');
        }
    }

    serveStatic(req, res, path.join(__dirname, '..', pathname === '/' ? 'index.html' : pathname), origin);
});

// ============================================================
// API HANDLER
// ============================================================
async function handleAPI(req, res, pathname, method, parsed, ip, origin, acceptEncoding = '') {
    const seg  = pathname.replace('/api/','').split('/');
    const user = getUser(req);
    const q    = parsed.searchParams;  // ✅ FIX #2: define q once for the whole handler
    const J    = (status, data) => jsonRes(res, status, data, origin, 0, null, acceptEncoding);
    const JC   = (status, data, secs, lastMod) => jsonRes(res, status, data, origin, secs, lastMod, acceptEncoding);

    // ── HEALTH ─────────────────────────────────────────────
    if (pathname === '/api/health') return JC(200, { status:'ok', uptime: process.uptime() }, 10);

    // ── AUTH ───────────────────────────────────────────────
    if (method === 'POST' && pathname === '/api/auth/register') {
        return J(403, { error:'Registration is only allowed via Google.' });
    }
    if (method === 'POST' && pathname === '/api/auth/login') {
        return J(403, { error:'Login is only allowed via Google.' });
    }

    if (method === 'GET' && pathname === '/api/auth/me') {
        if (!user) return J(401, { error:'Unauthorized' });
        const r = await query('SELECT * FROM users WHERE id=$1', [user.id]);
        if (!r.rows[0]) return J(404, { error:'User not found' });
        // ✅ FIX #28: reject stale tokens
        if (r.rows[0].token_version !== undefined && user.tv !== undefined &&
            r.rows[0].token_version !== user.tv) return J(401, { error:'Session expired' });
        return J(200, pub(r.rows[0]));
    }

    if (method === 'POST' && pathname === '/api/auth/change-password') {
        if (!user) return J(401, { error:'Unauthorized' });
        if (authRateLimit(ip)) return J(429, { error:'Too many attempts.' });
        const { currentPassword, newPassword } = await parseJSON(req);
        if (!currentPassword || !newPassword) return J(400, { error:'Both fields required' });
        if (newPassword.length < 6) return J(400, { error:'New password must be at least 6 characters' });
        const r = await query('SELECT * FROM users WHERE id=$1', [user.id]);
        if (!r.rows[0]) return J(404, { error:'User not found' });
        if (!verifyPassword(currentPassword, r.rows[0].password))
            return J(401, { error:'Current password is incorrect' });
        // ✅ FIX #28: bump token_version, invalidating all sessions
        await query('UPDATE users SET password=$1, token_version=COALESCE(token_version,0)+1 WHERE id=$2',
            [hashPassword(newPassword), user.id]);
        return J(200, { success:true, message:'Password changed successfully' });
    }

    // ✅ FIX #11: cache Google certs + correct signature verification
    let googleKeysCache = { keys: null, expiresAt: 0 };
    async function getGoogleKeys() {
        if (googleKeysCache.keys && Date.now() < googleKeysCache.expiresAt) return googleKeysCache.keys;
        const keys = await new Promise((resolve, reject) => {
            https.get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', res => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
                });
            }).on('error', reject);
        });
        googleKeysCache = { keys, expiresAt: Date.now() + 60 * 60 * 1000 };
        return keys;
    }

    if (method === 'POST' && pathname === '/api/auth/google') {
        const body = await parseJSON(req);
        const idToken = body.idToken;
        const photoUrl = body.photoUrl || null;
        if (!idToken) return J(400, { error:'ID token required' });

        let email, username;
        try {
            const keysRes = await getGoogleKeys();
            const parts = idToken.split('.');
            if (parts.length !== 3) throw new Error('Invalid token format');
            const header  = JSON.parse(Buffer.from(parts[0], 'base64').toString());
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

            const now = Math.floor(Date.now() / 1000);
            if (payload.exp < now) throw new Error('Token expired');
            if (payload.aud !== 'dj-musta-music') throw new Error('Invalid audience');
            if (payload.iss !== 'https://securetoken.google.com/dj-musta-music') throw new Error('Invalid issuer');
            if (!payload.email_verified) throw new Error('Email not verified with Google');

            const certPem = keysRes[header.kid];
            if (!certPem) throw new Error('Unknown key ID');

            // ✅ FIX #11: base64url padding
            const padded = parts[2].replace(/-/g,'+').replace(/_/g,'/');
            const pad = padded.length % 4 ? '='.repeat(4 - (padded.length % 4)) : '';

            const verifier = crypto.createVerify('RSA-SHA256');
            verifier.update(parts[0] + '.' + parts[1]);
            if (!verifier.verify(certPem, padded + pad, 'base64')) throw new Error('Invalid token signature');

            email = payload.email;
            username = payload.name || payload.email.split('@')[0];
        } catch(e) {
            console.error('[Google Auth]', e.message);
            return J(401, { error: 'Invalid Google token: ' + e.message });
        }

        let existingUser = await query('SELECT * FROM users WHERE email=$1', [email]);
        if (existingUser.rows.length) {
            const u = existingUser.rows[0];
            if (photoUrl && !u.profile_photo) {
                await query('UPDATE users SET profile_photo=$1 WHERE id=$2', [photoUrl, u.id]);
                u.profile_photo = photoUrl;
            }
            await query('UPDATE users SET last_login=NOW() WHERE id=$1', [u.id]);
            const tkn = signJWT({ id:u.id, username:u.username, email:u.email, isAdmin:!!u.is_admin, tv: u.token_version || 0 });
            return J(200, { token:tkn, user:pub(u) });
        } else {
            const randomPass = crypto.randomBytes(16).toString('hex');
            const r = await query(
                'INSERT INTO users (username,email,password,is_verified,profile_photo) VALUES ($1,$2,$3,TRUE,$4) RETURNING *',
                [username, email, hashPassword(randomPass), photoUrl]
            );
            const u = r.rows[0];
            const tkn = signJWT({ id:u.id, username:u.username, email:u.email, isAdmin:false, tv: u.token_version || 0 });
            return J(201, { token:tkn, user:pub(u) });
        }
    }

    if (method === 'POST' && pathname === '/api/auth/forgot-password') {
        const body = await parseJSON(req);
        const email = body.email;
        if (!email) return J(400, { error:'Email required' });
        const userRow = await query('SELECT * FROM users WHERE email=$1', [email]);
        if (!userRow.rows.length) return J(200, { success:true, message:'If that email exists, a reset link was sent.' });

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpiry = new Date(Date.now() + 3600000);
        await query('UPDATE users SET reset_token=$1, reset_token_expiry=$2 WHERE email=$3', [resetToken, resetExpiry, email]);

        const resetLink = `${SITE_URL}?reset=${resetToken}`;
        sendEmail(email, '🔑 Reset Your DJ Musta Password', `
            <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0a0e27;color:#e2e8f0;padding:30px;border-radius:12px">
                <h2 style="color:#a855f7">🔑 Password Reset Request</h2>
                <p>We received a request to reset your password for DJ Musta Music.</p>
                <a href="${resetLink}" style="display:inline-block;margin:20px 0;padding:14px 28px;background:#a855f7;color:white;border-radius:8px;text-decoration:none;font-weight:700">Reset My Password</a>
                <p style="color:#94a3b8;font-size:13px">This link expires in 1 hour.</p>
            </div>`);
        return J(200, { success:true, message:'Password reset link sent to your email!' });
    }

    if (method === 'POST' && pathname === '/api/auth/reset-password') {
        const { token: resetToken, password: newPassword } = await parseJSON(req);
        if (!resetToken || !newPassword) return J(400, { error:'Token and new password required' });
        if (newPassword.length < 6) return J(400, { error:'Password must be at least 6 characters' });
        const r = await query('SELECT * FROM users WHERE reset_token=$1', [resetToken]);
        if (!r.rows[0]) return J(400, { error:'Invalid or expired reset link' });
        if (new Date(r.rows[0].reset_token_expiry) < new Date()) return J(400, { error:'Reset link has expired.' });
        // ✅ FIX #28: bump token_version
        await query('UPDATE users SET password=$1, reset_token=NULL, reset_token_expiry=NULL, token_version=COALESCE(token_version,0)+1 WHERE id=$2',
            [hashPassword(newPassword), r.rows[0].id]);
        return J(200, { success:true, message:'Password reset successfully!' });
    }

    // ── STATS ──────────────────────────────────────────────
    if (method === 'GET' && pathname === '/api/stats') {
        const songs     = await query('SELECT COUNT(*) FROM songs WHERE approved=TRUE');
        const artists   = await query('SELECT COUNT(DISTINCT artist) FROM songs WHERE approved=TRUE');
        const plays     = await query('SELECT COALESCE(SUM(play_count),0) FROM songs WHERE approved=TRUE');
        const downloads = await query('SELECT COALESCE(SUM(download_count),0) FROM songs WHERE approved=TRUE');
        const likes     = await query('SELECT COALESCE(SUM(like_count),0) FROM songs WHERE approved=TRUE');
        const users     = await query('SELECT COUNT(*) FROM users');
        const pending   = await query('SELECT COUNT(*) FROM songs WHERE approved=FALSE');
        return JC(200, {
            songs:     parseInt(songs.rows[0].count),
            artists:   parseInt(artists.rows[0].count),
            plays:     parseInt(plays.rows[0].coalesce),
            downloads: parseInt(downloads.rows[0].coalesce),
            likes:     parseInt(likes.rows[0].coalesce),
            users:     parseInt(users.rows[0].count),
            pending:   parseInt(pending.rows[0].count)
        }, 300);
    }

    // ── SONG OF THE DAY ────────────────────────────────────
    if (method === 'GET' && pathname === '/api/songs/song-of-day') {
        try {
            let r = await query(
                `SELECT s.*, COALESCE(vr.status,'none') as uploader_verified
                 FROM songs s
                 LEFT JOIN verification_requests vr ON vr.user_id=s.uploaded_by AND vr.status='approved'
                 WHERE s.approved=TRUE AND s.is_song_of_day=TRUE LIMIT 1`);
            if (!r.rows[0]) {
                r = await query(
                    `SELECT s.*, COALESCE(vr.status,'none') as uploader_verified
                     FROM songs s
                     LEFT JOIN verification_requests vr ON vr.user_id=s.uploaded_by AND vr.status='approved'
                     WHERE s.approved=TRUE ORDER BY s.play_count DESC LIMIT 1`);
            }
            if (!r.rows[0]) return J(200, { song: null });
            return JC(200, { song: r.rows[0] }, 60);
        } catch(e) {
            return J(500, { error:'Could not load song of the day' });
        }
    }

    // ── GET SONGS (✅ FIX #7: parameterized relevance sort) ──
    if (method === 'GET' && pathname === '/api/songs') {
        const category = q.get('category') || 'all';
        const search   = q.get('search') || '';
        const genre    = q.get('genre') || '';
        const uploader = q.get('uploader') || '';
        const sortParam = q.get('sort') || '';
        const limit    = Math.min(parseInt(q.get('limit') || 20), 500);
        const offset   = parseInt(q.get('offset') || 0);

        let where  = 'approved=TRUE';
        let params = [];
        let idx    = 1;

        if (search) {
            where += ` AND (LOWER(title) LIKE $${idx} OR LOWER(artist) LIKE $${idx+1} OR LOWER(title) LIKE $${idx+2} OR LOWER(artist) LIKE $${idx+3})`;
            params.push(
                `%${search.toLowerCase()}%`,
                `%${search.toLowerCase()}%`,
                `${search.toLowerCase()}%`,
                `${search.toLowerCase()}%`
            );
            idx += 4;
        }
        if (genre) {
            where += ` AND LOWER(genre) = $${idx}`;
            params.push(genre.toLowerCase());
            idx++;
        }
        if (uploader) {
            where += ` AND uploaded_by = $${idx}`;
            params.push(parseInt(uploader));
            idx++;
        }
        const releaseYearFilter = q.get('release_year') || '';
        if (releaseYearFilter && !isNaN(parseInt(releaseYearFilter))) {
            where += ` AND release_year >= $${idx}`;
            params.push(parseInt(releaseYearFilter));
            idx++;
        }

        const orderMap = {
            new: 'created_at DESC', newest: 'created_at DESC',
            trending: 'play_count DESC', top: 'like_count DESC',
            plays: 'play_count DESC', downloads: 'download_count DESC', likes: 'like_count DESC'
        };

        let order;
        let dataParams = [...params];
        if (search) {
            // ✅ FIX #7: parameterized relevance ordering — no string concat
            const sLower = search.toLowerCase();
            dataParams.push(sLower, sLower, sLower, sLower);
            const p = dataParams.length;
            order = `CASE
                WHEN LOWER(s.title) = $${p-3} THEN 1
                WHEN LOWER(s.title) LIKE $${p-2} || '%' THEN 2
                WHEN LOWER(s.artist) = $${p-1} THEN 3
                WHEN LOWER(s.artist) LIKE $${p} || '%' THEN 4
                WHEN LOWER(s.title) LIKE '%' || $${p-3} || '%' THEN 5
                ELSE 6 END, s.play_count DESC`;
        } else {
            order = orderMap[sortParam] || orderMap[category] || 'created_at DESC';
        }

        const total = await query(`SELECT COUNT(*) FROM songs WHERE ${where}`, params);

        dataParams.push(limit, offset);
        const songs = await query(
            `SELECT s.*, COALESCE(vr.status,'none') as uploader_verified
             FROM songs s
             LEFT JOIN verification_requests vr ON vr.user_id=s.uploaded_by AND vr.status='approved'
             WHERE ${where}
             ORDER BY ${order}
             LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
            dataParams
        );

        const likedIds = user
            ? (await query('SELECT song_id FROM likes WHERE user_id=$1', [user.id])).rows.map(r => r.song_id)
            : [];

        const songListCache = user ? 0 : 60;
        const newestSong = songs.rows[0];
        const lastMod = newestSong?.created_at ? new Date(newestSong.created_at) : new Date();
        return JC(200, {
            songs: songs.rows.map(s => ({ ...s, liked: likedIds.includes(s.id) })),
            total: parseInt(total.rows[0].count),
            offset, limit
        }, songListCache, lastMod);
    }

    // ── ADMIN QUICK-ADD (✅ FIX #26: validate URL) ──────────
    if (method === 'POST' && pathname === '/api/songs/admin/add') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const { title, artist, genre, duration, file_path, cover_path, lyrics, description, release_year, releaseYear, album } = await parseJSON(req);
        if (!title || !artist) return J(400, { error:'title and artist are required' });
        if (!file_path) return J(400, { error:'file_path (audio URL) is required' });
        if (!/^https?:\/\//i.test(file_path)) return J(400, { error:'file_path must be an http(s) URL' });
        if (cover_path && !/^https?:\/\//i.test(cover_path)) return J(400, { error:'cover_path must be an http(s) URL' });
        const yr = release_year || releaseYear || new Date().getFullYear();
        const albumName = (album || '').trim();
        const r = await query(
            `INSERT INTO songs (title, artist, genre, duration, file_path, cover_path, lyrics, description, album, release_year, approved, uploaded_by, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,NOW()) RETURNING *`,
            [title.trim(), artist.trim(), genre||'Other', duration||'0:00',
             file_path.trim(), cover_path||null, lyrics||'', description||'', albumName || null, yr, user.id]
        );
        pingSearchEngines().catch(() => {});
        return J(201, { success:true, song: r.rows[0] });
    }

    // ── ADMIN PENDING ──────────────────────────────────────
    if (method === 'GET' && pathname === '/api/songs/admin/pending') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const r = await query(`SELECT s.*, u.username AS uploader_name FROM songs s LEFT JOIN users u ON s.uploaded_by=u.id WHERE s.approved=FALSE ORDER BY s.created_at DESC`);
        return J(200, { songs: r.rows });
    }

    // ── ADMIN USERS ────────────────────────────────────────
    if (method === 'GET' && pathname === '/api/songs/admin/users') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const r = await query('SELECT id,username,email,is_admin,is_premium,is_verified,profile_photo,last_login,created_at FROM users ORDER BY COALESCE(last_login,created_at) DESC');
        return J(200, { users: r.rows.map(pub) });
    }

    if (method === 'GET' && pathname === '/api/songs/likes/mine') {
        if (!user) return J(401, { error:'Unauthorized' });
        const r = await query(`SELECT s.* FROM songs s INNER JOIN likes l ON l.song_id=s.id WHERE l.user_id=$1 AND s.approved=TRUE ORDER BY l.created_at DESC`, [user.id]);
        return J(200, { songs: r.rows.map(s => ({ ...s, liked: true })) });
    }

    // ── SINGLE SONG ────────────────────────────────────────
    if (method === 'GET' && seg[0]==='songs' && seg[1] && !isNaN(seg[1]) && !seg[2]) {
        const r = await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Song not found' });
        return JC(200, r.rows[0], 300, r.rows[0].created_at ? new Date(r.rows[0].created_at) : null);
    }

    // ── TRACK PLAY (✅ FIX #29: dedupe per IP within 30s) ──
    if (method === 'POST' && seg[0]==='songs' && seg[1] && seg[2]==='play' && !seg[3]) {
        const r = await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Song not found' });
        const song = r.rows[0];
        const recent = await query(
            `SELECT 1 FROM plays WHERE song_id=$1 AND ip=$2 AND created_at > NOW() - INTERVAL '30 seconds' LIMIT 1`,
            [song.id, ip]
        );
        if (recent.rows.length) {
            return J(200, { success: true, play_count: song.play_count, deduped: true });
        }
        await query('UPDATE songs SET play_count=play_count+1 WHERE id=$1', [song.id]);
        await query('INSERT INTO plays (user_id,song_id,ip) VALUES ($1,$2,$3)', [user?.id||null, song.id, ip]);
        return J(200, { success: true, play_count: song.play_count + 1 });
    }

    // ── UPLOAD SONG (admin) ────────────────────────────────
    if (method === 'POST' && pathname === '/api/songs') {
        if (!user) return J(401, { error:'Login required' });
        const ct = req.headers['content-type'] || '';
        if (!ct.includes('multipart/form-data')) return J(400, { error:'Multipart required' });
        const { fields, files } = await parseMultipart(req);
        const { title, artist, genre, duration, lyrics } = fields;
        const album = (fields.album || '').trim();
        const description = (fields.description || '').trim();
        const producer    = (fields.producer || '').trim();
        const releaseYear = fields.release_year ? parseInt(fields.release_year) : new Date().getFullYear();
        if (!title?.trim())  return J(400, { error:'Title required' });
        if (!artist?.trim()) return J(400, { error:'Artist required' });
        if (!files.song)     return J(400, { error:'Audio file required' });

        const audioErr = validateFile(files.song, 'audio');
        if (audioErr) return J(400, { error: audioErr });
        if (files.cover) {
            const imgErr = validateFile(files.cover, 'image');
            if (imgErr) return J(400, { error: imgErr });
        }

        let filePath, coverPath;
        const DEFAULT_COVER_URL = `${R2_PUBLIC_URL}/covers/default-cover.svg`;
        try {
            filePath  = await r2Upload(files.song,  'songs');
            coverPath = files.cover ? await r2Upload(files.cover, 'covers') : DEFAULT_COVER_URL;
        } catch(e) {
            console.error('[R2 upload failed]', e.message);
            return J(500, { error: 'File upload failed: ' + e.message });
        }

        const r = await query(
            'INSERT INTO songs (title,artist,genre,duration,lyrics,description,file_path,cover_path,uploaded_by,approved,producer,release_year,album) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
            [title.trim(), artist.trim(), genre||'Other', duration||'3:00', lyrics||'', description, filePath, coverPath, user.id, !!user.isAdmin, producer||null, releaseYear, album || null]
        );
        const newSong = r.rows[0];
        if (user.isAdmin) {
            pingSearchEngines().catch(() => {});
            pingGoogleIndexNow(newSong).catch(() => {});
        }
        return J(201, newSong);
    }

    // ── BULK UPLOAD ────────────────────────────────────────
    if (method === 'POST' && pathname === '/api/songs/bulk') {
        if (!user) return J(401, { error:'Login required' });
        const ct = req.headers['content-type'] || '';
        if (!ct.includes('multipart/form-data')) return J(400, { error:'Multipart required' });

        const { fields, files } = await parseMultipart(req);
        const results = [];
        const errors = [];

        const titles = fields.titles?.split(',').map(t => t.trim()).filter(Boolean) || [];
        const artists = fields.artists?.split(',').map(a => a.trim()).filter(Boolean) || [];
        const genres = fields.genres?.split(',').map(g => g.trim()).filter(Boolean) || [];
        const durations = fields.durations?.split(',').map(d => d.trim()).filter(Boolean) || [];

        const songFiles = Object.keys(files)
            .filter(key => key.startsWith('song'))
            .sort((a, b) => parseInt(a.replace('song', '')) - parseInt(b.replace('song', '')))
            .map(key => files[key]);

        const coverFiles = Object.keys(files)
            .filter(key => key.startsWith('cover'))
            .sort((a, b) => parseInt(a.replace('cover', '')) - parseInt(b.replace('cover', '')))
            .map(key => files[key]);

        if (songFiles.length === 0) return J(400, { error: 'No song files provided' });

        for (let i = 0; i < songFiles.length; i++) {
            try {
                const songFile = songFiles[i];
                const coverFile = coverFiles[i] || null;
                const title = titles[i] || `Song ${i + 1}`;
                const artist = artists[i] || 'Unknown Artist';
                const genre = genres[i] || 'Other';
                const duration = durations[i] || '3:00';

                const audioErr = validateFile(songFile, 'audio');
                if (audioErr) { errors.push({ index: i, filename: songFile.filename, error: audioErr }); continue; }
                if (coverFile) {
                    const imgErr = validateFile(coverFile, 'image');
                    if (imgErr) { errors.push({ index: i, filename: coverFile.filename, error: imgErr }); continue; }
                }

                let filePath, coverPath;
                const DEFAULT_COVER_URL = `${R2_PUBLIC_URL}/covers/default-cover.svg`;
                try {
                    filePath = await r2Upload(songFile, 'songs');
                    coverPath = coverFile ? await r2Upload(coverFile, 'covers') : DEFAULT_COVER_URL;
                } catch(e) {
                    errors.push({ index: i, filename: songFile.filename, error: 'R2 upload failed: ' + e.message });
                    continue;
                }

                const r = await query(
                    'INSERT INTO songs (title,artist,genre,duration,lyrics,file_path,cover_path,uploaded_by,approved) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
                    [title, artist, genre, duration, '', filePath, coverPath, user.id, !!user.isAdmin]
                );
                results.push({ index: i, success: true, song: r.rows[0] });
            } catch(error) {
                errors.push({ index: i, filename: songFiles[i]?.filename || 'Unknown', error: error.message });
            }
        }
        return J(200, { success: true, totalProcessed: songFiles.length, successful: results.length, failed: errors.length, results, errors });
    }

    // ── DELETE SONG ────────────────────────────────────────
    if (method === 'DELETE' && seg[0]==='songs' && seg[1] && !seg[2]) {
        if (!user) return J(401, { error:'Unauthorized' });
        const r = await query('SELECT * FROM songs WHERE id=$1', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Song not found' });
        const song = r.rows[0];
        if (!user.isAdmin && song.uploaded_by !== user.id) return J(403, { error:'Forbidden' });
        await query('DELETE FROM songs WHERE id=$1', [seg[1]]);
        return J(200, { success:true });
    }

    // ── BULK DELETE ────────────────────────────────────────
    if (method === 'POST' && seg[0]==='songs' && seg[1]==='bulk-delete') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const body = await parseJSON(req);
        const ids  = body.ids;
        if (!Array.isArray(ids) || !ids.length) return J(400, { error:'ids array required' });
        if (ids.length > 100) return J(400, { error:'Max 100 songs per bulk delete' });
        const safeIds = ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
        if (!safeIds.length) return J(400, { error:'No valid song IDs provided' });
        const result = await query('DELETE FROM songs WHERE id = ANY($1::int[]) RETURNING id', [safeIds]);
        console.log(`[Bulk Delete] Admin ${user.id} deleted ${result.rows.length} songs`);
        return J(200, { success: true, deleted: result.rows.length });
    }

    // ── APPROVE SONG ───────────────────────────────────────
    if (method === 'PATCH' && seg[0]==='songs' && seg[2]==='approve') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        await query('UPDATE songs SET approved=TRUE WHERE id=$1', [seg[1]]);

        try {
            const songData = await query('SELECT s.*, u.email as uploader_email, u.username as uploader_name FROM songs s LEFT JOIN users u ON s.uploaded_by=u.id WHERE s.id=$1', [seg[1]]);
            if (songData.rows[0]) {
                const s = songData.rows[0];
                updateSitemap(s, query).catch(err => console.log('[Sitemap] update error:', err.message));
                pingSearchEngines().catch(() => {});
                pingGoogleIndexNow(s).catch(() => {});
                sendPushToSubscribers({
                    title: `🎵 New Song: ${s.title}`,
                    body: `${s.artist} is now live on DJ Musta. Tap to listen!`,
                    songId: s.id,
                    url: `/?song=${s.id}`
                }).catch(() => {});
                emailNewSongToAllUsers(s).catch(() => {});
                sendTelegramNewSong(s).catch(() => {});

                if (s.uploader_email) {
                    sendEmail(s.uploader_email, '✅ Your Song Was Approved - DJ Musta', `
                        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0a0e27;color:#e2e8f0;padding:30px;border-radius:12px">
                            <h2 style="color:#22c55e">✅ Song Approved!</h2>
                            <p>Hi <strong>${s.uploader_name}</strong>, your song has been approved and is now live!</p>
                            <p style="background:#1a1f3a;padding:16px;border-radius:8px;border-left:4px solid #a855f7">
                                🎵 <strong>${s.title}</strong> by ${s.artist}
                            </p>
                            <a href="${SITE_URL}" style="display:inline-block;margin:20px 0;padding:14px 28px;background:#a855f7;color:white;border-radius:8px;text-decoration:none;font-weight:700">Listen on DJ Musta</a>
                        </div>`);
                }

                const followers = await query('SELECT u.id, u.email, u.username FROM follows f JOIN users u ON f.follower_id=u.id WHERE LOWER(f.artist_name)=LOWER($1)', [s.artist]);
                for (const follower of followers.rows) {
                    await query('INSERT INTO notifications (user_id,type,title,message) VALUES ($1,$2,$3,$4)',
                        [follower.id, 'new_song', `🎵 ${s.artist} uploaded a new song!`, `"${s.title}" is now available on DJ Musta.`]);
                }
            }
        } catch (err) {
            console.error('Post-approve actions failed:', err.message);
        }
        return J(200, { success:true });
    }

    // ── REJECT SONG ────────────────────────────────────────
    if (method === 'PATCH' && seg[0]==='songs' && seg[2]==='reject') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        await query('UPDATE songs SET approved=FALSE WHERE id=$1', [seg[1]]);
        return J(200, { success:true });
    }

    // ── PATCH SONG (admin) ─────────────────────────────────
    if (method === 'PATCH' && seg[0]==='songs' && seg[1] && !seg[2]) {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const body = await parseJSON(req);
        const allowed = ['title','artist','genre','duration','lyrics','description','release_year','album',
                         'is_featured','is_song_of_day','sponsored_until','sponsor_name','producer','video_url'];
        const sets = []; const vals = [];
        for (const key of allowed) {
            if (body[key] !== undefined) { vals.push(body[key]); sets.push(key+'=$'+vals.length); }
        }
        if (body.releaseYear !== undefined && body.release_year === undefined) {
            vals.push(body.releaseYear); sets.push('release_year=$'+vals.length);
        }
        if (body.albumName !== undefined && body.album === undefined) {
            vals.push(body.albumName); sets.push('album=$'+vals.length);
        }
        if (!sets.length) return J(400, { error:'No valid fields' });
        if (body.is_song_of_day === true) {
            await query('UPDATE songs SET is_song_of_day=FALSE WHERE is_song_of_day=TRUE');
        }
        vals.push(seg[1]);
        await query('UPDATE songs SET '+sets.join(', ')+' WHERE id=$'+vals.length, vals);
        return J(200, { success:true });
    }

    // ── SONG OF DAY ────────────────────────────────────────
    if (method === 'PATCH' && pathname === '/api/songs/admin/song-of-day') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const { song_id } = await parseJSON(req);
        await query('UPDATE songs SET is_song_of_day=FALSE WHERE is_song_of_day=TRUE');
        if (song_id) await query('UPDATE songs SET is_song_of_day=TRUE WHERE id=$1', [song_id]);
        return J(200, { success:true });
    }

    // ── LIKE ───────────────────────────────────────────────
    if (method === 'POST' && seg[0]==='songs' && seg[2]==='like') {
        if (!user) return J(401, { error:'Login required' });
        const songId = parseInt(seg[1]);
        const song   = await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [songId]);
        if (!song.rows[0]) return J(404, { error:'Not found' });
        const exists = await query('SELECT id FROM likes WHERE user_id=$1 AND song_id=$2', [user.id, songId]);
        if (exists.rows.length) {
            await query('DELETE FROM likes WHERE user_id=$1 AND song_id=$2', [user.id, songId]);
            await query('UPDATE songs SET like_count=GREATEST(0,like_count-1) WHERE id=$1', [songId]);
            const updated = await query('SELECT like_count FROM songs WHERE id=$1', [songId]);
            return J(200, { liked:false, likeCount: updated.rows[0].like_count });
        } else {
            await query('INSERT INTO likes (user_id,song_id) VALUES ($1,$2)', [user.id, songId]);
            await query('UPDATE songs SET like_count=like_count+1 WHERE id=$1', [songId]);
            const updated = await query('SELECT like_count FROM songs WHERE id=$1', [songId]);
            return J(200, { liked:true, likeCount: updated.rows[0].like_count });
        }
    }

    // ── DOWNLOAD TRACK (✅ FIX #4: rate limited) ────────────
    if (method === 'POST' && seg[0]==='songs' && seg[2]==='download') {
        if (downloadRateLimit(ip)) return J(429, { error: 'Slow down' });
        const r = await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Not found' });
        await query('UPDATE songs SET download_count=download_count+1 WHERE id=$1', [seg[1]]);
        await query('INSERT INTO downloads (user_id,song_id,ip) VALUES ($1,$2,$3)', [user?.id||null, seg[1], ip]);
        return J(200, { success:true });
    }

    // ── STREAM (✅ FIX #4 + #14 + #15) ──────────────────────
    if (method === 'GET' && seg[0]==='songs' && seg[1] && seg[2]==='stream') {
        if (streamRateLimit(ip)) return J(429, { error: 'Slow down' });
        const r = await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Not found' });
        const song = r.rows[0];
        const fileUrl = song.file_path;
        if (!fileUrl) return J(404, { error:'No file' });

        function getAudioContentType(filePath) {
            const p = filePath.toLowerCase();
            if (p.endsWith('.wav') || p.endsWith('.wave')) return 'audio/wav';
            if (p.endsWith('.m4a') || p.endsWith('.m4b'))  return 'audio/mp4';
            if (p.endsWith('.ogg') || p.endsWith('.oga'))  return 'audio/ogg';
            if (p.endsWith('.webm'))                        return 'audio/webm';
            if (p.endsWith('.flac'))                        return 'audio/flac';
            if (p.endsWith('.aac'))                         return 'audio/aac';
            return 'audio/mpeg';
        }

        if (!fileUrl.startsWith('http://') && !fileUrl.startsWith('https://')) {
            const localPath = fileUrl.startsWith('/')
                ? path.join(__dirname, '..', fileUrl)
                : path.join(__dirname, fileUrl);
            if (!fs.existsSync(localPath)) return J(404, { error: 'Audio file not found' });
            const stat = fs.statSync(localPath);
            const contentType = getAudioContentType(localPath);
            const rangeHeader = req.headers.range;
            if (rangeHeader) {
                const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
                const start = parseInt(startStr, 10);
                const end   = endStr ? parseInt(endStr, 10) : stat.size - 1;
                const chunkSize = (end - start) + 1;
                res.writeHead(206, {
                    'Content-Type': contentType,
                    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunkSize,
                    'Cache-Control': 'public,max-age=3600',
                    ...corsHeaders(origin)
                });
                fs.createReadStream(localPath, { start, end }).pipe(res);
            } else {
                res.writeHead(200, {
                    'Content-Type': contentType,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': stat.size,
                    'Cache-Control': 'public,max-age=3600',
                    ...corsHeaders(origin)
                });
                fs.createReadStream(localPath).pipe(res);
            }
            return;
        }

        // ✅ FIX #14: guard against invalid URLs
        let urlPath;
        try { urlPath = new URL(fileUrl).pathname.toLowerCase(); }
        catch(e) { return J(500, { error: 'Invalid file URL' }); }

        return new Promise((resolve) => {
            const reqHeaders = { 'User-Agent': 'DJMusta/1.0' };
            if (req.headers.range) reqHeaders['Range'] = req.headers.range;
            const client = fileUrl.startsWith('https:') ? https : http;
            const proxyReq = client.get(fileUrl, { headers: reqHeaders }, (proxyRes) => {
                const status = proxyRes.statusCode || 200;
                let contentType = getAudioContentType(urlPath);
                if (contentType === 'audio/mpeg' && !urlPath.endsWith('.mp3')) {
                    if (proxyRes.headers['content-type']?.startsWith('audio/')) {
                        contentType = proxyRes.headers['content-type'];
                    }
                }
                const resHeaders = {
                    'Content-Type': contentType,
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'public,max-age=3600',
                    ...corsHeaders(origin)
                };
                if (proxyRes.headers['content-length']) resHeaders['Content-Length'] = proxyRes.headers['content-length'];
                if (proxyRes.headers['content-range'])  resHeaders['Content-Range']  = proxyRes.headers['content-range'];
                res.writeHead(status, resHeaders);
                proxyRes.pipe(res);
                proxyRes.on('end', resolve);
            });
            proxyReq.on('error', (err) => {
                console.error('[Stream error]', err.message);
                if (!res.headersSent) { res.writeHead(500, corsHeaders(origin)); res.end(); }
                resolve();
            });
        });
    }

    // ── DOWNLOAD FILE (✅ FIX #4 + #15) ─────────────────────
    if (method === 'GET' && seg[0]==='songs' && seg[2]==='download-file') {
        if (downloadRateLimit(ip)) return J(429, { error: 'Slow down' });
        const r = await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Not found' });

        const song = r.rows[0];
        const fileUrl = song.file_path;
        const cleanTitle = song.title.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim().replace(/\s+/g, '_') || 'song';
        const cleanArtist = song.artist.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim().replace(/\s+/g, '_') || 'artist';
        const cleanFilename = `${cleanTitle}_${cleanArtist}_[this_song_downloaded_from_www.Djmusta.com].mp3`;

        await query('UPDATE songs SET download_count=download_count+1 WHERE id=$1', [seg[1]]);
        await query('INSERT INTO downloads (user_id,song_id,ip) VALUES ($1,$2,$3)', [user?.id||null, seg[1], ip]);

        // Legacy local file
        if (!fileUrl.startsWith('http://') && !fileUrl.startsWith('https://')) {
            const localPath = fileUrl.startsWith('/')
                ? path.join(__dirname, '..', fileUrl)
                : path.join(__dirname, fileUrl);
            if (!fs.existsSync(localPath)) return J(404, { error: 'File not found' });
            const stat = fs.statSync(localPath);
            res.writeHead(200, {
                'Content-Type': 'audio/mpeg',
                'Content-Length': stat.size,
                'Content-Disposition': `attachment; filename="${cleanFilename}"`,
                'Cache-Control': 'public,max-age=3600',
                ...corsHeaders(origin)
            });
            fs.createReadStream(localPath).pipe(res);
            return;
        }

        return new Promise((resolve) => {
            const client = fileUrl.startsWith('https:') ? https : http;
            client.get(fileUrl, (proxyRes) => {
                if (proxyRes.statusCode !== 200) {
                    res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders(origin) });
                    res.end(JSON.stringify({ error: 'File not found' }));
                    return resolve();
                }
                const headers = {
                    'Content-Type': 'audio/mpeg',
                    'Content-Disposition': `attachment; filename="${cleanFilename}"`,
                    'Cache-Control': 'public,max-age=3600',
                    ...corsHeaders(origin)
                };
                // ✅ FIX #15: don't send undefined Content-Length
                if (proxyRes.headers['content-length']) headers['Content-Length'] = proxyRes.headers['content-length'];
                res.writeHead(200, headers);
                proxyRes.pipe(res);
                proxyRes.on('end', resolve);
            }).on('error', () => {
                res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders(origin) });
                res.end(JSON.stringify({ error: 'Download failed' }));
                resolve();
            });
        });
    }

    // ── ADMIN TOGGLE ADMIN ─────────────────────────────────
    if (method === 'PATCH' && seg[0]==='songs' && seg[1]==='admin' && seg[2]==='users' && seg[4]==='admin') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const body = await parseJSON(req);
        await query('UPDATE users SET is_admin=$1 WHERE id=$2', [!!body.isAdmin, seg[3]]);
        return J(200, { success:true });
    }

    // ── PLAYLISTS ──────────────────────────────────────────
    if (method === 'GET' && pathname === '/api/playlists') {
        if (!user) return J(401, { error:'Login required' });
        const r = await query('SELECT p.*, COUNT(ps.song_id) as song_count FROM playlists p LEFT JOIN playlist_songs ps ON p.id=ps.playlist_id WHERE p.user_id=$1 GROUP BY p.id ORDER BY p.created_at DESC', [user.id]);
        return J(200, { playlists: r.rows });
    }
    if (method === 'POST' && pathname === '/api/playlists') {
        if (!user) return J(401, { error:'Login required' });
        const { name, description, isPublic } = await parseJSON(req);
        if (!name || name.trim().length === 0) return J(400, { error:'Playlist name required' });
        const r = await query('INSERT INTO playlists (user_id,name,description,is_public) VALUES ($1,$2,$3,$4) RETURNING *', [user.id, name.trim(), description||'', !!isPublic]);
        return J(201, { playlist: r.rows[0] });
    }
    if (method === 'GET' && seg[0]==='playlists' && seg[1] && !isNaN(seg[1]) && !seg[2]) {
        const r = await query('SELECT p.* FROM playlists p WHERE p.id=$1 AND (p.is_public=TRUE OR p.user_id=$2)', [seg[1], user?.id||null]);
        if (!r.rows[0]) return J(404, { error:'Playlist not found' });
        const songs = await query('SELECT s.*, ps.added_at FROM songs s INNER JOIN playlist_songs ps ON s.id=ps.song_id WHERE ps.playlist_id=$1 AND s.approved=TRUE ORDER BY ps.position, ps.added_at', [seg[1]]);
        return J(200, { playlist: r.rows[0], songs: songs.rows });
    }
    if (method === 'POST' && seg[0]==='playlists' && seg[1] && seg[2]==='songs') {
        if (!user) return J(401, { error:'Login required' });
        const { songId } = await parseJSON(req);
        if (!songId) return J(400, { error:'Song ID required' });
        const playlist = await query('SELECT id FROM playlists WHERE id=$1 AND user_id=$2', [seg[1], user.id]);
        if (!playlist.rows[0]) return J(404, { error:'Playlist not found or not yours' });
        const song = await query('SELECT id FROM songs WHERE id=$1 AND approved=TRUE', [songId]);
        if (!song.rows[0]) return J(404, { error:'Song not found' });
        try {
            await query('INSERT INTO playlist_songs (playlist_id,song_id) VALUES ($1,$2)', [seg[1], songId]);
            return J(200, { success:true });
        } catch(e) {
            if (e.message.includes('duplicate')) return J(409, { error:'Song already in playlist' });
            throw e;
        }
    }
    if (method === 'DELETE' && seg[0]==='playlists' && seg[1] && seg[2]==='songs' && seg[3]) {
        if (!user) return J(401, { error:'Login required' });
        const playlist = await query('SELECT id FROM playlists WHERE id=$1 AND user_id=$2', [seg[1], user.id]);
        if (!playlist.rows[0]) return J(404, { error:'Playlist not found or not yours' });
        await query('DELETE FROM playlist_songs WHERE playlist_id=$1 AND song_id=$2', [seg[1], seg[3]]);
        return J(200, { success:true });
    }
    if (method === 'DELETE' && seg[0]==='playlists' && seg[1] && !seg[2]) {
        if (!user) return J(401, { error:'Login required' });
        const playlist = await query('SELECT id FROM playlists WHERE id=$1 AND user_id=$2', [seg[1], user.id]);
        if (!playlist.rows[0]) return J(404, { error:'Playlist not found or not yours' });
        await query('DELETE FROM playlists WHERE id=$1', [seg[1]]);
        return J(200, { success:true });
    }

    // ── ARTISTS ────────────────────────────────────────────
    // ✅ FIX #2: define q here — was crashing before
    if (method === 'GET' && pathname === '/api/artists') {
        const limitVal = Math.min(parseInt(q.get('limit') || 200), 500);
        const artists = await query(`
            SELECT
                INITCAP(LOWER(s.artist)) AS name,
                COUNT(s.id)::int AS song_count,
                MAX(s.play_count) AS top_plays,
                (SELECT s2.genre FROM songs s2 WHERE LOWER(s2.artist) = LOWER(s.artist) AND s2.approved = TRUE AND s2.genre IS NOT NULL ORDER BY s2.play_count DESC LIMIT 1) AS genre,
                CASE
                    WHEN MAX(a.photo_url) IS NOT NULL AND MAX(a.photo_url) NOT LIKE 'data:%'
                    THEN MAX(a.photo_url)
                    WHEN MAX(a.photo_url) LIKE 'data:%'
                    THEN 'has_photo'
                    ELSE NULL
                END AS photo_url,
                MAX(a.bio) AS bio,
                MAX(a.instagram) AS instagram,
                MAX(a.twitter) AS twitter,
                MAX(a.facebook) AS facebook,
                bool_or(vr.status = 'approved') AS is_verified
            FROM songs s
            LEFT JOIN artists a ON LOWER(a.name) = LOWER(s.artist)
            LEFT JOIN verification_requests vr ON LOWER(vr.artist_name) = LOWER(s.artist) AND vr.status = 'approved'
            WHERE s.approved = TRUE
            GROUP BY LOWER(s.artist)
            ORDER BY song_count DESC, LOWER(s.artist)
            LIMIT $1
        `, [limitVal]);
        return JC(200, { artists: artists.rows }, 300);
    }

    if (method === 'GET' && seg[0]==='artists' && seg[1] && !seg[2]) {
        const artistName = decodeURIComponent(seg[1]);
        const profile = await query(`
            SELECT a.*,
                   EXISTS(SELECT 1 FROM verification_requests vr WHERE LOWER(vr.artist_name)=LOWER(a.name) AND vr.status='approved') AS is_verified
            FROM artists a WHERE LOWER(a.name)=LOWER($1)
        `, [artistName]);
        const songs = await query('SELECT * FROM songs WHERE LOWER(artist)=LOWER($1) AND approved=TRUE ORDER BY created_at DESC', [artistName]);
        const artistData = profile.rows[0] || { name: artistName, bio: '', photo_url: null, is_verified: false };
        return J(200, { artist: artistData, songs: songs.rows });
    }

    if (method === 'PATCH' && seg[0]==='artists' && seg[1] && !seg[2]) {
        if (!user) return J(401, { error:'Login required' });
        const artistName = decodeURIComponent(seg[1]);
        if (!user.isAdmin) {
            const ownership = await query('SELECT 1 FROM songs WHERE uploaded_by=$1 AND LOWER(artist)=LOWER($2) LIMIT 1', [user.id, artistName]);
            if (!ownership.rows.length) return J(403, { error:'You can only edit an artist profile linked to your uploads' });
        }
        const { bio, photoUrl, photo_url, instagram, twitter, facebook } = await parseJSON(req);
        const savedPhotoUrl = photoUrl || photo_url || null;
        const existing = await query('SELECT id FROM artists WHERE LOWER(name)=LOWER($1)', [artistName]);
        if (existing.rows.length) {
            await query('UPDATE artists SET bio=$1, photo_url=$2, instagram=$3, twitter=$4, facebook=$5 WHERE LOWER(name)=LOWER($6)',
                [bio||'', savedPhotoUrl, instagram||'', twitter||'', facebook||'', artistName]);
        } else {
            await query('INSERT INTO artists (name,bio,photo_url,instagram,twitter,facebook) VALUES ($1,$2,$3,$4,$5,$6)',
                [artistName, bio||'', savedPhotoUrl, instagram||'', twitter||'', facebook||'']);
        }
        return J(200, { success:true, photoUrl: savedPhotoUrl, photo_url: savedPhotoUrl });
    }

    if (method === 'POST' && pathname === '/api/artists/photo') {
        if (!user) return J(401, { error:'Login required' });
        const ct = req.headers['content-type'] || '';
        if (!ct.includes('multipart/form-data')) return J(400, { error:'Request must be multipart/form-data' });
        const contentLength = parseInt(req.headers['content-length'] || '0', 10);
        if (contentLength > 5 * 1024 * 1024) return J(400, { error:'Photo too large. Max 4MB.' });
        try {
            const { fields, files } = await parseMultipart(req);
            const photo = files['photo'] || files['image'];
            const artistName = (fields['artistName'] || '').trim();
            if (!photo || !photo.data || photo.data.length === 0) return J(400, { error:'No photo uploaded.' });
            if (!artistName) return J(400, { error:'Artist name required' });
            if (!user.isAdmin) {
                const ownership = await query('SELECT 1 FROM songs WHERE uploaded_by=$1 AND LOWER(artist)=LOWER($2) LIMIT 1', [user.id, artistName]);
                if (!ownership.rows.length) return J(403, { error:'You can only edit an artist profile linked to your uploads' });
            }
            if (photo.data.length > 4 * 1024 * 1024) return J(400, { error:'Photo too large. Max 4MB.' });
            const allowedMimes = ['image/jpeg','image/jpg','image/png','image/webp','image/gif'];
            const mime = (photo.mimetype || '').toLowerCase().split(';')[0].trim();
            if (!allowedMimes.includes(mime)) return J(400, { error:'Invalid file type. Use JPG, PNG, or WebP.' });

            let photoUrl;
            try { photoUrl = await r2Upload(photo, 'artists'); }
            catch(e) {
                const base64 = photo.data.toString('base64');
                photoUrl = `data:${mime};base64,${base64}`;
            }

            const existing = await query('SELECT id FROM artists WHERE LOWER(name)=LOWER($1)', [artistName]);
            if (existing.rows.length) {
                await query('UPDATE artists SET photo_url=$1 WHERE LOWER(name)=LOWER($2)', [photoUrl, artistName]);
            } else {
                await query('INSERT INTO artists (name, photo_url) VALUES ($1,$2)', [artistName, photoUrl]);
            }
            return J(200, { success:true, photoUrl, photo_url: photoUrl });
        } catch(err) {
            return J(500, { error:'Upload failed: ' + err.message });
        }
    }

    // ── HISTORY / RECOMMENDATIONS / TRENDING ───────────────
    if (method === 'GET' && pathname === '/api/history/recent') {
        if (!user) return J(401, { error:'Login required' });
        const r = await query(`
            SELECT DISTINCT ON (s.id) s.*, p.created_at as played_at
            FROM songs s
            INNER JOIN plays p ON s.id=p.song_id
            WHERE p.user_id=$1 AND s.approved=TRUE
            ORDER BY s.id, p.created_at DESC LIMIT 20
        `, [user.id]);
        return J(200, { songs: r.rows });
    }
    if (method === 'GET' && pathname === '/api/recommendations') {
        if (!user) return J(401, { error:'Login required' });
        const r = await query(`
            SELECT DISTINCT s.* FROM songs s
            WHERE s.approved=TRUE AND s.id NOT IN (SELECT song_id FROM likes WHERE user_id=$1)
            AND (s.genre IN (SELECT DISTINCT genre FROM songs WHERE id IN (SELECT song_id FROM likes WHERE user_id=$1))
                 OR s.artist IN (SELECT DISTINCT artist FROM songs WHERE id IN (SELECT song_id FROM likes WHERE user_id=$1)))
            ORDER BY s.play_count DESC, s.created_at DESC LIMIT 20
        `, [user.id]);
        return J(200, { songs: r.rows });
    }
    if (method === 'GET' && pathname === '/api/trending') {
        const r = await query(`
            SELECT s.*, COUNT(p.id) as recent_plays
            FROM songs s
            LEFT JOIN plays p ON s.id=p.song_id AND p.created_at > NOW() - INTERVAL '7 days'
            WHERE s.approved=TRUE
            GROUP BY s.id
            ORDER BY recent_plays DESC, s.play_count DESC LIMIT 50
        `);
        return JC(200, { songs: r.rows }, 120);
    }

    // ── COMMENTS ───────────────────────────────────────────
    if (method === 'GET' && seg[0]==='songs' && seg[1] && seg[2]==='comments') {
        const r = await query(`SELECT c.*, u.username FROM comments c INNER JOIN users u ON c.user_id=u.id WHERE c.song_id=$1 ORDER BY c.created_at DESC`, [seg[1]]);
        return J(200, { comments: r.rows });
    }
    if (method === 'POST' && seg[0]==='songs' && seg[1] && seg[2]==='comments') {
        if (!user) return J(401, { error:'Login required' });
        const { comment } = await parseJSON(req);
        if (!comment || comment.trim().length === 0) return J(400, { error:'Comment cannot be empty' });
        const r = await query('INSERT INTO comments (user_id,song_id,comment) VALUES ($1,$2,$3) RETURNING *', [user.id, seg[1], comment.trim()]);
        return J(201, { comment: { ...r.rows[0], username: user.username } });
    }
    if (method === 'DELETE' && seg[0]==='comments' && seg[1]) {
        if (!user) return J(401, { error:'Login required' });
        const comment = await query('SELECT * FROM comments WHERE id=$1', [seg[1]]);
        if (!comment.rows[0]) return J(404, { error:'Comment not found' });
        if (comment.rows[0].user_id !== user.id && !user.isAdmin) return J(403, { error:'Forbidden' });
        await query('DELETE FROM comments WHERE id=$1', [seg[1]]);
        return J(200, { success:true });
    }

    // ── FOLLOWS ────────────────────────────────────────────
    if (method === 'POST' && seg[0]==='artists' && seg[1] && seg[2]==='follow') {
        if (!user) return J(401, { error:'Login required' });
        const artistName = decodeURIComponent(seg[1]);
        try {
            await query('INSERT INTO follows (follower_id,artist_name) VALUES ($1,$2)', [user.id, artistName]);
            return J(200, { following:true });
        } catch(e) {
            if (e.message.includes('duplicate')) return J(200, { following:true });
            throw e;
        }
    }
    if (method === 'DELETE' && seg[0]==='artists' && seg[1] && seg[2]==='follow') {
        if (!user) return J(401, { error:'Login required' });
        const artistName = decodeURIComponent(seg[1]);
        await query('DELETE FROM follows WHERE follower_id=$1 AND artist_name=$2', [user.id, artistName]);
        return J(200, { following:false });
    }
    if (method === 'GET' && seg[0]==='artists' && seg[1] && seg[2]==='following') {
        if (!user) return J(200, { following:false });
        const artistName = decodeURIComponent(seg[1]);
        const r = await query('SELECT id FROM follows WHERE follower_id=$1 AND artist_name=$2', [user.id, artistName]);
        return J(200, { following: r.rows.length > 0 });
    }
    if (method === 'GET' && pathname === '/api/following') {
        if (!user) return J(401, { error:'Login required' });
        const r = await query('SELECT artist_name FROM follows WHERE follower_id=$1 ORDER BY created_at DESC', [user.id]);
        return J(200, { artists: r.rows.map(x => x.artist_name) });
    }

    // ── NOTIFICATIONS ──────────────────────────────────────
    if (method === 'GET' && pathname === '/api/notifications') {
        if (!user) return J(401, { error:'Login required' });
        const r = await query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [user.id]);
        return J(200, { notifications: r.rows });
    }
    if (method === 'PATCH' && seg[0]==='notifications' && seg[1] && seg[2]==='read') {
        if (!user) return J(401, { error:'Login required' });
        await query('UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2', [seg[1], user.id]);
        return J(200, { success:true });
    }
    if (method === 'PATCH' && pathname === '/api/notifications/read-all') {
        if (!user) return J(401, { error:'Login required' });
        await query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1', [user.id]);
        return J(200, { success:true });
    }

    // ── PROFILE ────────────────────────────────────────────
    if (method === 'PATCH' && pathname === '/api/auth/profile') {
        if (!user) return J(401, { error:'Login required' });
        const { username } = await parseJSON(req);
        if (!username || username.trim().length < 3) return J(400, { error:'Username must be at least 3 characters' });
        await query('UPDATE users SET username=$1 WHERE id=$2', [username.trim(), user.id]);
        return J(200, { success:true });
    }
    if (method === 'POST' && pathname === '/api/auth/profile/photo') {
        if (!user) return J(401, { error:'Login required' });
        try {
            const { files } = await parseMultipart(req);
            const photo = files['photo'];
            if (!photo) return J(400, { error:'No photo uploaded' });
            if (photo.data.length > 2 * 1024 * 1024) return J(400, { error:'Photo too large. Max 2MB.' });
            const base64 = photo.data.toString('base64');
            const dataUrl = `data:${photo.mimetype};base64,${base64}`;
            await query('UPDATE users SET profile_photo=$1 WHERE id=$2', [dataUrl, user.id]);
            return J(200, { success: true });
        } catch(err) {
            return J(500, { error:'Upload failed: ' + err.message });
        }
    }
    if (method === 'GET' && pathname === '/api/stats/user') {
        if (!user) return J(401, { error:'Login required' });
        const plays = await query('SELECT COUNT(*) FROM plays WHERE user_id=$1', [user.id]);
        const likes = await query('SELECT COUNT(*) FROM likes WHERE user_id=$1', [user.id]);
        const downloads = await query('SELECT COUNT(*) FROM downloads WHERE user_id=$1', [user.id]);
        const uploads = await query('SELECT COUNT(*) FROM songs WHERE uploaded_by=$1', [user.id]);
        const playlists = await query('SELECT COUNT(*) FROM playlists WHERE user_id=$1', [user.id]);
        return J(200, {
            plays: parseInt(plays.rows[0].count),
            likes: parseInt(likes.rows[0].count),
            downloads: parseInt(downloads.rows[0].count),
            uploads: parseInt(uploads.rows[0].count),
            playlists: parseInt(playlists.rows[0].count)
        });
    }

    // ── VERIFICATION ───────────────────────────────────────
    if (method === 'POST' && pathname === '/api/verification/request') {
        try {
            if (!user) return J(401, { error:'Unauthorized' });
            const body = await parseJSON(req);
            const artistName = body.artist_name || body.artistName;
            const phone = body.phone;
            const socialLinks = body.social_links || body.socialLinks;
            const reason = body.reason;
            if (!artistName || !phone || !socialLinks || !reason) return J(400, { error:'All fields required' });

            const approved = await query('SELECT id FROM verification_requests WHERE user_id=$1 AND status=$2 LIMIT 1', [user.id, 'approved']);
            if (approved.rows.length > 0) return J(400, { error:'You are already verified' });

            const existing = await query('SELECT id FROM verification_requests WHERE user_id=$1 AND status=$2', [user.id, 'pending']);
            if (existing.rows.length > 0) return J(400, { error:'You already have a pending verification request' });

            await query('INSERT INTO verification_requests (user_id, artist_name, phone, social_links, reason, status) VALUES ($1,$2,$3,$4,$5,$6)',
                [user.id, artistName, phone, socialLinks, reason, 'pending']);
            return J(201, { success:true, message:'Verification request submitted successfully' });
        } catch (err) {
            return J(500, { error: 'Internal server error: ' + err.message });
        }
    }
    if (method === 'GET' && pathname === '/api/verification/requests') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const statusRaw = parsed.searchParams.get('status') || 'pending';
        // ✅ FIX #24: allowlist
        const status = ['pending','approved','rejected'].includes(statusRaw) ? statusRaw : 'pending';
        const r = await query(`
            SELECT vr.*, u.username, u.email
            FROM verification_requests vr
            INNER JOIN users u ON vr.user_id=u.id
            WHERE vr.status=$1
            ORDER BY vr.submitted_at DESC
        `, [status]);
        return J(200, { requests: r.rows });
    }
    if (method === 'POST' && seg[0]==='verification' && seg[1]==='review' && seg[2] && !seg[3]) {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const requestId = seg[2];
        const body = await parseJSON(req);
        const action = body.action;
        const adminNotes = body.adminNotes || body.admin_notes || '';
        if (!['approve', 'reject'].includes(action)) return J(400, { error:'Invalid action' });

        const request = await query('SELECT * FROM verification_requests WHERE id=$1', [requestId]);
        if (!request.rows[0]) return J(404, { error:'Verification request not found' });

        const status = action === 'approve' ? 'approved' : 'rejected';
        const userId = request.rows[0].user_id;

        await query('UPDATE verification_requests SET status=$1, reviewed_at=NOW(), reviewed_by=$2, admin_notes=$3 WHERE id=$4',
            [status, user.id, adminNotes, requestId]);

        const notifTitle = action === 'approve' ? '✅ Verification Approved!' : '❌ Verification Rejected';
        const notifMessage = action === 'approve'
            ? 'Congratulations! Your artist verification has been approved.'
            : `Your verification request has been rejected. ${adminNotes ? 'Reason: ' + adminNotes : ''}`;
        await query('INSERT INTO notifications (user_id, type, title, message) VALUES ($1, $2, $3, $4)',
            [userId, 'verification_' + status, notifTitle, notifMessage]);

        const userInfo = await query('SELECT email, username FROM users WHERE id=$1', [userId]);
        if (userInfo.rows[0]) {
            const { email: uEmail, username: uName } = userInfo.rows[0];
            sendEmail(uEmail, notifTitle + ' - DJ Musta', `
                <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0a0e27;color:#e2e8f0;padding:30px;border-radius:12px">
                    <h2 style="color:${action === 'approve' ? '#22c55e' : '#ef4444'}">${notifTitle}</h2>
                    <p>Hi <strong>${uName}</strong>, ${notifMessage}</p>
                    <a href="${SITE_URL}" style="display:inline-block;margin:20px 0;padding:14px 28px;background:#a855f7;color:white;border-radius:8px;text-decoration:none;font-weight:700">Visit DJ Musta</a>
                </div>`);
        }
        return J(200, { success:true, message:`Verification request ${action}d successfully` });
    }
    if (method === 'GET' && pathname === '/api/verification/status') {
        if (!user) return J(401, { error:'Unauthorized' });
        const approvedRequest = await query('SELECT * FROM verification_requests WHERE user_id=$1 AND status=$2 ORDER BY reviewed_at DESC LIMIT 1', [user.id, 'approved']);
        const isVerified = approvedRequest.rows.length > 0;
        const pendingRequest = await query('SELECT * FROM verification_requests WHERE user_id=$1 AND status=$2', [user.id, 'pending']);
        return J(200, {
            isVerified,
            hasPendingRequest: pendingRequest.rows.length > 0,
            request: pendingRequest.rows[0] || approvedRequest.rows[0] || null
        });
    }
    if (method === 'DELETE' && seg[0]==='verification' && seg[1]==='requests' && seg[2] && !seg[3]) {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const request = await query('SELECT * FROM verification_requests WHERE id=$1', [seg[2]]);
        if (!request.rows[0]) return J(404, { error:'Verification request not found' });
        await query('DELETE FROM verification_requests WHERE id=$1', [seg[2]]);
        return J(200, { success:true, message:'Verification request deleted' });
    }

    // ── ADMIN USERS ────────────────────────────────────────
    if (method === 'DELETE' && seg[0]==='admin' && seg[1]==='users' && seg[2]) {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        if (seg[2] == user.id) return J(400, { error:'Cannot delete yourself' });
        await query('DELETE FROM users WHERE id=$1 AND is_admin=FALSE', [seg[2]]);
        return J(200, { success:true });
    }

    // ── PREMIUM ────────────────────────────────────────────
    if (method === 'GET' && pathname === '/api/admin/premium') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const r = await query('SELECT id,username,email,is_premium,premium_since,premium_note,created_at FROM users WHERE is_premium=TRUE ORDER BY premium_since DESC');
        return J(200, { users: r.rows });
    }
    if (method === 'PATCH' && seg[0]==='admin' && seg[1]==='premium' && seg[2]) {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const { isPremium, note } = await parseJSON(req);
        const target = (await query('SELECT * FROM users WHERE id=$1', [seg[2]])).rows[0];
        if (!target) return J(404, { error:'User not found' });
        await query('UPDATE users SET is_premium=$1, premium_since=$2, premium_note=$3 WHERE id=$4',
            [!!isPremium, isPremium ? new Date() : null, note||null, seg[2]]);
        await query('INSERT INTO notifications (user_id,type,title,message) VALUES ($1,$2,$3,$4)',
            [seg[2], 'premium', isPremium ? '👑 Premium Activated!' : '⚠️ Premium Ended',
             isPremium ? 'Your account has been upgraded to Premium!' : 'Your premium subscription has ended.']);
        if (target.email) {
            sendEmail(target.email, isPremium ? '👑 Premium Activated - DJ Musta' : 'Premium Subscription Update', `
                <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0a0e27;color:#e2e8f0;padding:30px;border-radius:12px">
                    <h2 style="color:#f59e0b">${isPremium ? '👑 Premium Activated!' : 'Subscription Update'}</h2>
                    <p>Hi <strong>${target.username}</strong>,</p>
                    <p>${isPremium ? 'Your DJ Musta account has been upgraded to Premium!' : 'Your premium subscription has ended.'}</p>
                    ${note ? `<p style="background:#1a1f3a;padding:12px;border-radius:8px">Note: ${note}</p>` : ''}
                </div>`);
        }
        return J(200, { success:true });
    }

    // ── CHARTS ─────────────────────────────────────────────
    if (method === 'GET' && pathname === '/api/charts/top10') {
        const r = await query(`
            SELECT s.*, COUNT(p.id) as week_plays
            FROM songs s
            LEFT JOIN plays p ON s.id=p.song_id AND p.created_at > NOW() - INTERVAL '7 days'
            WHERE s.approved=TRUE
            GROUP BY s.id
            ORDER BY week_plays DESC, s.like_count DESC LIMIT 10
        `);
        return J(200, { songs: r.rows });
    }
    if (method === 'GET' && pathname === '/api/charts/top-artists') {
        const r = await query(`
            SELECT INITCAP(LOWER(s.artist)) as artist, COUNT(p.id) as week_plays, SUM(s.like_count) as total_likes
            FROM songs s
            LEFT JOIN plays p ON s.id=p.song_id AND p.created_at > NOW() - INTERVAL '7 days'
            WHERE s.approved=TRUE
            GROUP BY LOWER(s.artist)
            ORDER BY week_plays DESC LIMIT 5
        `);
        return J(200, { artists: r.rows });
    }

    if (method === 'GET' && seg[0]==='songs' && seg[1] && seg[2]==='related') {
        const song = (await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]])).rows[0];
        if (!song) return J(404, { error:'Song not found' });
        const related = await query(`
            SELECT * FROM songs
            WHERE approved=TRUE AND id != $1 AND (LOWER(artist)=LOWER($2) OR genre=$3)
            ORDER BY CASE WHEN LOWER(artist)=LOWER($2) THEN 0 ELSE 1 END, play_count DESC LIMIT 8
        `, [seg[1], song.artist, song.genre]);
        return J(200, { songs: related.rows });
    }

    // ── ADMIN STATS / ANALYTICS ────────────────────────────
    if (method === 'GET' && pathname === '/api/admin/stats') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const [songs, users, premium, plays, downloads, pending, comments, verifications] = await Promise.all([
            query('SELECT COUNT(*) FROM songs WHERE approved=TRUE'),
            query('SELECT COUNT(*) FROM users'),
            query('SELECT COUNT(*) FROM users WHERE is_premium=TRUE'),
            query('SELECT COALESCE(SUM(play_count),0) FROM songs WHERE approved=TRUE'),
            query('SELECT COALESCE(SUM(download_count),0) FROM songs WHERE approved=TRUE'),
            query('SELECT COUNT(*) FROM songs WHERE approved=FALSE'),
            query('SELECT COUNT(*) FROM comments'),
            query("SELECT COUNT(*) FROM verification_requests WHERE status='pending'")
        ]);
        return J(200, {
            songs: parseInt(songs.rows[0].count),
            users: parseInt(users.rows[0].count),
            premium: parseInt(premium.rows[0].count),
            plays: parseInt(plays.rows[0].coalesce),
            downloads: parseInt(downloads.rows[0].coalesce),
            pending: parseInt(pending.rows[0].count),
            comments: parseInt(comments.rows[0].count),
            verifications: parseInt(verifications.rows[0].count),
            revenue: parseInt(premium.rows[0].count) * 10000
        });
    }
    if (method === 'GET' && pathname === '/api/admin/analytics') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const [dailyPlays, dailyDownloads, topSongs, topArtists, uploadGrowth] = await Promise.all([
            query(`SELECT TO_CHAR(days.day, 'Mon DD') AS label, COUNT(p.id)::int AS value
                FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day') AS days(day)
                LEFT JOIN plays p ON p.created_at >= days.day AND p.created_at < days.day + INTERVAL '1 day'
                GROUP BY days.day ORDER BY days.day`),
            query(`SELECT TO_CHAR(days.day, 'Mon DD') AS label, COUNT(d.id)::int AS value
                FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day') AS days(day)
                LEFT JOIN downloads d ON d.created_at >= days.day AND d.created_at < days.day + INTERVAL '1 day'
                GROUP BY days.day ORDER BY days.day`),
            query(`SELECT title, artist, play_count::int AS plays, download_count::int AS downloads
                FROM songs WHERE approved=TRUE ORDER BY play_count DESC LIMIT 10`),
            query(`SELECT artist, SUM(play_count)::int AS plays, SUM(download_count)::int AS downloads, COUNT(*)::int AS songs
                FROM songs WHERE approved=TRUE GROUP BY artist ORDER BY SUM(play_count) DESC LIMIT 10`),
            query(`SELECT TO_CHAR(weeks.week, 'Mon DD') AS label, COUNT(s.id)::int AS value
                FROM generate_series(date_trunc('week', CURRENT_DATE) - INTERVAL '11 weeks', date_trunc('week', CURRENT_DATE), INTERVAL '1 week') AS weeks(week)
                LEFT JOIN songs s ON s.created_at >= weeks.week AND s.created_at < weeks.week + INTERVAL '1 week'
                GROUP BY weeks.week ORDER BY weeks.week`)
        ]);
        return J(200, {
            dailyPlays: dailyPlays.rows,
            dailyDownloads: dailyDownloads.rows,
            topSongs: topSongs.rows,
            topArtists: topArtists.rows,
            uploadGrowth: uploadGrowth.rows
        });
    }

    if (method === 'GET' && pathname === '/api/artist/stats') {
        if (!user) return J(401, { error:'Login required' });
        const r = await query(`
            SELECT s.id, s.title, s.artist, s.cover_path, s.play_count, s.download_count, s.like_count, s.created_at, s.approved
            FROM songs s WHERE s.uploaded_by=$1 ORDER BY s.play_count DESC
        `, [user.id]);
        const totals = r.rows.reduce((acc, s) => ({
            plays: acc.plays + (s.play_count||0),
            downloads: acc.downloads + (s.download_count||0),
            likes: acc.likes + (s.like_count||0)
        }), {plays:0, downloads:0, likes:0});
        return J(200, { songs: r.rows, totals });
    }

    if (method === 'GET' && pathname === '/api/songs/featured') {
        const r = await query(`SELECT s.* FROM songs s WHERE s.approved=TRUE AND s.is_featured=TRUE ORDER BY s.created_at DESC LIMIT 10`);
        return J(200, { songs: r.rows });
    }
    if (method === 'PATCH' && seg[0]==='songs' && seg[1] && seg[2]==='feature') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const { featured } = await parseJSON(req);
        await query('UPDATE songs SET is_featured=$1 WHERE id=$2', [!!featured, seg[1]]);
        return J(200, { success:true });
    }
    if (method === 'PATCH' && seg[0]==='songs' && seg[1] && seg[2]==='cover') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        try {
            const { files } = await parseMultipart(req);
            const cover = files['cover'];
            if (!cover) return J(400, { error:'No cover image uploaded' });
            if (cover.data.length > 5 * 1024 * 1024) return J(400, { error:'Image too large. Max 5MB.' });
            let coverPath;
            try { coverPath = await r2Upload(cover, 'covers'); }
            catch(e) { coverPath = saveLocal(cover, 'covers'); }
            await query('UPDATE songs SET cover_path=$1 WHERE id=$2', [coverPath, seg[1]]);
            return J(200, { success:true, coverPath });
        } catch(err) {
            return J(500, { error:'Cover update failed: ' + err.message });
        }
    }
    if (method === 'GET' && pathname === '/api/songs/new-this-week') {
        const r = await query(`
            SELECT s.*, COALESCE(vr.status,'none') as verified_status
            FROM songs s
            LEFT JOIN verification_requests vr ON vr.user_id=s.uploaded_by AND vr.status='approved'
            WHERE s.approved=TRUE AND s.created_at > NOW() - INTERVAL '7 days'
            ORDER BY s.created_at DESC LIMIT 20
        `);
        return J(200, { songs: r.rows });
    }
    if (method === 'POST' && seg[0]==='songs' && seg[1] && seg[2]==='report') {
        if (!user) return J(401, { error:'Login required' });
        const { reason } = await parseJSON(req);
        if (!reason) return J(400, { error:'Please provide a reason' });
        await query('INSERT INTO notifications (user_id,type,title,message) VALUES ($1,$2,$3,$4)',
            [1, 'report', `🚨 Song Report - ID ${seg[1]}`, `User ${user.email} reported song #${seg[1]}. Reason: ${reason}`]);
        return J(200, { success:true, message:'Song reported. Admin will review it.' });
    }
    if (method === 'GET' && seg[0]==='songs' && seg[1] && seg[2]==='embed') {
        const r = await query('SELECT id,title,artist,cover_path,duration FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Song not found' });
        const s = r.rows[0];
        const embedUrl = `${SITE_URL}?song=${s.id}`;
        const embedCode = `<iframe src="${SITE_URL}/embed/${s.id}" width="100%" height="120" frameborder="0" allow="autoplay" style="border-radius:12px"></iframe>`;
        return J(200, { song: s, embedUrl, embedCode });
    }
    if (method === 'PATCH' && pathname === '/api/admin/password') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const { newPassword } = await parseJSON(req);
        if (!newPassword || newPassword.length < 6) return J(400, { error:'Password must be at least 6 characters' });
        await query('UPDATE users SET password=$1, token_version=COALESCE(token_version,0)+1 WHERE id=$2',
            [hashPassword(newPassword), user.id]);
        return J(200, { success:true });
    }

    // ── PUSH ───────────────────────────────────────────────
    if (method === 'POST' && pathname === '/api/push/subscribe') {
        if (!VAPID_PRIVATE) return J(503, { error: 'Push notifications are not configured on the server' });
        const body = await parseJSON(req);
        const sub = body.subscription;
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return J(400, { error: 'Invalid subscription data' });
        await query(`
            INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id, user_agent)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (endpoint) DO UPDATE SET p256dh=$2, auth=$3, user_id=$4, user_agent=$5
        `, [sub.endpoint, sub.keys.p256dh, sub.keys.auth, user?.id || null, (body.userAgent || '').substring(0, 200)]);
        return J(200, { success: true });
    }
    if (method === 'POST' && pathname === '/api/push/unsubscribe') {
        const body = await parseJSON(req);
        if (!body.endpoint) return J(400, { error: 'Endpoint required' });
        await query('DELETE FROM push_subscriptions WHERE endpoint=$1', [body.endpoint]);
        return J(200, { success: true });
    }
    if (method === 'POST' && pathname === '/api/push/send') {
        if (!user?.isAdmin) return J(403, { error: 'Admin only' });
        if (!VAPID_PRIVATE) return J(503, { error: 'Push not configured' });
        const { title, body, songId, icon, url } = await parseJSON(req);
        if (!title || !body) return J(400, { error: 'title and body required' });
        const result = await sendPushToSubscribers({ title, body, songId, url });
        return J(200, { success: true, ...result });
    }
    if (method === 'GET' && pathname === '/api/push/count') {
        if (!user?.isAdmin) return J(403, { error: 'Admin only' });
        const r = await query('SELECT COUNT(*) as count FROM push_subscriptions');
        return J(200, { count: parseInt(r.rows[0].count) });
    }

    // ── PAYMENTS (Flutterwave) ─────────────────────────────
    if (method === 'POST' && pathname === '/api/payment/initiate') {
        const FLW_SECRET = process.env.FLW_SECRET_KEY;
        if (!FLW_SECRET || FLW_SECRET.includes('your-key')) return J(503, { error: 'Payments not configured.' });
        const { amount, phone, network, email, fullname, paymentType } = await parseJSON(req);
        if (!amount || !phone || !network || !email) return J(400, { error: 'amount, phone, network, email required' });
        const clean = phone.replace(/\D/g, '');
        if (!clean.startsWith('256') || clean.length !== 12) return J(400, { error: 'Invalid Uganda phone number.' });
        const txRef = `DJMUSTA-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const payload = JSON.stringify({
            tx_ref: txRef, amount, currency: 'UGX',
            email, phone_number: clean, fullname: fullname || 'DJ Musta User',
            network: network.toUpperCase(),
            redirect_url: `${SITE_URL}/payment/callback`,
            meta: { payment_type: paymentType || 'general', user_id: user?.id || null }
        });
        return new Promise(resolve => {
            const req2 = https.request({
                hostname: 'api.flutterwave.com', path: '/v3/charges?type=mobile_money_uganda', method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${FLW_SECRET}`, 'Content-Length': Buffer.byteLength(payload) }
            }, res2 => {
                let d = '';
                res2.on('data', c => d += c);
                res2.on('end', () => {
                    try {
                        const body = JSON.parse(d);
                        if (body.status === 'success') {
                            resolve(J(200, { success: true, reference: txRef, message: body.message || 'Approve on your phone', data: body.data }));
                        } else {
                            resolve(J(400, { error: body.message || 'Payment initiation failed' }));
                        }
                    } catch(e) { resolve(J(500, { error: 'Payment gateway error' })); }
                });
            });
            req2.on('error', e => resolve(J(500, { error: 'Payment request failed: ' + e.message })));
            req2.write(payload);
            req2.end();
        });
    }
    if (method === 'POST' && pathname === '/api/payment/verify') {
        const FLW_SECRET = process.env.FLW_SECRET_KEY;
        if (!FLW_SECRET || FLW_SECRET.includes('your-key')) return J(503, { error: 'Payments not configured' });
        const { transaction_id, tx_ref } = await parseJSON(req);
        if (!transaction_id && !tx_ref) return J(400, { error: 'transaction_id or tx_ref required' });
        const endpoint = transaction_id ? `/v3/transactions/${transaction_id}/verify` : `/v3/transactions?tx_ref=${tx_ref}`;
        return new Promise(resolve => {
            const req2 = https.request({
                hostname: 'api.flutterwave.com', path: endpoint, method: 'GET',
                headers: { 'Authorization': `Bearer ${FLW_SECRET}` }
            }, res2 => {
                let d = '';
                res2.on('data', c => d += c);
                res2.on('end', async () => {
                    try {
                        const body = JSON.parse(d);
                        const txData = body.data?.data?.[0] || body.data;
                        if (body.status === 'success' && txData?.status === 'successful') {
                            if (user && txData.meta?.payment_type?.includes('PREMIUM')) {
                                await query('UPDATE users SET is_premium=TRUE, premium_since=NOW() WHERE id=$1', [user.id]);
                                await query('INSERT INTO notifications (user_id,type,title,message) VALUES ($1,$2,$3,$4)',
                                    [user.id, 'premium', '👑 Premium Activated!', 'Your payment was successful. Premium features are now active!']);
                            }
                            resolve(J(200, { success: true, status: 'successful', data: txData }));
                        } else {
                            resolve(J(200, { success: false, status: txData?.status || 'pending', data: txData }));
                        }
                    } catch(e) { resolve(J(500, { error: 'Verification error' })); }
                });
            });
            req2.on('error', e => resolve(J(500, { error: 'Verification request failed: ' + e.message })));
            req2.end();
        });
    }
    if (method === 'POST' && pathname === '/api/payment/webhook') {
        const FLW_HASH = process.env.FLW_SECRET_HASH;
        const signature = req.headers['verif-hash'];
        if (!FLW_HASH || signature !== FLW_HASH) {
            console.warn('[Payment Webhook] Invalid signature');
            res.writeHead(401); res.end(); return;
        }
        const event = await parseJSON(req);
        if (event.event === 'charge.completed' && event.data?.status === 'successful') {
            const meta = event.data.meta || {};
            const userId = meta.user_id;
            const paymentType = meta.payment_type || '';
            if (userId && paymentType.includes('PREMIUM')) {
                await query('UPDATE users SET is_premium=TRUE, premium_since=NOW() WHERE id=$1', [userId]).catch(() => {});
                await query('INSERT INTO notifications (user_id,type,title,message) VALUES ($1,$2,$3,$4)',
                    [userId, 'premium', '👑 Premium Activated!', 'Your mobile money payment was confirmed.']).catch(() => {});
            }
        }
        res.writeHead(200); res.end('ok'); return;
    }
    if (method === 'GET' && pathname === '/api/payment/types') {
        return JC(200, {
            types: [
                { id: 'PREMIUM_MONTHLY', label: 'Premium (1 Month)', amount: 10000, currency: 'UGX' },
                { id: 'PREMIUM_YEARLY',  label: 'Premium (1 Year)',  amount: 100000, currency: 'UGX' },
                { id: 'ARTIST_TIP',      label: 'Tip an Artist',     amount: 5000,  currency: 'UGX' },
                { id: 'FEATURED_SONG',   label: 'Feature a Song (7 days)', amount: 50000, currency: 'UGX' }
            ],
            networks: ['MTN', 'AIRTEL']
        }, 300);
    }

    // ── RINGTONE ───────────────────────────────────────────
    if (method === 'GET' && seg[0]==='songs' && seg[1] && seg[2]==='ringtone') {
        if (downloadRateLimit(ip)) return J(429, { error: 'Slow down' });
        const r = await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Song not found' });
        const song = r.rows[0];
        const fileUrl = song.file_path;
        if (!fileUrl) return J(404, { error:'No audio file' });

        const cleanTitle  = song.title.replace(/[^a-zA-Z0-9\s\-_]/g,'').trim().replace(/\s+/g,'_') || 'ringtone';
        const cleanArtist = song.artist.replace(/[^a-zA-Z0-9\s\-_]/g,'').trim().replace(/\s+/g,'_') || 'djmusta';
        const filename    = `${cleanTitle}_${cleanArtist}_ringtone_djmusta.mp3`;

        await query('UPDATE songs SET download_count=download_count+1 WHERE id=$1', [seg[1]]).catch(()=>{});

        if (!fileUrl.startsWith('http')) {
            const localPath = path.join(__dirname, '..', fileUrl);
            if (!fs.existsSync(localPath)) return J(404, { error:'File not found' });
            const stat = fs.statSync(localPath);
            const maxBytes = Math.min(480 * 1024, stat.size);
            res.writeHead(200, {
                'Content-Type': 'audio/mpeg',
                'Content-Length': maxBytes,
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'public,max-age=86400',
                ...corsHeaders(origin)
            });
            fs.createReadStream(localPath, { start: 0, end: maxBytes - 1 }).pipe(res);
            return;
        }

        return new Promise(resolve => {
            const client = fileUrl.startsWith('https:') ? https : http;
            client.get(fileUrl, (proxyRes) => {
                if (proxyRes.statusCode !== 200) {
                    res.writeHead(502, corsHeaders(origin)); res.end(); return resolve();
                }
                res.writeHead(200, {
                    'Content-Type': 'audio/mpeg',
                    'Content-Disposition': `attachment; filename="${filename}"`,
                    'Cache-Control': 'public,max-age=86400',
                    ...corsHeaders(origin)
                });
                let sent = 0;
                const maxBytes = 480 * 1024;
                proxyRes.on('data', chunk => {
                    if (sent >= maxBytes) { proxyRes.destroy(); return; }
                    const slice = sent + chunk.length > maxBytes ? chunk.slice(0, maxBytes - sent) : chunk;
                    res.write(slice);
                    sent += slice.length;
                    if (sent >= maxBytes) { res.end(); proxyRes.destroy(); resolve(); }
                });
                proxyRes.on('end', () => { if (!res.writableEnded) res.end(); resolve(); });
                proxyRes.on('error', () => { if (!res.writableEnded) res.end(); resolve(); });
            }).on('error', () => { res.writeHead(502, corsHeaders(origin)); res.end(); resolve(); });
        });
    }

    // ── DOWNLOAD AD SETTINGS ───────────────────────────────
    if (method === 'GET' && pathname === '/api/settings/download-ad') {
        const result = await query("SELECT key, value FROM site_settings WHERE key LIKE 'download_ad_%'");
        const settings = result.rows.reduce((values, row) => {
            const key = row.key.replace('download_ad_', '');
            values[key] = row.value;
            return values;
        }, {});
        return J(200, {
            enabled: settings.enabled !== 'false',
            imageUrl: settings.imageUrl || settings.image_url || '',
            title: settings.title || '',
            message: settings.message || '',
            linkUrl: settings.linkUrl || settings.link_url || '',
            videoUrl: settings.videoUrl || settings.video_url || '',
            adType: settings.adType || settings.ad_type || 'image'
        });
    }
    if (method === 'POST' && pathname === '/api/admin/settings/download-ad-upload') {
        if (!user?.isAdmin) return J(403, { error: 'Admin only' });
        const { files } = await parseMultipart(req);
        const advert = files.advert;
        if (!advert?.data?.length) return J(400, { error: 'Advert image required' });
        if (!advert.mimetype.startsWith('image/')) return J(400, { error: 'Only image files are allowed' });
        if (advert.data.length > 5 * 1024 * 1024) return J(400, { error: 'Image too large. Max 5MB.' });
        const imageUrl = await r2Upload(advert, 'adverts');
        await query(`
            INSERT INTO site_settings (key, value, updated_at) VALUES ('download_ad_image_url', $1, NOW())
            ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()
        `, [imageUrl]);
        return J(200, { success: true, imageUrl });
    }
    if (method === 'PATCH' && pathname === '/api/admin/settings/download-ad') {
        if (!user?.isAdmin) return J(403, { error: 'Admin only' });
        const body = await parseJSON(req);
        const imageUrl = String(body.imageUrl || body.image_url || '').trim().substring(0, 2000);
        const linkUrl = String(body.linkUrl || body.link_url || '').trim().substring(0, 2000);
        const videoUrl = String(body.videoUrl || body.video_url || '').trim().substring(0, 2000);
        const adType = ['image', 'video'].includes(body.adType) ? body.adType : 'image';
        const values = {
            enabled: body.enabled === false ? 'false' : 'true',
            image_url: imageUrl, imageUrl,
            title: String(body.title || '').trim().substring(0, 120),
            message: String(body.message || '').trim().substring(0, 300),
            link_url: linkUrl, linkUrl,
            video_url: videoUrl, videoUrl,
            ad_type: adType, adType
        };
        for (const [key, value] of Object.entries(values)) {
            await query(`
                INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, NOW())
                ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()
            `, [`download_ad_${key}`, value]);
        }
        return J(200, { success: true, enabled: values.enabled, imageUrl, title: values.title, message: values.message, linkUrl });
    }

    // ── WEEKLY TOP 10 EMAIL ────────────────────────────────
    if (method === 'POST' && pathname === '/api/admin/send-weekly-email') {
        if (!user?.isAdmin) return J(403, { error: 'Admin only' });

        const top10 = await query(`
            SELECT s.id, s.title, s.artist, s.cover_path, s.cover_image, s.play_count, s.genre
            FROM songs s
            LEFT JOIN plays p ON s.id=p.song_id AND p.created_at > NOW() - INTERVAL '7 days'
            WHERE s.approved=TRUE
            GROUP BY s.id
            ORDER BY COUNT(p.id) DESC, s.play_count DESC LIMIT 10
        `);
        const songs10 = top10.rows;
        if (!songs10.length) return J(400, { error: 'No songs found' });

        const usersRes = await query(
            'SELECT email, username FROM users WHERE email IS NOT NULL ORDER BY created_at DESC LIMIT $1',
            [EMAIL_BATCH_LIMIT]
        );
        const allUsers = usersRes.rows;
        if (!allUsers.length) return J(400, { error: 'No users to email' });

        const toSlug = s => (s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').substring(0,60);
        const weekStr = new Date().toLocaleDateString('en-UG', { month: 'long', day: 'numeric', year: 'numeric' });

        const songRows = songs10.map((s, i) => {
            const songUrl = `${SITE_URL}/song/${toSlug(s.title)}/${toSlug(s.artist)}`;
            const rankEmoji = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'][i] || `${i+1}.`;
            return `<tr>
              <td style="padding:10px 8px;border-bottom:1px solid #1e293b;font-size:18px;width:36px;text-align:center">${rankEmoji}</td>
              <td style="padding:10px 8px;border-bottom:1px solid #1e293b">
                <a href="${songUrl}" style="color:#c084fc;font-weight:700;font-size:14px;text-decoration:none">${s.title}</a>
                <div style="color:#94a3b8;font-size:12px;margin-top:2px">${s.artist}</div>
              </td>
              <td style="padding:10px 8px;border-bottom:1px solid #1e293b;color:#64748b;font-size:12px;text-align:right">${(s.play_count||0).toLocaleString()} plays</td>
            </tr>`;
        }).join('');

        const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0a0e27;color:#e2e8f0;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#a855f7,#3b82f6);padding:28px;text-align:center">
            <div style="font-size:32px;margin-bottom:8px">🏆</div>
            <h1 style="margin:0;font-size:22px;font-weight:900;color:white">This Week's Top 10</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px">Week of ${weekStr} · DJ Musta Music</p>
          </div>
          <div style="padding:24px">
            <table style="width:100%;border-collapse:collapse">${songRows}</table>
            <div style="text-align:center;margin-top:24px">
              <a href="${SITE_URL}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#a855f7,#3b82f6);color:white;border-radius:50px;font-weight:700;font-size:14px;text-decoration:none">🎵 Listen on DJ Musta</a>
            </div>
          </div>
        </div>`;

        let sent = 0, failed = 0;
        for (const u of allUsers) {
            const ok = await sendEmail(u.email, `🏆 Top 10 Uganda Songs This Week — DJ Musta`, html);
            if (ok) sent++; else failed++;
            if (sent % 50 === 0) await new Promise(r => setTimeout(r, 12000));
        }
        return J(200, { success: true, sent, failed, total: allUsers.length });
    }

    // ── ARTIST SELF-UPLOAD ─────────────────────────────────
    if (method === 'POST' && pathname === '/api/songs/artist-upload') {
        if (!user) return J(401, { error: 'Please log in to upload your music' });
        if (uploadRateLimit(ip)) return J(429, { error: 'Too many uploads. Slow down.' });

        const todayUploads = await query(
            `SELECT COUNT(*) FROM songs WHERE uploaded_by=$1 AND created_at > NOW() - INTERVAL '24 hours'`,
            [user.id]
        );
        if (parseInt(todayUploads.rows[0].count) >= 10)
            return J(429, { error: 'Upload limit reached. Max 10 songs per day.' });

        const ct = req.headers['content-type'] || '';
        if (!ct.includes('multipart/form-data')) return J(400, { error: 'Multipart required' });
        const { fields, files } = await parseMultipart(req);

        const { title, artist, genre, duration, lyrics, video_url } = fields;
        const description = (fields.description || '').trim();
        const album = (fields.album || '').trim();
        const producer    = (fields.producer || '').trim();
        const releaseYear = fields.release_year ? parseInt(fields.release_year) : new Date().getFullYear();

        if (!title?.trim())  return J(400, { error: 'Song title is required' });
        if (!artist?.trim()) return J(400, { error: 'Artist name is required' });
        if (!files.song)     return J(400, { error: 'Audio file (MP3) is required' });

        const audioErr = validateFile(files.song, 'audio');
        if (audioErr) return J(400, { error: audioErr });
        if (files.cover) {
            const imgErr = validateFile(files.cover, 'image');
            if (imgErr) return J(400, { error: imgErr });
        }

        const cleanVideoUrl = (video_url || '').trim();
        if (cleanVideoUrl && !cleanVideoUrl.match(/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//)) {
            return J(400, { error: 'Video URL must be a valid YouTube link' });
        }

        let filePath, coverPath;
        const DEFAULT_COVER_URL = `${R2_PUBLIC_URL}/covers/default-cover.svg`;
        try {
            filePath  = await r2Upload(files.song, 'songs');
            coverPath = files.cover ? await r2Upload(files.cover, 'covers') : DEFAULT_COVER_URL;
        } catch(e) {
            return J(500, { error: 'File upload failed: ' + e.message });
        }

        const r = await query(
            `INSERT INTO songs (title,artist,genre,duration,lyrics,description,file_path,cover_path,uploaded_by,approved,producer,release_year,video_url,album)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,$10,$11,$12,$13) RETURNING id,title,artist`,
            [title.trim(), artist.trim(), genre||'Other', duration||'3:00',
             lyrics||'', description, filePath, coverPath, user.id, producer||null, releaseYear, cleanVideoUrl, album || null]
        );
        const newSong = r.rows[0];
        await query('INSERT INTO notifications (user_id,type,title,message) VALUES (1,$1,$2,$3)',
            ['new_upload', `🎵 New Artist Upload: ${newSong.title}`,
             `${newSong.artist} uploaded "${newSong.title}". Review in Admin → Pending.`]
        ).catch(()=>{});
        return J(201, {
            success: true,
            message: 'Song uploaded! It will go live after admin review.',
            song: newSong
        });
    }

    // ── OG META ────────────────────────────────────────────
    if (method === 'GET' && seg[0]==='songs' && seg[1]==='og' && seg[2]) {
        const r = await query('SELECT id,title,artist,cover_image,cover_path,genre,release_year,play_count FROM songs WHERE id=$1 AND approved=TRUE', [seg[2]]);
        if (!r.rows[0]) return J(404, { error:'Not found' });
        const s = r.rows[0];
        const cover = s.cover_image || s.cover_path || '';
        return JC(200, {
            id: s.id, title: s.title, artist: s.artist,
            cover: cover.startsWith('http') ? cover : cover ? `${SITE_URL}${cover}` : '',
            genre: s.genre, year: s.release_year, plays: s.play_count
        }, 3600);
    }

    // ── EMAIL VERIFY ───────────────────────────────────────
    if (method === 'GET' && seg[0]==='auth' && seg[1]==='verify' && seg[2]) {
        const verifyToken = seg[2];
        const r = await query('SELECT * FROM users WHERE verify_token=$1', [verifyToken]);
        if (!r.rows[0]) return J(400, { error: 'Invalid or expired verification link' });
        if (r.rows[0].verify_token_expiry && new Date(r.rows[0].verify_token_expiry) < new Date())
            return J(400, { error: 'Verification link has expired.' });
        await query('UPDATE users SET is_verified=TRUE, verify_token=NULL, verify_token_expiry=NULL WHERE id=$1', [r.rows[0].id]);
        return J(200, { success: true, message: 'Email verified successfully!' });
    }

    // ── DMCA ───────────────────────────────────────────────
    if (method === 'GET' && pathname === '/api/copyright/reports') {
        if (!user?.isAdmin) return J(403, { error: 'Admin only' });
        await query(`CREATE TABLE IF NOT EXISTS dmca_reports (
            id SERIAL PRIMARY KEY,
            song_id INTEGER REFERENCES songs(id) ON DELETE SET NULL,
            reporter_name TEXT NOT NULL,
            reporter_email TEXT NOT NULL,
            rights_description TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            admin_notes TEXT DEFAULT '',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            resolved_at TIMESTAMPTZ
        )`).catch(()=>{});
        const r = await query(`SELECT dr.*, s.title as song_title, s.artist as song_artist
            FROM dmca_reports dr LEFT JOIN songs s ON dr.song_id=s.id ORDER BY dr.created_at DESC`);
        return J(200, { reports: r.rows });
    }
    if (method === 'POST' && pathname === '/api/copyright/report') {
        await query(`CREATE TABLE IF NOT EXISTS dmca_reports (
            id SERIAL PRIMARY KEY,
            song_id INTEGER REFERENCES songs(id) ON DELETE SET NULL,
            reporter_name TEXT NOT NULL,
            reporter_email TEXT NOT NULL,
            rights_description TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            admin_notes TEXT DEFAULT '',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            resolved_at TIMESTAMPTZ
        )`).catch(()=>{});
        const body = await parseJSON(req);
        const { song_id, reporter_name, reporter_email, rights_description } = body;
        if (!reporter_name || !reporter_email || !rights_description)
            return J(400, { error: 'reporter_name, reporter_email, and rights_description are required' });
        const r = await query(
            `INSERT INTO dmca_reports (song_id, reporter_name, reporter_email, rights_description)
             VALUES ($1,$2,$3,$4) RETURNING *`,
            [song_id || null, reporter_name.trim(), reporter_email.trim(), rights_description.trim()]
        );
        await query('INSERT INTO notifications (user_id,type,title,message) VALUES (1,$1,$2,$3)',
            ['dmca', `🚨 DMCA Report - ${reporter_name}`,
             `New copyright report from ${reporter_email}.`]);
        return J(201, { success: true, report: r.rows[0] });
    }
    if (method === 'PATCH' && seg[0]==='copyright' && seg[1]==='reports' && seg[2]) {
        if (!user?.isAdmin) return J(403, { error: 'Admin only' });
        const { status, admin_notes, remove_song } = await parseJSON(req);
        await query(`UPDATE dmca_reports SET status=$1, admin_notes=$2, resolved_at=NOW() WHERE id=$3`,
            [status || 'resolved', admin_notes || '', seg[2]]);
        if (remove_song) {
            const rep = await query('SELECT song_id FROM dmca_reports WHERE id=$1', [seg[2]]);
            if (rep.rows[0]?.song_id) await query('DELETE FROM songs WHERE id=$1', [rep.rows[0].song_id]);
        }
        return J(200, { success: true });
    }

    J(404, { error:'Endpoint not found' });
}

// ============================================================
// START
// ============================================================
initDB().then(() => {
    server.listen(PORT, () => {
        console.log('\n==============================================');
        console.log('  DJ Musta Music Server');
        console.log('  http://localhost:' + PORT);
        console.log('==============================================\n');
    });
}).catch(e => {
    console.error('Failed to connect to database:', e.message);
    process.exit(1);
});
