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
const { URL } = require('url');
const { Pool } = require('pg');
const webpush = require('web-push');

// ============================================================
// WEB PUSH VAPID SETUP
// Generate keys once with: npx web-push generate-vapid-keys
// Then set them as environment variables on Render
// ============================================================
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BAonU5h2RMD7db5Zl3gGS_01GfXP0_tevIWydLGXvX4JTJOWpkku-ag-be63rkPoGCs9CSka6y--ktyq-kJvYxw';
// SECURITY: VAPID_PRIVATE_KEY must be set as an environment variable — no fallback.
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL   = process.env.VAPID_EMAIL       || 'mailto:musitafahkenny288227@gmail.com';

try {
    if (VAPID_PRIVATE) {
        webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
        console.log('[Push] VAPID keys configured');
    } else {
        console.warn('[Push] VAPID_PRIVATE_KEY not set — push notifications disabled. Set it as an env var on Render.');
    }
} catch(e) {
    console.warn('[Push] VAPID setup failed - push notifications disabled:', e.message);
}

// ============================================================
// EMAIL SETUP (Brevo / Sendinblue)
// ============================================================
const EMAIL_USER = process.env.EMAIL_USER || 'musitafahkenny288227@gmail.com';
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const SITE_URL   = process.env.SITE_URL   || 'https://djmusta.com';

async function sendEmail(to, subject, html) {
    return new Promise((resolve, reject) => {
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
                    console.log('[Email] Sent to:', to, '| Subject:', subject);
                    resolve();
                } else {
                    console.error('[Email] Failed:', res.statusCode, data);
                    resolve(); // Don't reject - email failure shouldn't crash the request
                }
            });
        });
        req.on('error', e => { console.error('[Email] Error:', e.message); resolve(); });
        req.write(body);
        req.end();
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

// Validate required environment variables on startup
const REQUIRED_ENV = ['JWT_SECRET', 'DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY', 'R2_SECRET_KEY'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
    console.error('❌ MISSING REQUIRED ENV VARS:', missingEnv.join(', '));
    console.error('Set these in Render → Environment → Add Environment Variable');
    process.exit(1);
}

// ============================================================
// SITEMAP UPDATER
// ============================================================
const { updateSitemap, pingSearchEngines } = require('./update-sitemap.js');

// ============================================================
// DATABASE SETUP - Verification Requests Table
// ============================================================
async function setupVerificationTable() {
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS verification_requests (
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
            )
        `);
        console.log('âœ… Verification requests table ready');
    } catch (err) {
        console.error('âš ï¸ Verification table setup error:', err.message);
    }
}
// setupVerificationTable(); // Table already created manually

// Warn if using default JWT secret in production
if (JWT_SECRET === 'djmusta_secret_2026' && process.env.NODE_ENV === 'production') {
    console.warn('âš ï¸  WARNING: Using default JWT_SECRET in production. Set JWT_SECRET env var!');
}

// ============================================================
// RATE LIMITER (in-memory, per IP)
// ============================================================
const rateLimits = new Map();

function rateLimit(ip, max = 60, windowMs = 60000) {
    const now  = Date.now();
    const data = rateLimits.get(ip) || { count: 0, start: now };
    if (now - data.start > windowMs) {
        data.count = 0;
        data.start = now;
    }
    data.count++;
    rateLimits.set(ip, data);
    return data.count > max;
}

// Clean up rate limit map every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of rateLimits.entries()) {
        if (now - data.start > 60000) rateLimits.delete(ip);
    }
}, 300000);

// Stricter limit for auth endpoints
function authRateLimit(ip) { return rateLimit(ip + ':auth', 10, 60000); }

// ============================================================
// FILE TYPE VALIDATION — Magic Byte + Extension + MIME
// ============================================================

// Strictly blocked dangerous extensions — reject immediately regardless of MIME
const BLOCKED_EXTENSIONS = new Set([
    '.exe','.bat','.cmd','.com','.sh','.bash','.zsh','.fish',
    '.ps1','.psm1','.psd1','.vbs','.vbe','.js','.jse','.wsf',
    '.wsh','.msi','.msp','.scr','.hta','.cpl','.dll','.so',
    '.php','.php3','.php4','.php5','.phtml','.asp','.aspx',
    '.jsp','.cfm','.pl','.py','.rb','.lua','.jar','.class',
    '.elf','.bin','.run','.deb','.rpm','.apk','.dmg','.iso'
]);

// Allowed MIME types
const ALLOWED_AUDIO_MIME = new Set([
    'audio/mpeg','audio/mp3','audio/wav','audio/wave',
    'audio/x-wav','audio/mp4','audio/m4a','audio/x-m4a'
]);
const ALLOWED_IMAGE_MIME = new Set([
    'image/jpeg','image/jpg','image/png','image/webp','image/gif'
]);

// Allowed extensions
const ALLOWED_AUDIO_EXT = new Set(['.mp3','.wav','.m4a']);
const ALLOWED_IMAGE_EXT = new Set(['.jpg','.jpeg','.png','.webp','.gif']);

// Magic bytes — actual file signatures read from binary content
function getMagicType(buf) {
    if (!buf || buf.length < 4) return null;

    // MP3: ID3 tag or MPEG sync
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'mp3'; // ID3
    if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return 'mp3';           // MPEG sync

    // WAV: RIFF....WAVE
    if (buf[0]===0x52 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x46 &&
        buf[8]===0x57 && buf[9]===0x41 && buf[10]===0x56 && buf[11]===0x45) return 'wav';

    // M4A / MP4: ftyp box
    if (buf[4]===0x66 && buf[5]===0x74 && buf[6]===0x79 && buf[7]===0x70) return 'm4a';

    // JPEG: FF D8 FF
    if (buf[0]===0xFF && buf[1]===0xD8 && buf[2]===0xFF) return 'jpeg';

    // PNG: 89 50 4E 47
    if (buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47) return 'png';

    // GIF: GIF87a or GIF89a
    if (buf[0]===0x47 && buf[1]===0x49 && buf[2]===0x46) return 'gif';

    // WEBP: RIFF....WEBP
    if (buf[0]===0x52 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x46 &&
        buf[8]===0x57 && buf[9]===0x45 && buf[10]===0x42 && buf[11]===0x50) return 'webp';

    // EXE / DLL: MZ header
    if (buf[0]===0x4D && buf[1]===0x5A) return 'exe';

    // ELF (Linux binary)
    if (buf[0]===0x7F && buf[1]===0x45 && buf[2]===0x4C && buf[3]===0x46) return 'elf';

    // ZIP / JAR / APK (PK header)
    if (buf[0]===0x50 && buf[1]===0x4B) return 'zip';

    // PDF
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
    const buf  = fileObj.data; // Buffer

    // 1. Block dangerous extensions immediately
    if (BLOCKED_EXTENSIONS.has(ext)) {
        console.warn(`[Security] Blocked dangerous extension: ${ext} from file: ${fileObj.filename}`);
        return `File type not allowed. Extension "${ext}" is blocked for security reasons.`;
    }

    // 2. Check magic bytes (actual file content)
    const magic = getMagicType(buf);

    // Block known malware signatures regardless of claimed type
    if (DANGEROUS_MAGIC.has(magic)) {
        console.warn(`[Security] Blocked malicious file content (magic: ${magic}) from: ${fileObj.filename}`);
        return 'File content detected as malicious. Upload rejected.';
    }

    if (type === 'audio') {
        // 3. Extension must be allowed
        if (!ALLOWED_AUDIO_EXT.has(ext))
            return `Invalid audio extension "${ext}". Only .mp3 and .wav allowed.`;

        // 4. MIME type must be allowed
        if (!ALLOWED_AUDIO_MIME.has(mime))
            return `Invalid audio type "${mime}". Only MP3 and WAV allowed.`;

        // 5. Magic bytes must match audio
        if (!AUDIO_MAGIC.has(magic))
            return `File content does not match an audio file. Upload rejected.`;

    } else if (type === 'image') {
        // 3. Extension must be allowed
        if (!ALLOWED_IMAGE_EXT.has(ext))
            return `Invalid image extension "${ext}". Only .jpg, .png, .webp allowed.`;

        // 4. MIME type must be allowed
        if (!ALLOWED_IMAGE_MIME.has(mime))
            return `Invalid image type "${mime}". Only JPG, PNG, WEBP, GIF allowed.`;

        // 5. Magic bytes must match image
        if (!IMAGE_MAGIC.has(magic))
            return `File content does not match an image. Upload rejected.`;
    }

    // 6. File size check: audio max 50MB, image max 5MB
    const maxSize = type === 'audio' ? 50 * 1024 * 1024 : 5 * 1024 * 1024;
    if (buf.length > maxSize)
        return `File too large. Max ${type === 'audio' ? '50MB' : '5MB'}.`;

    return null; // All checks passed
}


// ============================================================
// DATABASE
// ============================================================
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 5
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

// Keep Neon DB alive - ping every 4 minutes
setInterval(async () => {
    try { await query('SELECT 1'); } catch(e) { console.log('[DB Keep-alive] ping failed:', e.message); }
}, 4 * 60 * 1000);

// Keep Render server awake - self ping every 10 minutes
setInterval(() => {
    const url = process.env.RENDER_EXTERNAL_URL || 'https://mustabackend-nenb.onrender.com';
    https.get(url + '/api/health', (res) => {
        console.log('[Server Keep-alive] ping:', res.statusCode);
    }).on('error', () => {});
}, 10 * 60 * 1000);

// ============================================================
// INIT DATABASE TABLES
// ============================================================
async function initDB() {
    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id         SERIAL PRIMARY KEY,
            username   TEXT UNIQUE NOT NULL,
            email      TEXT UNIQUE NOT NULL,
            password   TEXT NOT NULL,
            is_admin   BOOLEAN DEFAULT FALSE,
            profile_photo TEXT,
            reset_token TEXT,
            reset_token_expiry TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await query(`
        CREATE TABLE IF NOT EXISTS songs (
            id             SERIAL PRIMARY KEY,
            title          TEXT NOT NULL,
            artist         TEXT NOT NULL,
            genre          TEXT DEFAULT 'Other',
            duration       TEXT DEFAULT '3:00',
            lyrics         TEXT DEFAULT '',
            file_path      TEXT NOT NULL,
            cover_path     TEXT,
            uploaded_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
            play_count     INTEGER DEFAULT 0,
            download_count INTEGER DEFAULT 0,
            like_count     INTEGER DEFAULT 0,
            approved       BOOLEAN DEFAULT FALSE,
            created_at     TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await query(`
        CREATE TABLE IF NOT EXISTS likes (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            song_id    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, song_id)
        )
    `);
    await query(`
        CREATE TABLE IF NOT EXISTS plays (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
            song_id    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
            ip         TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await query(`
        CREATE TABLE IF NOT EXISTS downloads (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
            song_id    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
            ip         TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // Playlists feature
    await query(`
        CREATE TABLE IF NOT EXISTS playlists (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            description TEXT DEFAULT '',
            cover_url   TEXT,
            is_public   BOOLEAN DEFAULT TRUE,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await query(`
        CREATE TABLE IF NOT EXISTS playlist_songs (
            id          SERIAL PRIMARY KEY,
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
            position    INTEGER DEFAULT 0,
            added_at    TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(playlist_id, song_id)
        )
    `);

    // Artist profiles
    await query(`
        CREATE TABLE IF NOT EXISTS artists (
            id          SERIAL PRIMARY KEY,
            name        TEXT UNIQUE NOT NULL,
            bio         TEXT DEFAULT '',
            photo_url   TEXT,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // Recently played history (already tracking in plays table)
    // We'll use the existing 'plays' table for history

    // Comments table
    await query(`
        CREATE TABLE IF NOT EXISTS comments (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
            comment     TEXT NOT NULL,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // Following system
    await query(`
        CREATE TABLE IF NOT EXISTS follows (
            id          SERIAL PRIMARY KEY,
            follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            artist_name TEXT NOT NULL,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(follower_id, artist_name)
        )
    `);

    // Notifications table
    await query(`
        CREATE TABLE IF NOT EXISTS notifications (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type        TEXT NOT NULL,
            title       TEXT NOT NULL,
            message     TEXT NOT NULL,
            link        TEXT,
            is_read     BOOLEAN DEFAULT FALSE,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // Push notification subscriptions table
    await query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id          SERIAL PRIMARY KEY,
            endpoint    TEXT UNIQUE NOT NULL,
            p256dh      TEXT NOT NULL,
            auth        TEXT NOT NULL,
            user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
            user_agent  TEXT,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // Add social links to artists table if not exists
    const artistCols = await query(`SELECT column_name FROM information_schema.columns WHERE table_name='artists'`);
    const hasInstagram = artistCols.rows.some(r => r.column_name === 'instagram');
    if (!hasInstagram) {
        await query(`ALTER TABLE artists ADD COLUMN IF NOT EXISTS instagram TEXT DEFAULT ''`);
        await query(`ALTER TABLE artists ADD COLUMN IF NOT EXISTS twitter TEXT DEFAULT ''`);
        await query(`ALTER TABLE artists ADD COLUMN IF NOT EXISTS facebook TEXT DEFAULT ''`);
    }

    // Add year column to songs if not exists
    const songCols = await query(`SELECT column_name FROM information_schema.columns WHERE table_name='songs'`);
    const hasYear = songCols.rows.some(r => r.column_name === 'release_year');
    if (!hasYear) {
        await query(`ALTER TABLE songs ADD COLUMN IF NOT EXISTS release_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())`);
    }

    // Seed admin - ensure musitafahkenny288227@gmail.com is admin
    // SECURITY: Use ADMIN_SEED_PASSWORD env var. Fallback only used on first-run
    // when no env var is set; set ADMIN_SEED_PASSWORD in Render environment variables.
    const adminSeedPassword = process.env.ADMIN_SEED_PASSWORD;
    if (!adminSeedPassword) {
        console.warn('⚠️  ADMIN_SEED_PASSWORD env var not set — admin password seeding skipped. Set it on Render to seed the admin account.');
    } else {
        const hashed = hashPassword(adminSeedPassword);
    
        // First, update existing user if exists
        const existing = await query('SELECT id FROM users WHERE email=$1', ['musitafahkenny288227@gmail.com']);
        if (existing.rows.length > 0) {
            await query(
                'UPDATE users SET username=$1, password=$2, is_admin=TRUE WHERE email=$3',
                ['MUSTA', hashed, 'musitafahkenny288227@gmail.com']
            );
            console.log('✅ Admin updated: musitafahkenny288227@gmail.com (is_admin=TRUE)');
        } else {
            // Insert new admin
            await query(
                'INSERT INTO users (username, email, password, is_admin) VALUES ($1,$2,$3,TRUE)',
                ['MUSTA', 'musitafahkenny288227@gmail.com', hashed]
            );
            console.log('✅ Admin created: musitafahkenny288227@gmail.com (is_admin=TRUE)');
        }
    }

    // Add missing columns to existing tables
    try {
        await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo TEXT');
        await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT');
        await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMPTZ');
        await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE');
        await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token TEXT');
        await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token_expiry TIMESTAMPTZ');
        await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE');
        await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ');
        await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_since TIMESTAMPTZ');
        await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_note TEXT');
        await query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE');
        console.log('✅ User columns updated');
    } catch(e) {
        console.log('⚠️ Column update skipped');
    }

    console.log('✅ Database ready');
}

// ============================================================
// ENSURE UPLOAD DIRS
// ============================================================
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
        return attempt === hash;
    } catch { return false; }
}

// ============================================================
// JWT
// ============================================================
function b64url(str) {
    return Buffer.from(str).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function b64decode(str) {
    return Buffer.from(str.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8');
}
function signJWT(payload) {
    const header = b64url(JSON.stringify({ alg:'HS256', typ:'JWT' }));
    const body   = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 60*60*24*7 }));
    const sig    = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    return `${header}.${body}.${sig}`;
}
function verifyJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
        if (expected !== parts[2]) return null;
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
const ALLOWED_ORIGINS = [
    'https://djmusta.com',
    'https://www.djmusta.com',
    'https://djmusta.pages.dev',
    'https://main.djmusta.pages.dev',
    'https://weathered-cherry-0a9e.musitafahkenny288227.workers.dev',
    FRONTEND_URL,
    'http://localhost:5000',
    'http://localhost:3000'
].filter(Boolean);

// Allow all *.djmusta.pages.dev preview URLs
function isAllowedOrigin(origin) {
    if (!origin) return false;
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    // Allow all Cloudflare Pages preview deployments
    if (origin.match(/^https:\/\/[a-z0-9]+\.djmusta\.pages\.dev$/)) return true;
    return false;
}

function corsHeaders(origin) {
    // TEMPORARY FIX: Allow all origins for debugging
    return {
        'Access-Control-Allow-Origin':      '*',
        'Access-Control-Allow-Headers':     'Content-Type, Authorization',
        'Access-Control-Allow-Methods':     'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': 'false',
        'Vary': 'Origin'
    };
}

// ============================================================
// HTTP HELPERS
// ============================================================
function jsonRes(res, status, data, origin) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        ...corsHeaders(origin),
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let finished = false;
        req.on('data', c => chunks.push(c));
        req.on('end', () => { finished = true; resolve(Buffer.concat(chunks)); });
        req.on('error', reject);
        // Timeout only if stream never finishes (stalled connection)
        setTimeout(() => {
            if (!finished) reject(new Error('Request body timeout'));
        }, 120000);
    });
}

function parseJSON(req) {
    return readBody(req).then(buf => {
        try { return JSON.parse(buf.toString()); } catch { return {}; }
    });
}

// ============================================================
// MULTIPART PARSER
// ============================================================
function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const ct = req.headers['content-type'] || '';
        const bm = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
        if (!bm) return reject(new Error('No boundary'));
        const boundary = '--' + (bm[1] || bm[2]);

        readBody(req).then(buf => {
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
                const dataEnd = nextBound === -1 ? buf.length : nextBound - 2;
                const partData = buf.slice(pos, dataEnd);
                pos = nextBound === -1 ? buf.length : nextBound;
                const nameMatch = headStr.match(/Content-Disposition:[^\r\n]*;\s*name="([^"]+)"/i);
                const fileMatch = headStr.match(/filename="([^"]*)"/i);
                const mimeMatch = headStr.match(/Content-Type:\s*([^\r\n]+)/i);
                if (!nameMatch) continue;
                const fieldName = nameMatch[1];
                if (fileMatch && fileMatch[1]) {
                    files[fieldName] = { filename: fileMatch[1], mimetype: mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream', data: partData };
                } else if (mimeMatch) {
                    // Blob with no filename but has Content-Type — treat as file
                    files[fieldName] = { filename: fieldName + '.bin', mimetype: mimeMatch[1].trim(), data: partData };
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
            headers: { 'Content-Type': mime, 'Content-Length': body.length, 'x-amz-date': timeStamp, 'x-amz-content-sha256': bodyHash, 'Authorization': authorization }
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
// STATIC FILE SERVER
// ============================================================
const MIME = {
    '.html':'text/html','.css':'text/css','.js':'application/javascript',
    '.json':'application/json','.mp3':'audio/mpeg','.wav':'audio/wav',
    '.m4a':'audio/mp4','.jpg':'image/jpeg','.jpeg':'image/jpeg',
    '.png':'image/png','.webp':'image/webp','.gif':'image/gif',
    '.ico':'image/x-icon','.svg':'image/svg+xml','.txt':'text/plain'
};

function serveStatic(req, res, filePath, origin) {
    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            const index = path.join(__dirname, '..', 'index.html');
            fs.readFile(index, (e2, data) => {
                if (e2) { res.writeHead(404); res.end('Not found'); return; }
                res.writeHead(200, { 'Content-Type':'text/html', ...corsHeaders(origin) });
                res.end(data);
            });
            return;
        }
        const ext  = path.extname(filePath).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        const isAudio = mime.startsWith('audio/');
        if (isAudio && req.headers.range) {
            const total = stat.size;
            const [s, e] = req.headers.range.replace(/bytes=/,'').split('-');
            const start = parseInt(s, 10);
            const end   = e ? parseInt(e,10) : Math.min(start + 1024*1024 - 1, total - 1);
            res.writeHead(206, { 'Content-Range':`bytes ${start}-${end}/${total}`, 'Accept-Ranges':'bytes', 'Content-Length':end-start+1, 'Content-Type':mime });
            fs.createReadStream(filePath, { start, end }).pipe(res);
            return;
        }
        res.writeHead(200, { 'Content-Type':mime, 'Content-Length':stat.size, 'Accept-Ranges':'bytes', 'Cache-Control': isAudio ? 'public,max-age=3600' : 'no-cache', ...corsHeaders(origin) });
        fs.createReadStream(filePath).pipe(res);
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
    const ip       = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(origin));
        return res.end();
    }

    // Rate limiting â€” 60 requests per minute per IP
    if (rateLimit(ip)) {
        return jsonRes(res, 429, { error: 'Too many requests. Please slow down.' }, origin);
    }

    if (pathname.startsWith('/api/')) {
        try {
            await handleAPI(req, res, pathname, method, parsed, ip, origin);
        } catch(e) {
            console.error('[API Error]', e);
            jsonRes(res, 500, { error: 'Internal server error' }, origin);
        }
        return;
    }

    // Direct health check endpoint
    if (pathname === '/health') {
        return jsonRes(res, 200, { status:'ok', uptime: process.uptime() }, origin);
    }

    if (pathname.startsWith('/uploads/')) {
        return serveStatic(req, res, path.join(__dirname, pathname), origin);
    }

    // Dynamic sitemap.xml
    if (pathname === '/sitemap.xml') {
        try {
            const songs = await query('SELECT id, title, artist, genre, cover_image, cover_path, created_at FROM songs WHERE approved=TRUE ORDER BY created_at DESC');
            const toSlug = str => str.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').substring(0,60);

            // Group: homepage + static pages + all songs
            const staticPages = [
                { loc: 'https://djmusta.com',              changefreq: 'daily',   priority: '1.0' },
                { loc: 'https://djmusta.com/new-music',    changefreq: 'daily',   priority: '0.9' },
                { loc: 'https://djmusta.com/top-songs',    changefreq: 'daily',   priority: '0.9' },
                { loc: 'https://djmusta.com/top-artists',  changefreq: 'weekly',  priority: '0.8' },
                { loc: 'https://djmusta.com/gospel',       changefreq: 'weekly',  priority: '0.8' },
                { loc: 'https://djmusta.com/nonstops',     changefreq: 'weekly',  priority: '0.8' },
            ];

            const today = new Date().toISOString().split('T')[0];

            const staticUrls = staticPages.map(p => `  <url>
    <loc>${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n');

            const songUrls = songs.rows.map(s => {
                const titleSlug  = toSlug(s.title);
                const artistSlug = toSlug(s.artist);
                const songUrl    = `https://djmusta.com/song/${titleSlug}/${artistSlug}`;
                const lastmod    = s.created_at ? new Date(s.created_at).toISOString().split('T')[0] : today;
                const esc        = str => (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
                const coverUrl   = s.cover_image || s.cover_path || '';
                const imageTag   = coverUrl ? `
    <image:image>
      <image:loc>${esc(coverUrl.startsWith('http') ? coverUrl : 'https://djmusta.com' + coverUrl)}</image:loc>
      <image:title>${esc(s.title)} by ${esc(s.artist)}</image:title>
      <image:caption>${esc(s.genre || 'Ugandan Music')} — ${esc(s.title)} by ${esc(s.artist)} on DJ Musta</image:caption>
    </image:image>` : '';
                return `  <url>
    <loc>${songUrl}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>${imageTag}
  </url>`;
            }).join('\n');

            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
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
async function handleAPI(req, res, pathname, method, parsed, ip, origin) {
    const seg  = pathname.replace('/api/','').split('/');
    const user = getUser(req);
    const J    = (status, data) => jsonRes(res, status, data, origin);

    // â”€â”€ GET /api/health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (pathname === '/api/health') return J(200, { status:'ok', uptime: process.uptime() });

    // â”€â”€ POST /api/auth/register â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // POST /api/auth/register - DISABLED (Google only)
    if (method === 'POST' && pathname === '/api/auth/register') {
        return J(403, { error:'Registration is only allowed via Google. Please use Google Sign-In.' });
    }

    // POST /api/auth/login - DISABLED (Google only)
    if (method === 'POST' && pathname === '/api/auth/login') {
        return J(403, { error:'Login is only allowed via Google. Please use Google Sign-In.' });
    }

    // â”€â”€ GET /api/auth/me â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (method === 'GET' && pathname === '/api/auth/me') {
        if (!user) return J(401, { error:'Unauthorized' });
        const r = await query('SELECT * FROM users WHERE id=$1', [user.id]);
        if (!r.rows[0]) return J(404, { error:'User not found' });
        return J(200, pub(r.rows[0]));
    }

    // â”€â”€ POST /api/auth/change-password â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        await query('UPDATE users SET password=$1 WHERE id=$2', [hashPassword(newPassword), user.id]);
        return J(200, { success:true, message:'Password changed successfully' });
    }


    // POST /api/auth/google - Google OAuth Login/Register
    if (method === 'POST' && pathname === '/api/auth/google') {
        const body = await parseJSON(req);
        const idToken = body.idToken;
        const photoUrl = body.photoUrl || null;

        if (!idToken) return J(400, { error:'ID token required' });

        // Verify the Firebase ID token with Google
        let email, username, googleUid;
        try {
            // Fetch Google public keys
            const keysRes = await new Promise((resolve, reject) => {
                https.get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', res => {
                    let data = '';
                    res.on('data', c => data += c);
                    res.on('end', () => resolve(JSON.parse(data)));
                }).on('error', reject);
            });

            // Decode token header to get kid
            const parts = idToken.split('.');
            if (parts.length !== 3) throw new Error('Invalid token format');
            const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

            // Validate claims
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp < now) throw new Error('Token expired');
            if (payload.aud !== 'dj-musta-music') throw new Error('Invalid audience');
            if (payload.iss !== 'https://securetoken.google.com/dj-musta-music') throw new Error('Invalid issuer');
            if (!payload.email_verified) throw new Error('Email not verified with Google');

            // Verify signature using the correct public key
            const certPem = keysRes[header.kid];
            if (!certPem) throw new Error('Unknown key ID');

            const verifier = crypto.createVerify('SHA256');
            verifier.update(parts[0] + '.' + parts[1]);
            const valid = verifier.verify(certPem, parts[2].replace(/-/g,'+').replace(/_/g,'/'), 'base64');
            if (!valid) throw new Error('Invalid token signature');

            email = payload.email;
            username = payload.name || payload.email.split('@')[0];
            googleUid = payload.sub;

        } catch(e) {
            console.error('[Google Auth] Token verification failed:', e.message);
            return J(401, { error: 'Invalid Google token: ' + e.message });
        }

        // Token is valid - login or register
        let existingUser = await query('SELECT * FROM users WHERE email=$1', [email]);
        if (existingUser.rows.length) {
            const u = existingUser.rows[0];
            if (photoUrl && !u.profile_photo) {
                await query('UPDATE users SET profile_photo=$1 WHERE id=$2', [photoUrl, u.id]);
                u.profile_photo = photoUrl;
            }
            const tkn = signJWT({ id:u.id, username:u.username, email:u.email, isAdmin:!!u.is_admin });
            return J(200, { token:tkn, user:pub(u) });
        } else {
            const randomPass = crypto.randomBytes(16).toString('hex');
            const r = await query(
                'INSERT INTO users (username,email,password,is_verified,profile_photo) VALUES ($1,$2,$3,TRUE,$4) RETURNING *',
                [username, email, hashPassword(randomPass), photoUrl]
            );
            const u = r.rows[0];
            const tkn = signJWT({ id:u.id, username:u.username, email:u.email, isAdmin:false });
            return J(201, { token:tkn, user:pub(u) });
        }
    }
    // â”€â”€ GET /api/stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // POST /api/auth/forgot-password - Request password reset
    if (method === 'POST' && pathname === '/api/auth/forgot-password') {
        const body = await parseJSON(req);
        const email = body.email;
        if (!email) return J(400, { error:'Email required' });
        const userRow = await query('SELECT * FROM users WHERE email=$1', [email]);
        if (!userRow.rows.length) return J(200, { success:true, message:'If that email exists, a reset link was sent.' });
        
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpiry = new Date(Date.now() + 3600000); // 1 hour
        await query('UPDATE users SET reset_token=$1, reset_token_expiry=$2 WHERE email=$3', [resetToken, resetExpiry, email]);

        const resetLink = `${SITE_URL}?reset=${resetToken}`;
        sendEmail(email, '🔑 Reset Your DJ Musta Password', `
            <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0a0e27;color:#e2e8f0;padding:30px;border-radius:12px">
                <h2 style="color:#a855f7">🔑 Password Reset Request</h2>
                <p>We received a request to reset your password for DJ Musta Music.</p>
                <a href="${resetLink}" style="display:inline-block;margin:20px 0;padding:14px 28px;background:#a855f7;color:white;border-radius:8px;text-decoration:none;font-weight:700">Reset My Password</a>
                <p style="color:#94a3b8;font-size:13px">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
            </div>`
        );
        return J(200, { success:true, message:'Password reset link sent to your email!' });
    }

    // POST /api/auth/reset-password - Actually reset password using token
    if (method === 'POST' && pathname === '/api/auth/reset-password') {
        const { token: resetToken, password: newPassword } = await parseJSON(req);
        if (!resetToken || !newPassword) return J(400, { error:'Token and new password required' });
        if (newPassword.length < 6) return J(400, { error:'Password must be at least 6 characters' });
        const r = await query('SELECT * FROM users WHERE reset_token=$1', [resetToken]);
        if (!r.rows[0]) return J(400, { error:'Invalid or expired reset link' });
        if (new Date(r.rows[0].reset_token_expiry) < new Date()) return J(400, { error:'Reset link has expired. Please request a new one.' });
        await query('UPDATE users SET password=$1, reset_token=NULL, reset_token_expiry=NULL WHERE id=$2', [hashPassword(newPassword), r.rows[0].id]);
        return J(200, { success:true, message:'Password reset successfully! You can now login.' });
    }
    if (method === 'GET' && pathname === '/api/stats') {
        const songs     = await query('SELECT COUNT(*) FROM songs WHERE approved=TRUE');
        const artists   = await query('SELECT COUNT(DISTINCT artist) FROM songs WHERE approved=TRUE');
        const plays     = await query('SELECT COALESCE(SUM(play_count),0) FROM songs WHERE approved=TRUE');
        const downloads = await query('SELECT COALESCE(SUM(download_count),0) FROM songs WHERE approved=TRUE');
        const likes     = await query('SELECT COALESCE(SUM(like_count),0) FROM songs WHERE approved=TRUE');
        const users     = await query('SELECT COUNT(*) FROM users');
        const pending   = await query('SELECT COUNT(*) FROM songs WHERE approved=FALSE');
        return J(200, {
            songs:     parseInt(songs.rows[0].count),
            artists:   parseInt(artists.rows[0].count),
            plays:     parseInt(plays.rows[0].coalesce),
            downloads: parseInt(downloads.rows[0].coalesce),
            likes:     parseInt(likes.rows[0].coalesce),
            users:     parseInt(users.rows[0].count),
            pending:   parseInt(pending.rows[0].count)
        });
    }

    // â”€â”€ GET /api/songs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (method === 'GET' && pathname === '/api/songs') {
        const q        = parsed.searchParams;
        const category = q.get('category') || 'all';
        const search   = q.get('search') || '';
        const genre    = q.get('genre') || '';
        const uploader = q.get('uploader') || '';
        const limit    = Math.min(parseInt(q.get('limit') || 20), 100);
        const offset   = parseInt(q.get('offset') || 0);

        let where  = 'WHERE approved=TRUE';
        let params = [];
        let idx    = 1;

        if (search) {
            where += ` AND (LOWER(title) LIKE $${idx} OR LOWER(artist) LIKE $${idx+1})`;
            params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
            idx += 2;
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

        const orderMap = { new:'created_at DESC', trending:'play_count DESC', top:'like_count DESC' };
        const order = orderMap[category] || 'created_at DESC';

        // Count query â€” no ORDER BY
        const total = await query(`SELECT COUNT(*) FROM songs ${where}`, params);

        // Data query â€” with ORDER BY, LIMIT, OFFSET
        const dataParams = [...params, limit, offset];
        const songs = await query(
            `SELECT s.*, COALESCE(vr.status,'none') as uploader_verified FROM songs s LEFT JOIN verification_requests vr ON vr.user_id=s.uploaded_by AND vr.status='approved' WHERE ${where.replace("WHERE ","")} ORDER BY ${order} LIMIT $${idx} OFFSET $${idx+1}`,
            dataParams
        );

        const likedIds = user ? (await query('SELECT song_id FROM likes WHERE user_id=$1', [user.id])).rows.map(r => r.song_id) : [];

        return J(200, {
            songs: songs.rows.map(s => ({ ...s, liked: likedIds.includes(s.id) })),
            total: parseInt(total.rows[0].count),
            offset, limit
        });
    }

    // â”€â”€ GET /api/songs/admin/pending â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (method === 'GET' && pathname === '/api/songs/admin/pending') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const r = await query(`SELECT s.*, u.username AS uploader_name FROM songs s LEFT JOIN users u ON s.uploaded_by=u.id WHERE s.approved=FALSE ORDER BY s.created_at DESC`);
        return J(200, { songs: r.rows });
    }

    // â”€â”€ GET /api/songs/admin/users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (method === 'GET' && pathname === '/api/songs/admin/users') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const r = await query('SELECT id,username,email,is_admin,is_premium,is_verified,profile_photo,last_login,created_at FROM users ORDER BY COALESCE(last_login,created_at) DESC');
        return J(200, { users: r.rows.map(pub) });
    }

    // â”€â”€ GET /api/songs/likes/mine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (method === 'GET' && pathname === '/api/songs/likes/mine') {
        if (!user) return J(401, { error:'Unauthorized' });
        const r = await query(`SELECT s.* FROM songs s INNER JOIN likes l ON l.song_id=s.id WHERE l.user_id=$1 AND s.approved=TRUE ORDER BY l.created_at DESC`, [user.id]);
        return J(200, { songs: r.rows.map(s => ({ ...s, liked: true })) });
    }

    // â”€â”€ GET /api/songs/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (method === 'GET' && seg[0]==='songs' && seg[1] && !isNaN(seg[1]) && !seg[2]) {
        const r = await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Song not found' });
        const song = r.rows[0];
        await query('UPDATE songs SET play_count=play_count+1 WHERE id=$1', [song.id]);
        await query('INSERT INTO plays (user_id,song_id,ip) VALUES ($1,$2,$3)', [user?.id||null, song.id, ip]);
        return J(200, { ...song, play_count: song.play_count + 1 });
    }

    // POST /api/songs/:id/play - Track play (for frontend player)
    if (method === 'POST' && seg[0]==='songs' && seg[1] && seg[2]==='play' && !seg[3]) {
        const r = await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Song not found' });
        const song = r.rows[0];
        await query('UPDATE songs SET play_count=play_count+1 WHERE id=$1', [song.id]);
        await query('INSERT INTO plays (user_id,song_id,ip) VALUES ($1,$2,$3)', [user?.id||null, song.id, ip]);
        return J(200, { success: true, play_count: song.play_count + 1 });
    }

    // â”€â”€ POST /api/songs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (method === 'POST' && pathname === '/api/songs') {
        if (!user) return J(401, { error:'Login required' });
        const ct = req.headers['content-type'] || '';
        if (!ct.includes('multipart/form-data')) return J(400, { error:'Multipart required' });
        const { fields, files } = await parseMultipart(req);
        const { title, artist, genre, duration, lyrics } = fields;
        if (!title?.trim())  return J(400, { error:'Title required' });
        if (!artist?.trim()) return J(400, { error:'Artist required' });
        if (!files.song)     return J(400, { error:'Audio file required' });

        // Validate file types
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
            return J(500, { error: 'File upload failed: ' + e.message + '. Please check R2 configuration.' });
        }

        const r = await query(
            'INSERT INTO songs (title,artist,genre,duration,lyrics,file_path,cover_path,uploaded_by,approved) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
            [title.trim(), artist.trim(), genre||'Other', duration||'3:00', lyrics||'', filePath, coverPath, user.id, !!user.isAdmin]
        );
        return J(201, r.rows[0]);
    }

    // â”€â”€ POST /api/songs/bulk â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (method === 'POST' && pathname === '/api/songs/bulk') {
        if (!user) return J(401, { error:'Login required' });
        const ct = req.headers['content-type'] || '';
        if (!ct.includes('multipart/form-data')) return J(400, { error:'Multipart required' });
        
        const { fields, files } = await parseMultipart(req);
        const results = [];
        const errors = [];
        
        // Get metadata arrays (CSV format: "Title1,Title2,Title3")
        const titles = fields.titles?.split(',').map(t => t.trim()).filter(Boolean) || [];
        const artists = fields.artists?.split(',').map(a => a.trim()).filter(Boolean) || [];
        const genres = fields.genres?.split(',').map(g => g.trim()).filter(Boolean) || [];
        const durations = fields.durations?.split(',').map(d => d.trim()).filter(Boolean) || [];
        
        // Get all song files (they come as song0, song1, song2, etc.)
        const songFiles = Object.keys(files)
            .filter(key => key.startsWith('song'))
            .sort((a, b) => {
                const numA = parseInt(a.replace('song', ''));
                const numB = parseInt(b.replace('song', ''));
                return numA - numB;
            })
            .map(key => files[key]);
        
        // Get all cover files
        const coverFiles = Object.keys(files)
            .filter(key => key.startsWith('cover'))
            .sort((a, b) => {
                const numA = parseInt(a.replace('cover', ''));
                const numB = parseInt(b.replace('cover', ''));
                return numA - numB;
            })
            .map(key => files[key]);
        
        if (songFiles.length === 0) {
            return J(400, { error: 'No song files provided' });
        }
        
        // Process each song
        for (let i = 0; i < songFiles.length; i++) {
            try {
                const songFile = songFiles[i];
                const coverFile = coverFiles[i] || null;
                const title = titles[i] || `Song ${i + 1}`;
                const artist = artists[i] || 'Unknown Artist';
                const genre = genres[i] || 'Other';
                const duration = durations[i] || '3:00';
                
                // Validate files
                const audioErr = validateFile(songFile, 'audio');
                if (audioErr) {
                    errors.push({ index: i, filename: songFile.filename, error: audioErr });
                    continue;
                }
                
                if (coverFile) {
                    const imgErr = validateFile(coverFile, 'image');
                    if (imgErr) {
                        errors.push({ index: i, filename: coverFile.filename, error: imgErr });
                        continue;
                    }
                }
                
                // Upload files
                let filePath, coverPath;
                const DEFAULT_COVER_URL = `${R2_PUBLIC_URL}/covers/default-cover.svg`;
                try {
                    filePath = await r2Upload(songFile, 'songs');
                    coverPath = coverFile ? await r2Upload(coverFile, 'covers') : DEFAULT_COVER_URL;
                } catch(e) {
                    console.error('[R2 bulk upload failed]', e.message);
                    errors.push({ index: i, filename: songFile.filename, error: 'R2 upload failed: ' + e.message });
                    continue;
                }
                
                // Insert into database
                const r = await query(
                    'INSERT INTO songs (title,artist,genre,duration,lyrics,file_path,cover_path,uploaded_by,approved) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
                    [title, artist, genre, duration, '', filePath, coverPath, user.id, !!user.isAdmin]
                );
                
                results.push({
                    index: i,
                    success: true,
                    song: r.rows[0]
                });
            } catch(error) {
                errors.push({
                    index: i,
                    filename: songFiles[i]?.filename || 'Unknown',
                    error: error.message
                });
            }
        }
        
        return J(200, {
            success: true,
            totalProcessed: songFiles.length,
            successful: results.length,
            failed: errors.length,
            results,
            errors
        });
    }

    // â”€â”€ DELETE /api/songs/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (method === 'DELETE' && seg[0]==='songs' && seg[1] && !seg[2]) {
        if (!user) return J(401, { error:'Unauthorized' });
        const r = await query('SELECT * FROM songs WHERE id=$1', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Song not found' });
        const song = r.rows[0];
        if (!user.isAdmin && song.uploaded_by !== user.id) return J(403, { error:'Forbidden' });
        await query('DELETE FROM songs WHERE id=$1', [seg[1]]);
        return J(200, { success:true });
    }

    // ── POST /api/songs/bulk-delete ────────────────────────────────
    // Admin only — delete up to 100 songs in a single DB query
    if (method === 'POST' && seg[0]==='songs' && seg[1]==='bulk-delete') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const body = await parseJSON(req);
        const ids  = body.ids;
        if (!Array.isArray(ids) || !ids.length) return J(400, { error:'ids array required' });
        if (ids.length > 100) return J(400, { error:'Max 100 songs per bulk delete' });
        // Validate all values are integers to prevent injection
        const safeIds = ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
        if (!safeIds.length) return J(400, { error:'No valid song IDs provided' });
        // Delete all in one query using = ANY($1)
        const result = await query(
            'DELETE FROM songs WHERE id = ANY($1::int[]) RETURNING id',
            [safeIds]
        );
        const deleted = result.rows.length;
        console.log(`[Bulk Delete] Admin ${user.id} deleted ${deleted} songs: ${safeIds.join(', ')}`);
        return J(200, { success: true, deleted });
    }
    if (method === 'PATCH' && seg[0]==='songs' && seg[2]==='approve') {        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        await query('UPDATE songs SET approved=TRUE WHERE id=$1', [seg[1]]);
        
        // AUTO-UPDATE SITEMAP
        try {
            const songData = await query('SELECT s.*, u.email as uploader_email, u.username as uploader_name FROM songs s LEFT JOIN users u ON s.uploaded_by=u.id WHERE s.id=$1', [seg[1]]);
            if (songData.rows[0]) {
                const s = songData.rows[0];
                updateSitemap(s);
                pingSearchEngines().catch(err => console.log('Ping failed:', err.message));

                // Email uploader
                if (s.uploader_email) {
                    sendEmail(s.uploader_email, '✅ Your Song Was Approved - DJ Musta', `
                        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0a0e27;color:#e2e8f0;padding:30px;border-radius:12px">
                            <h2 style="color:#22c55e">✅ Song Approved!</h2>
                            <p>Hi <strong>${s.uploader_name}</strong>, your song has been approved and is now live!</p>
                            <p style="background:#1a1f3a;padding:16px;border-radius:8px;border-left:4px solid #a855f7">
                                🎵 <strong>${s.title}</strong> by ${s.artist}
                            </p>
                            <a href="${SITE_URL}" style="display:inline-block;margin:20px 0;padding:14px 28px;background:#a855f7;color:white;border-radius:8px;text-decoration:none;font-weight:700">Listen on DJ Musta</a>
                        </div>`
                    );
                }

                // Notify followers of the artist
                const followers = await query('SELECT u.id, u.email, u.username FROM follows f JOIN users u ON f.follower_id=u.id WHERE LOWER(f.artist_name)=LOWER($1)', [s.artist]);
                for (const follower of followers.rows) {
                    await query('INSERT INTO notifications (user_id,type,title,message) VALUES ($1,$2,$3,$4)',
                        [follower.id, 'new_song', `🎵 ${s.artist} uploaded a new song!`, `"${s.title}" is now available on DJ Musta. Go listen now!`]
                    );
                    sendEmail(follower.email, `🎵 ${s.artist} - New Song on DJ Musta`, `
                        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0a0e27;color:#e2e8f0;padding:30px;border-radius:12px">
                            <h2 style="color:#a855f7">🎵 New Song from ${s.artist}!</h2>
                            <p>Hi <strong>${follower.username}</strong>, an artist you follow just dropped a new track!</p>
                            <p style="background:#1a1f3a;padding:16px;border-radius:8px;border-left:4px solid #a855f7">
                                🎵 <strong>${s.title}</strong> by ${s.artist}
                            </p>
                            <a href="${SITE_URL}" style="display:inline-block;margin:20px 0;padding:14px 28px;background:#a855f7;color:white;border-radius:8px;text-decoration:none;font-weight:700">Listen Now</a>
                        </div>`
                    );
                }
            }
        } catch (err) {
            console.error('Post-approve actions failed:', err.message);
        }
        
        return J(200, { success:true });
    }

    // â”€â”€ PATCH /api/songs/:id/reject â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (method === 'PATCH' && seg[0]==='songs' && seg[2]==='reject') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        await query('UPDATE songs SET approved=FALSE WHERE id=$1', [seg[1]]);
        return J(200, { success:true });
    }

    // â”€â”€ POST /api/songs/:id/like â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // PATCH /api/songs/:id - update fields (admin: is_featured, is_song_of_day, etc.)
    if (method === 'PATCH' && seg[0]==='songs' && seg[1] && !seg[2]) {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const body = await parseJSON(req);
        const allowed = ['title','artist','genre','duration','lyrics','release_year',
                         'is_featured','is_song_of_day','sponsored_until','sponsor_name'];
        const sets = []; const vals = [];
        for (const key of allowed) {
            if (body[key] !== undefined) { vals.push(body[key]); sets.push(key+'=$'+vals.length); }
        }
        if (!sets.length) return J(400, { error:'No valid fields' });
        if (body.is_song_of_day === true) {
            await query('UPDATE songs SET is_song_of_day=FALSE WHERE is_song_of_day=TRUE');
        }
        vals.push(seg[1]);
        await query('UPDATE songs SET '+sets.join(',')+'WHERE id=$'+vals.length, vals);
        return J(200, { success:true });
    }

    // PATCH /api/songs/admin/song-of-day
    if (method === 'PATCH' && pathname === '/api/songs/admin/song-of-day') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const { song_id } = await parseJSON(req);
        await query('UPDATE songs SET is_song_of_day=FALSE WHERE is_song_of_day=TRUE');
        if (song_id) await query('UPDATE songs SET is_song_of_day=TRUE WHERE id=$1', [song_id]);
        return J(200, { success:true });
    }
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

    // â”€â”€ POST /api/songs/:id/download â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (method === 'POST' && seg[0]==='songs' && seg[2]==='download') {
        const r = await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Not found' });
        await query('UPDATE songs SET download_count=download_count+1 WHERE id=$1', [seg[1]]);
        await query('INSERT INTO downloads (user_id,song_id,ip) VALUES ($1,$2,$3)', [user?.id||null, seg[1], ip]);
        return J(200, { success:true });
    }

    // â”€â”€ GET /api/songs/:id/download-file â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // ── GET /api/songs/:id/stream ──────────────────────────────────
    // Proxies audio from R2 through the backend with CORS headers
    if (method === 'GET' && seg[0]==='songs' && seg[1] && seg[2]==='stream') {
        const r = await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Not found' });
        const song = r.rows[0];
        const fileUrl = song.file_path;
        if (!fileUrl) return J(404, { error:'No file' });
        console.log(`[Stream] Song #${song.id}: "${song.title}" | URL: ${fileUrl.substring(0, 60)}...`);

        // Helper: get content-type from file path string
        function getAudioContentType(filePath) {
            const p = filePath.toLowerCase();
            if (p.endsWith('.wav') || p.endsWith('.wave')) return 'audio/wav';
            if (p.endsWith('.m4a') || p.endsWith('.m4b'))  return 'audio/mp4';
            if (p.endsWith('.ogg') || p.endsWith('.oga'))  return 'audio/ogg';
            if (p.endsWith('.webm'))                        return 'audio/webm';
            if (p.endsWith('.flac'))                        return 'audio/flac';
            if (p.endsWith('.aac'))                         return 'audio/aac';
            return 'audio/mpeg'; // default for .mp3 and unknown
        }

        // Handle local file paths (legacy uploads stored on disk)
        if (!fileUrl.startsWith('http://') && !fileUrl.startsWith('https://')) {
            const localPath = fileUrl.startsWith('/')
                ? path.join(__dirname, '..', fileUrl)
                : path.join(__dirname, fileUrl);
            console.log(`[Stream] Local file path: ${localPath}`);
            if (!fs.existsSync(localPath)) {
                console.error(`[Stream] Local file not found: ${localPath}`);
                return J(404, { error: 'Audio file not found. It may have been stored on an old server.' });
            }
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

        return new Promise((resolve) => {
            const reqHeaders = { 'User-Agent': 'DJMusta/1.0' };
            if (req.headers.range) reqHeaders['Range'] = req.headers.range;
            const client = fileUrl.startsWith('https:') ? https : http;
            const proxyReq = client.get(fileUrl, { headers: reqHeaders }, (proxyRes) => {
                const status = proxyRes.statusCode || 200;
                
                // Determine correct Content-Type based on file extension
                const urlPath = new URL(fileUrl).pathname.toLowerCase();
                let contentType = getAudioContentType(urlPath);
                // If unknown extension, try R2's content-type if it's audio
                if (contentType === 'audio/mpeg' && !urlPath.endsWith('.mp3')) {
                    if (proxyRes.headers['content-type']?.startsWith('audio/')) {
                        contentType = proxyRes.headers['content-type'];
                    }
                }
                
                console.log(`[Stream] File: ${urlPath} | R2 Content-Type: ${proxyRes.headers['content-type']} | Serving as: ${contentType} | Status: ${status} | Size: ${proxyRes.headers['content-length']} bytes`);
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

    // Serves file with clean filename (no timestamp)
    if (method === 'GET' && seg[0]==='songs' && seg[2]==='download-file') {
        const r = await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Not found' });
        
        const song = r.rows[0];
        const fileUrl = song.file_path;
        
        // Clean the title and artist for filename
        const cleanTitle = song.title.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim().replace(/\s+/g, '_') || 'song';
        const cleanArtist = song.artist.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim().replace(/\s+/g, '_') || 'artist';
        const cleanFilename = `${cleanTitle}_${cleanArtist}_[this_song_downloaded_from_www.Djmusta.com].mp3`;  // ðŸ”¥ Full branding!
        
        // Track download
        await query('UPDATE songs SET download_count=download_count+1 WHERE id=$1', [seg[1]]);
        await query('INSERT INTO downloads (user_id,song_id,ip) VALUES ($1,$2,$3)', [user?.id||null, seg[1], ip]);
        
        // Proxy download from R2 with clean filename
        return new Promise((resolve) => {
            const client = fileUrl.startsWith('https:') ? https : http;
            client.get(fileUrl, (proxyRes) => {
                if (proxyRes.statusCode !== 200) {
                    res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders(origin) });
                    res.end(JSON.stringify({ error: 'File not found' }));
                    return resolve();
                }
                
                res.writeHead(200, {
                    'Content-Type': 'audio/mpeg',
                    'Content-Length': proxyRes.headers['content-length'],
                    'Content-Disposition': `attachment; filename="${cleanFilename}"`,  // ðŸ”¥ This forces clean filename!
                    'Cache-Control': 'public,max-age=3600',
                    ...corsHeaders(origin)
                });
                proxyRes.pipe(res);
                proxyRes.on('end', resolve);
            }).on('error', (err) => {
                console.error('[Download proxy error]', err);
                res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders(origin) });
                res.end(JSON.stringify({ error: 'Download failed' }));
                resolve();
            });
        });
    }

    // â”€â”€ PATCH /api/songs/admin/users/:id/admin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (method === 'PATCH' && seg[0]==='songs' && seg[1]==='admin' && seg[2]==='users' && seg[4]==='admin') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const body = await parseJSON(req);
        await query('UPDATE users SET is_admin=$1 WHERE id=$2', [!!body.isAdmin, seg[3]]);
        return J(200, { success:true });
    }

    // â”€â”€ PLAYLISTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // GET /api/playlists - Get user's playlists
    if (method === 'GET' && pathname === '/api/playlists') {
        if (!user) return J(401, { error:'Login required' });
        const r = await query('SELECT p.*, COUNT(ps.song_id) as song_count FROM playlists p LEFT JOIN playlist_songs ps ON p.id=ps.playlist_id WHERE p.user_id=$1 GROUP BY p.id ORDER BY p.created_at DESC', [user.id]);
        return J(200, { playlists: r.rows });
    }

    // POST /api/playlists - Create playlist
    if (method === 'POST' && pathname === '/api/playlists') {
        if (!user) return J(401, { error:'Login required' });
        const { name, description, isPublic } = await parseJSON(req);
        if (!name || name.trim().length === 0) return J(400, { error:'Playlist name required' });
        const r = await query('INSERT INTO playlists (user_id,name,description,is_public) VALUES ($1,$2,$3,$4) RETURNING *', [user.id, name.trim(), description||'', !!isPublic]);
        return J(201, { playlist: r.rows[0] });
    }

    // GET /api/playlists/:id - Get playlist songs
    if (method === 'GET' && seg[0]==='playlists' && seg[1] && !isNaN(seg[1]) && !seg[2]) {
        const r = await query('SELECT p.* FROM playlists p WHERE p.id=$1 AND (p.is_public=TRUE OR p.user_id=$2)', [seg[1], user?.id||null]);
        if (!r.rows[0]) return J(404, { error:'Playlist not found' });
        const songs = await query('SELECT s.*, ps.added_at FROM songs s INNER JOIN playlist_songs ps ON s.id=ps.song_id WHERE ps.playlist_id=$1 AND s.approved=TRUE ORDER BY ps.position, ps.added_at', [seg[1]]);
        return J(200, { playlist: r.rows[0], songs: songs.rows });
    }

    // POST /api/playlists/:id/songs - Add song to playlist
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

    // DELETE /api/playlists/:id/songs/:songId - Remove song from playlist
    if (method === 'DELETE' && seg[0]==='playlists' && seg[1] && seg[2]==='songs' && seg[3]) {
        if (!user) return J(401, { error:'Login required' });
        const playlist = await query('SELECT id FROM playlists WHERE id=$1 AND user_id=$2', [seg[1], user.id]);
        if (!playlist.rows[0]) return J(404, { error:'Playlist not found or not yours' });
        await query('DELETE FROM playlist_songs WHERE playlist_id=$1 AND song_id=$2', [seg[1], seg[3]]);
        return J(200, { success:true });
    }

    // DELETE /api/playlists/:id - Delete playlist
    if (method === 'DELETE' && seg[0]==='playlists' && seg[1] && !seg[2]) {
        if (!user) return J(401, { error:'Login required' });
        const playlist = await query('SELECT id FROM playlists WHERE id=$1 AND user_id=$2', [seg[1], user.id]);
        if (!playlist.rows[0]) return J(404, { error:'Playlist not found or not yours' });
        await query('DELETE FROM playlists WHERE id=$1', [seg[1]]);
        return J(200, { success:true });
    }

    // â”€â”€ ARTISTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // GET /api/artists - Get all artists
    if (method === 'GET' && pathname === '/api/artists') {
        const artists = await query('SELECT DISTINCT artist FROM songs WHERE approved=TRUE ORDER BY artist');
        return J(200, { artists: artists.rows.map(r => r.artist) });
    }

    // GET /api/artists/:name - Get artist profile and songs
    if (method === 'GET' && seg[0]==='artists' && seg[1] && !seg[2]) {
        const artistName = decodeURIComponent(seg[1]);
        const profile = await query('SELECT * FROM artists WHERE LOWER(name)=LOWER($1)', [artistName]);
        const songs = await query('SELECT * FROM songs WHERE LOWER(artist)=LOWER($1) AND approved=TRUE ORDER BY created_at DESC', [artistName]);
        return J(200, { 
            artist: profile.rows[0] || { name: artistName, bio: '', photo_url: null },
            songs: songs.rows
        });
    }

    // PATCH /api/artists/:name - Update artist profile (admin only)
    if (method === 'PATCH' && seg[0]==='artists' && seg[1] && !seg[2]) {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const artistName = decodeURIComponent(seg[1]);
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

    // POST /api/artists/photo - Upload artist photo as base64 (admin only)
    if (method === 'POST' && pathname === '/api/artists/photo') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        try {
            const { fields, files } = await parseMultipart(req);
            const photo = files['photo'] || files['image'];
            const artistName = fields['artistName'];
            if (!photo) return J(400, { error:'No photo uploaded' });
            if (!artistName) return J(400, { error:'Artist name required' });
            if (photo.data.length > 2 * 1024 * 1024) return J(400, { error:'Photo too large. Max 2MB.' });

            const base64 = photo.data.toString('base64');
            const dataUrl = `data:${photo.mimetype};base64,${base64}`;

            const existing = await query('SELECT id FROM artists WHERE LOWER(name)=LOWER($1)', [artistName]);
            if (existing.rows.length) {
                await query('UPDATE artists SET photo_url=$1 WHERE LOWER(name)=LOWER($2)', [dataUrl, artistName]);
            } else {
                await query('INSERT INTO artists (name, photo_url) VALUES ($1,$2)', [artistName, dataUrl]);
            }
            return J(200, { success:true, photoUrl: dataUrl, photo_url: dataUrl });
        } catch(err) {
            console.error('[Artist Photo] Error:', err);
            return J(500, { error:'Upload failed: ' + err.message });
        }
    }

    // â”€â”€ HISTORY & RECOMMENDATIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // GET /api/history/recent - Recently played songs
    if (method === 'GET' && pathname === '/api/history/recent') {
        if (!user) return J(401, { error:'Login required' });
        const r = await query(`
            SELECT DISTINCT ON (s.id) s.*, p.created_at as played_at 
            FROM songs s 
            INNER JOIN plays p ON s.id=p.song_id 
            WHERE p.user_id=$1 AND s.approved=TRUE 
            ORDER BY s.id, p.created_at DESC 
            LIMIT 20
        `, [user.id]);
        return J(200, { songs: r.rows });
    }

    // GET /api/recommendations - Recommended songs
    if (method === 'GET' && pathname === '/api/recommendations') {
        if (!user) return J(401, { error:'Login required' });
        // Recommend based on liked songs' genres and artists
        const r = await query(`
            SELECT DISTINCT s.* FROM songs s
            WHERE s.approved=TRUE AND s.id NOT IN (
                SELECT song_id FROM likes WHERE user_id=$1
            ) AND (
                s.genre IN (SELECT DISTINCT genre FROM songs WHERE id IN (SELECT song_id FROM likes WHERE user_id=$1))
                OR s.artist IN (SELECT DISTINCT artist FROM songs WHERE id IN (SELECT song_id FROM likes WHERE user_id=$1))
            )
            ORDER BY s.play_count DESC, s.created_at DESC
            LIMIT 20
        `, [user.id]);
        return J(200, { songs: r.rows });
    }

    // GET /api/trending - Trending songs (most played in last 7 days)
    if (method === 'GET' && pathname === '/api/trending') {
        const r = await query(`
            SELECT s.*, COUNT(p.id) as recent_plays 
            FROM songs s 
            LEFT JOIN plays p ON s.id=p.song_id AND p.created_at > NOW() - INTERVAL '7 days'
            WHERE s.approved=TRUE
            GROUP BY s.id
            ORDER BY recent_plays DESC, s.play_count DESC
            LIMIT 50
        `);
        return J(200, { songs: r.rows });
    }

    // â”€â”€ COMMENTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // GET /api/songs/:id/comments - Get comments for a song
    if (method === 'GET' && seg[0]==='songs' && seg[1] && seg[2]==='comments') {
        const r = await query(`
            SELECT c.*, u.username 
            FROM comments c 
            INNER JOIN users u ON c.user_id=u.id 
            WHERE c.song_id=$1 
            ORDER BY c.created_at DESC
        `, [seg[1]]);
        return J(200, { comments: r.rows });
    }

    // POST /api/songs/:id/comments - Add comment
    if (method === 'POST' && seg[0]==='songs' && seg[1] && seg[2]==='comments') {
        if (!user) return J(401, { error:'Login required' });
        const { comment } = await parseJSON(req);
        if (!comment || comment.trim().length === 0) return J(400, { error:'Comment cannot be empty' });
        const r = await query('INSERT INTO comments (user_id,song_id,comment) VALUES ($1,$2,$3) RETURNING *', [user.id, seg[1], comment.trim()]);
        return J(201, { comment: { ...r.rows[0], username: user.username } });
    }

    // DELETE /api/comments/:id - Delete comment
    if (method === 'DELETE' && seg[0]==='comments' && seg[1]) {
        if (!user) return J(401, { error:'Login required' });
        const comment = await query('SELECT * FROM comments WHERE id=$1', [seg[1]]);
        if (!comment.rows[0]) return J(404, { error:'Comment not found' });
        if (comment.rows[0].user_id !== user.id && !user.isAdmin) return J(403, { error:'Forbidden' });
        await query('DELETE FROM comments WHERE id=$1', [seg[1]]);
        return J(200, { success:true });
    }

    // â”€â”€ FOLLOWING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // POST /api/artists/:name/follow - Follow artist
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

    // DELETE /api/artists/:name/follow - Unfollow artist
    if (method === 'DELETE' && seg[0]==='artists' && seg[1] && seg[2]==='follow') {
        if (!user) return J(401, { error:'Login required' });
        const artistName = decodeURIComponent(seg[1]);
        await query('DELETE FROM follows WHERE follower_id=$1 AND artist_name=$2', [user.id, artistName]);
        return J(200, { following:false });
    }

    // GET /api/artists/:name/following - Check if following
    if (method === 'GET' && seg[0]==='artists' && seg[1] && seg[2]==='following') {
        if (!user) return J(200, { following:false });
        const artistName = decodeURIComponent(seg[1]);
        const r = await query('SELECT id FROM follows WHERE follower_id=$1 AND artist_name=$2', [user.id, artistName]);
        return J(200, { following: r.rows.length > 0 });
    }

    // GET /api/following - Get user's followed artists
    if (method === 'GET' && pathname === '/api/following') {
        if (!user) return J(401, { error:'Login required' });
        const r = await query('SELECT artist_name FROM follows WHERE follower_id=$1 ORDER BY created_at DESC', [user.id]);
        return J(200, { artists: r.rows.map(x => x.artist_name) });
    }

    // â”€â”€ NOTIFICATIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // GET /api/notifications - Get user notifications
    if (method === 'GET' && pathname === '/api/notifications') {
        if (!user) return J(401, { error:'Login required' });
        const r = await query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [user.id]);
        return J(200, { notifications: r.rows });
    }

    // PATCH /api/notifications/:id/read - Mark notification as read
    if (method === 'PATCH' && seg[0]==='notifications' && seg[1] && seg[2]==='read') {
        if (!user) return J(401, { error:'Login required' });
        await query('UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2', [seg[1], user.id]);
        return J(200, { success:true });
    }

    // PATCH /api/notifications/read-all - Mark all as read
    if (method === 'PATCH' && pathname === '/api/notifications/read-all') {
        if (!user) return J(401, { error:'Login required' });
        await query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1', [user.id]);
        return J(200, { success:true });
    }

    // â”€â”€ SONG UPDATE (PATCH) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    
    // PATCH /api/songs/:id - Update song details (admin only)
    if (method === 'PATCH' && seg[0]==='songs' && seg[1] && !seg[2]) {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const { title, artist, genre, duration, lyrics, releaseYear } = await parseJSON(req);
        await query(
            'UPDATE songs SET title=$1, artist=$2, genre=$3, duration=$4, lyrics=$5, release_year=$6 WHERE id=$7',
            [title, artist, genre||'Other', duration||'3:00', lyrics||'', releaseYear||new Date().getFullYear(), seg[1]]
        );
        return J(200, { success:true });
    }

    // â”€â”€ USER PROFILE UPDATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // PATCH /api/auth/profile - Update user profile
    if (method === 'PATCH' && pathname === '/api/auth/profile') {
        if (!user) return J(401, { error:'Login required' });
        const { username } = await parseJSON(req);
        if (!username || username.trim().length < 3) return J(400, { error:'Username must be at least 3 characters' });
        await query('UPDATE users SET username=$1 WHERE id=$2', [username.trim(), user.id]);
        return J(200, { success:true });
    }

    // POST /api/auth/profile/photo - Upload profile photo (stored as base64 in DB)
    if (method === 'POST' && pathname === '/api/auth/profile/photo') {
        if (!user) return J(401, { error:'Login required' });
        try {
            const { fields, files } = await parseMultipart(req);
            const photo = files['photo'];
            if (!photo) return J(400, { error:'No photo uploaded' });

            // Resize check - limit to 2MB
            if (photo.data.length > 2 * 1024 * 1024) return J(400, { error:'Photo too large. Max 2MB.' });

            // Store as base64 data URL directly in DB
            const base64 = photo.data.toString('base64');
            const dataUrl = `data:${photo.mimetype};base64,${base64}`;

            await query('UPDATE users SET profile_photo=$1 WHERE id=$2', [dataUrl, user.id]);
            // Return only success — don't send the full base64 back (too large)
            return J(200, { success: true });
        } catch(err) {
            console.error('[Profile Photo] Error:', err);
            return J(500, { error:'Upload failed: ' + err.message });
        }
    }

    // GET /api/stats/user - Get user-specific stats
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

    // â”€â”€ VERIFICATION ROUTES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // POST /api/verification/request - Submit verification request
    if (method === 'POST' && pathname === '/api/verification/request') {
        try {
            if (!user) return J(401, { error:'Unauthorized' });
            const body = await parseJSON(req);
            const artistName = body.artist_name || body.artistName;
            const phone = body.phone;
            const socialLinks = body.social_links || body.socialLinks;
            const reason = body.reason;
            
            if (!artistName || !phone || !socialLinks || !reason) 
                return J(400, { error:'All fields required' });
            
            const approved = await query(
                'SELECT id FROM verification_requests WHERE user_id=$1 AND status=$2 LIMIT 1',
                [user.id, 'approved']
            );
            if (approved.rows.length > 0)
                return J(400, { error:'You are already verified' });
            
            // Check for pending request
            const existing = await query(
                'SELECT id FROM verification_requests WHERE user_id=$1 AND status=$2',
                [user.id, 'pending']
            );
            if (existing.rows.length > 0) 
                return J(400, { error:'You already have a pending verification request' });
            
            // Insert request
            await query(
                'INSERT INTO verification_requests (user_id, artist_name, phone, social_links, reason, status) VALUES ($1,$2,$3,$4,$5,$6)',
                [user.id, artistName, phone, socialLinks, reason, 'pending']
            );
            
            return J(201, { success:true, message:'Verification request submitted successfully' });
        } catch (err) {
            console.error('[Verification Request Error]', err);
            return J(500, { error: 'Internal server error: ' + err.message });
        }
    }

    // GET /api/verification/requests - Get all verification requests (ADMIN ONLY)
    if (method === 'GET' && pathname === '/api/verification/requests') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const status = parsed.searchParams.get('status') || 'pending';
        const r = await query(`
            SELECT vr.*, u.username, u.email 
            FROM verification_requests vr 
            INNER JOIN users u ON vr.user_id=u.id 
            WHERE vr.status=$1
            ORDER BY vr.submitted_at DESC
        `, [status]);
        return J(200, { requests: r.rows });
    }

    // POST /api/verification/review/:id - Approve/Reject verification (ADMIN ONLY)
    if (method === 'POST' && seg[0]==='verification' && seg[1]==='review' && seg[2] && !seg[3]) {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const requestId = seg[2];
        const body = await parseJSON(req);
        const action = body.action;
        const adminNotes = body.adminNotes || body.admin_notes || '';
        
        if (!['approve', 'reject'].includes(action)) 
            return J(400, { error:'Invalid action. Must be approve or reject' });
        
        const request = await query('SELECT * FROM verification_requests WHERE id=$1', [requestId]);
        if (!request.rows[0]) 
            return J(404, { error:'Verification request not found' });
        
        const status = action === 'approve' ? 'approved' : 'rejected';
        const userId = request.rows[0].user_id;
        
        // Update verification request
        await query(
            'UPDATE verification_requests SET status=$1, reviewed_at=NOW(), reviewed_by=$2, admin_notes=$3 WHERE id=$4',
            [status, user.id, adminNotes, requestId]
        );
        
        // Send notification to user
        const notifTitle = action === 'approve' ? '✅ Verification Approved!' : '❌ Verification Rejected';
        const notifMessage = action === 'approve' 
            ? 'Congratulations! Your artist verification has been approved. You now have a verified badge on your profile.'
            : `Your verification request has been rejected. ${adminNotes ? 'Reason: ' + adminNotes : 'Please contact support for more details.'}`;
        
        await query(
            'INSERT INTO notifications (user_id, type, title, message) VALUES ($1, $2, $3, $4)',
            [userId, 'verification_' + status, notifTitle, notifMessage]
        );

        // Send email notification
        const userInfo = await query('SELECT email, username FROM users WHERE id=$1', [userId]);
        if (userInfo.rows[0]) {
            const { email: uEmail, username: uName } = userInfo.rows[0];
            if (action === 'approve') {
                sendEmail(uEmail, '✅ Artist Verification Approved - DJ Musta', `
                    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0a0e27;color:#e2e8f0;padding:30px;border-radius:12px">
                        <h2 style="color:#22c55e">✅ Congratulations ${uName}!</h2>
                        <p>Your artist verification request has been <strong>approved</strong>!</p>
                        <p>You now have a ✓ Verified badge on your DJ Musta profile.</p>
                        <a href="${SITE_URL}" style="display:inline-block;margin:20px 0;padding:14px 28px;background:#a855f7;color:white;border-radius:8px;text-decoration:none;font-weight:700">Visit DJ Musta</a>
                    </div>`
                );
            } else {
                sendEmail(uEmail, '❌ Artist Verification Update - DJ Musta', `
                    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0a0e27;color:#e2e8f0;padding:30px;border-radius:12px">
                        <h2 style="color:#ef4444">Verification Update</h2>
                        <p>Hi <strong>${uName}</strong>, your verification request was not approved at this time.</p>
                        ${adminNotes ? `<p style="background:#1a1f3a;padding:12px;border-radius:8px"><strong>Reason:</strong> ${adminNotes}</p>` : ''}
                        <p>You can submit a new request with more information.</p>
                        <a href="${SITE_URL}" style="display:inline-block;margin:20px 0;padding:14px 28px;background:#a855f7;color:white;border-radius:8px;text-decoration:none;font-weight:700">Visit DJ Musta</a>
                    </div>`
                );
            }
        }
        
        return J(200, { success:true, message:`Verification request ${action}d successfully` });
    }

    // GET /api/verification/status - Get user's verification status
    if (method === 'GET' && pathname === '/api/verification/status') {
        if (!user) return J(401, { error:'Unauthorized' });
        
        const approvedRequest = await query(
            'SELECT * FROM verification_requests WHERE user_id=$1 AND status=$2 ORDER BY reviewed_at DESC LIMIT 1',
            [user.id, 'approved']
        );
        const isVerified = approvedRequest.rows.length > 0;
        
        const pendingRequest = await query(
            'SELECT * FROM verification_requests WHERE user_id=$1 AND status=$2',
            [user.id, 'pending']
        );
        
        return J(200, {
            isVerified,
            hasPendingRequest: pendingRequest.rows.length > 0,
            request: pendingRequest.rows[0] || approvedRequest.rows[0] || null
        });
    }

    // DELETE /api/verification/requests/:id - Delete verification request (ADMIN ONLY)
    if (method === 'DELETE' && seg[0]==='verification' && seg[1]==='requests' && seg[2] && !seg[3]) {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const requestId = seg[2];
        
        const request = await query('SELECT * FROM verification_requests WHERE id=$1', [requestId]);
        if (!request.rows[0]) return J(404, { error:'Verification request not found' });
        
        await query('DELETE FROM verification_requests WHERE id=$1', [requestId]);
        return J(200, { success:true, message:'Verification request deleted' });
    }

    // ── PREMIUM MANAGEMENT ───────────────────────────────────────────

    // DELETE /api/admin/users/:id - Delete a user (admin only)
    if (method === 'DELETE' && seg[0]==='admin' && seg[1]==='users' && seg[2]) {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        if (seg[2] == user.id) return J(400, { error:'Cannot delete yourself' });
        await query('DELETE FROM users WHERE id=$1 AND is_admin=FALSE', [seg[2]]);
        return J(200, { success:true });
    }

    // GET /api/admin/premium - List all premium users (admin)
    if (method === 'GET' && pathname === '/api/admin/premium') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const r = await query('SELECT id,username,email,is_premium,premium_since,premium_note,created_at FROM users WHERE is_premium=TRUE ORDER BY premium_since DESC');
        return J(200, { users: r.rows });
    }

    // PATCH /api/admin/premium/:id - Grant/revoke premium (admin)
    if (method === 'PATCH' && seg[0]==='admin' && seg[1]==='premium' && seg[2]) {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const { isPremium, note } = await parseJSON(req);
        const target = (await query('SELECT * FROM users WHERE id=$1', [seg[2]])).rows[0];
        if (!target) return J(404, { error:'User not found' });
        await query('UPDATE users SET is_premium=$1, premium_since=$2, premium_note=$3 WHERE id=$4',
            [!!isPremium, isPremium ? new Date() : null, note||null, seg[2]]);
        // Notify user
        await query('INSERT INTO notifications (user_id,type,title,message) VALUES ($1,$2,$3,$4)',
            [seg[2], 'premium', isPremium ? '👑 Premium Activated!' : '⚠️ Premium Ended',
             isPremium ? 'Your account has been upgraded to Premium! Enjoy all features.' : 'Your premium subscription has ended.']);
        if (target.email) {
            sendEmail(target.email, isPremium ? '👑 Premium Activated - DJ Musta' : 'Premium Subscription Update', `
                <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0a0e27;color:#e2e8f0;padding:30px;border-radius:12px">
                    <h2 style="color:#f59e0b">${isPremium ? '👑 Premium Activated!' : 'Subscription Update'}</h2>
                    <p>Hi <strong>${target.username}</strong>,</p>
                    <p>${isPremium ? 'Your DJ Musta account has been upgraded to <strong>Premium</strong>! Enjoy unlimited downloads, no ads, and more.' : 'Your premium subscription has ended. Contact us to renew.'}</p>
                    ${note ? `<p style="background:#1a1f3a;padding:12px;border-radius:8px">Note: ${note}</p>` : ''}
                    <a href="${SITE_URL}" style="display:inline-block;margin:20px 0;padding:14px 28px;background:#f59e0b;color:white;border-radius:8px;text-decoration:none;font-weight:700">Visit DJ Musta</a>
                </div>`);
        }
        return J(200, { success:true });
    }

    // ── CHARTS / TOP 10 ──────────────────────────────────────────────

    // GET /api/charts/top10 - Top 10 songs this week
    if (method === 'GET' && pathname === '/api/charts/top10') {
        const r = await query(`
            SELECT s.*, COUNT(p.id) as week_plays
            FROM songs s
            LEFT JOIN plays p ON s.id=p.song_id AND p.created_at > NOW() - INTERVAL '7 days'
            WHERE s.approved=TRUE
            GROUP BY s.id
            ORDER BY week_plays DESC, s.like_count DESC
            LIMIT 10
        `);
        return J(200, { songs: r.rows });
    }

    // GET /api/charts/top-artists - Top 5 artists this week
    if (method === 'GET' && pathname === '/api/charts/top-artists') {
        const r = await query(`
            SELECT s.artist, COUNT(p.id) as week_plays, SUM(s.like_count) as total_likes
            FROM songs s
            LEFT JOIN plays p ON s.id=p.song_id AND p.created_at > NOW() - INTERVAL '7 days'
            WHERE s.approved=TRUE
            GROUP BY s.artist
            ORDER BY week_plays DESC
            LIMIT 5
        `);
        return J(200, { artists: r.rows });
    }

    // GET /api/songs/:id/related - Related songs by same artist
    if (method === 'GET' && seg[0]==='songs' && seg[1] && seg[2]==='related') {
        const song = (await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]])).rows[0];
        if (!song) return J(404, { error:'Song not found' });
        const related = await query(`
            SELECT * FROM songs
            WHERE approved=TRUE AND id != $1 AND (LOWER(artist)=LOWER($2) OR genre=$3)
            ORDER BY CASE WHEN LOWER(artist)=LOWER($2) THEN 0 ELSE 1 END, play_count DESC
            LIMIT 8
        `, [seg[1], song.artist, song.genre]);
        return J(200, { songs: related.rows });
    }

    // ── ADMIN STATS for revenue dashboard ───────────────────────────

    // GET /api/admin/stats - Full platform stats for admin dashboard
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

    // GET /api/artist/stats - Artist's own song statistics
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

    // GET /api/songs/featured - Get featured/promoted songs
    if (method === 'GET' && pathname === '/api/songs/featured') {
        const r = await query(`SELECT s.* FROM songs s WHERE s.approved=TRUE AND s.is_featured=TRUE ORDER BY s.created_at DESC LIMIT 10`);
        return J(200, { songs: r.rows });
    }

    // PATCH /api/songs/:id/feature - Toggle featured (admin)
    if (method === 'PATCH' && seg[0]==='songs' && seg[1] && seg[2]==='feature') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const { featured } = await parseJSON(req);
        await query('ALTER TABLE songs ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE');
        await query('UPDATE songs SET is_featured=$1 WHERE id=$2', [!!featured, seg[1]]);
        return J(200, { success:true });
    }

    // PATCH /api/songs/:id/cover - Update song cover image (admin)
    if (method === 'PATCH' && seg[0]==='songs' && seg[1] && seg[2]==='cover') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        try {
            const { fields, files } = await parseMultipart(req);
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

    // GET /api/songs/new-this-week - Songs from last 7 days
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

    // POST /api/songs/:id/report - Report a song
    if (method === 'POST' && seg[0]==='songs' && seg[1] && seg[2]==='report') {
        if (!user) return J(401, { error:'Login required' });
        const { reason } = await parseJSON(req);
        if (!reason) return J(400, { error:'Please provide a reason' });
        await query('INSERT INTO notifications (user_id,type,title,message) VALUES ($1,$2,$3,$4)',
            [1, 'report', `🚨 Song Report - ID ${seg[1]}`,
             `User ${user.email} reported song #${seg[1]}. Reason: ${reason}`]);
        return J(200, { success:true, message:'Song reported. Admin will review it.' });
    }

    // GET /api/songs/:id/embed - Get embed code info
    if (method === 'GET' && seg[0]==='songs' && seg[1] && seg[2]==='embed') {
        const r = await query('SELECT id,title,artist,cover_path,duration FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Song not found' });
        const s = r.rows[0];
        const embedUrl = `${SITE_URL}?song=${s.id}`;
        const embedCode = `<iframe src="${SITE_URL}/embed/${s.id}" width="100%" height="120" frameborder="0" allow="autoplay" style="border-radius:12px"></iframe>`;
        return J(200, { song: s, embedUrl, embedCode });
    }

    // PATCH /api/admin/password - Admin change own password
    if (method === 'PATCH' && pathname === '/api/admin/password') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const { newPassword } = await parseJSON(req);
        if (!newPassword || newPassword.length < 6) return J(400, { error:'Password must be at least 6 characters' });
        await query('UPDATE users SET password=$1 WHERE id=$2', [hashPassword(newPassword), user.id]);
        return J(200, { success:true });
    }

    // ============================================================
    // PUSH NOTIFICATION ENDPOINTS
    // ============================================================

    // POST /api/push/subscribe - Save a push subscription
    if (method === 'POST' && pathname === '/api/push/subscribe') {
        const body = await parseJSON(req);
        const sub = body.subscription;
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
            return J(400, { error: 'Invalid subscription data' });
        }
        await query(`
            INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id, user_agent)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (endpoint) DO UPDATE
            SET p256dh=$2, auth=$3, user_id=$4, user_agent=$5
        `, [sub.endpoint, sub.keys.p256dh, sub.keys.auth,
            user?.id || null, (body.userAgent || '').substring(0, 200)]);
        console.log('[Push] New subscription saved. Total:', (await query('SELECT COUNT(*) FROM push_subscriptions')).rows[0].count);
        return J(200, { success: true });
    }

    // POST /api/push/unsubscribe - Remove a push subscription
    if (method === 'POST' && pathname === '/api/push/unsubscribe') {
        const body = await parseJSON(req);
        if (!body.endpoint) return J(400, { error: 'Endpoint required' });
        await query('DELETE FROM push_subscriptions WHERE endpoint=$1', [body.endpoint]);
        return J(200, { success: true });
    }

    // POST /api/push/send - Send push notification to ALL subscribers (admin only)
    if (method === 'POST' && pathname === '/api/push/send') {
        if (!user?.isAdmin) return J(403, { error: 'Admin only' });
        const { title, body, songId, icon, url } = await parseJSON(req);
        if (!title || !body) return J(400, { error: 'title and body required' });

        const subs = await query('SELECT endpoint, p256dh, auth FROM push_subscriptions');
        if (!subs.rows.length) return J(200, { success: true, sent: 0, message: 'No subscribers yet' });

        const payload = JSON.stringify({
            title: title || '🎵 DJ Musta Music',
            body:  body  || 'New songs just dropped!',
            icon:  icon  || '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            url:   url   || '/',
            songId: songId || null,
            tag:   'djmusta-' + Date.now()
        });

        let sent = 0, failed = 0;
        const expiredEndpoints = [];

        await Promise.allSettled(subs.rows.map(async sub => {
            try {
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    payload,
                    { TTL: 86400 } // 24 hours
                );
                sent++;
            } catch(e) {
                failed++;
                // 410 Gone = subscription expired, remove it
                if (e.statusCode === 410 || e.statusCode === 404) {
                    expiredEndpoints.push(sub.endpoint);
                }
            }
        }));

        // Clean up expired subscriptions
        if (expiredEndpoints.length) {
            await query(
                `DELETE FROM push_subscriptions WHERE endpoint = ANY($1)`,
                [expiredEndpoints]
            );
        }

        console.log(`[Push] Sent: ${sent}, Failed: ${failed}, Expired removed: ${expiredEndpoints.length}`);
        return J(200, { success: true, sent, failed, total: subs.rows.length });
    }

    // GET /api/push/count - Get subscriber count (admin only)
    if (method === 'GET' && pathname === '/api/push/count') {
        if (!user?.isAdmin) return J(403, { error: 'Admin only' });
        const r = await query('SELECT COUNT(*) as count FROM push_subscriptions');
        return J(200, { count: parseInt(r.rows[0].count) });
    }

    J(404, { error:'Endpoint not found' });
}
// Public user object
function pub(u) {
    return { 
        id:u.id, 
        username:u.username, 
        email:u.email, 
        isAdmin:!!u.is_admin,
        isVerified:!!u.is_verified,
        isPremium:!!u.is_premium,
        profile_photo:u.profile_photo,
        createdAt:u.created_at 
    };
}

// ============================================================
// START
// ============================================================
initDB().then(() => {
    server.listen(PORT, () => {
        console.log('\n==============================================');
        console.log('  DJ Musta Music Server');
        console.log('  http://localhost:' + PORT);
        console.log('==============================================');
        console.log(`  DB:    Supabase PostgreSQL\n`);
    });
}).catch(e => {
    console.error('Failed to connect to database:', e.message);
    process.exit(1);
});


