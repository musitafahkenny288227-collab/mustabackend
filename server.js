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

// ============================================================
// CONFIG
// ============================================================
const PORT         = process.env.PORT || 5000;
const JWT_SECRET   = process.env.JWT_SECRET || 'djmusta_secret_2026';
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_6BkZsUCnzt5P@ep-blue-wildflower-axfofbmw.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '4fb9c546cc898314c24d358bb3360f92';
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY || '39a9cb99d771c9e24a8395047397161f';
const R2_SECRET_KEY = process.env.R2_SECRET_KEY || 'bb14b1dc7a838036ecb6fb8fcfd3e171c510e371618c65cc27071865506d9050';
const R2_BUCKET     = process.env.R2_BUCKET     || 'djmusta-music';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-1004f9c2790e44689198e9849c00fb9b.r2.dev';
const R2_ENDPOINT   = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const UPLOADS = path.join(__dirname, 'uploads');

// Warn if using default JWT secret in production
if (JWT_SECRET === 'djmusta_secret_2026' && process.env.NODE_ENV === 'production') {
    console.warn('⚠️  WARNING: Using default JWT_SECRET in production. Set JWT_SECRET env var!');
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
// FILE TYPE VALIDATION
// ============================================================
const ALLOWED_AUDIO = ['audio/mpeg','audio/mp3','audio/wav','audio/wave','audio/x-wav','audio/mp4','audio/m4a','audio/x-m4a'];
const ALLOWED_IMAGE = ['image/jpeg','image/jpg','image/png','image/webp','image/gif'];
const ALLOWED_AUDIO_EXT = ['.mp3','.wav','.m4a'];
const ALLOWED_IMAGE_EXT = ['.jpg','.jpeg','.png','.webp','.gif'];

function validateFile(fileObj, type) {
    if (!fileObj) return null;
    const ext  = path.extname(fileObj.filename).toLowerCase();
    const mime = fileObj.mimetype.toLowerCase();
    if (type === 'audio') {
        if (!ALLOWED_AUDIO.includes(mime) && !ALLOWED_AUDIO_EXT.includes(ext))
            return 'Invalid audio file. Only MP3, WAV, M4A allowed.';
    } else if (type === 'image') {
        if (!ALLOWED_IMAGE.includes(mime) && !ALLOWED_IMAGE_EXT.includes(ext))
            return 'Invalid image file. Only JPG, PNG, WEBP allowed.';
    }
    // Check file size: audio max 50MB, image max 5MB
    const maxSize = type === 'audio' ? 50 * 1024 * 1024 : 5 * 1024 * 1024;
    if (fileObj.data.length > maxSize)
        return `File too large. Max ${type === 'audio' ? '50MB' : '5MB'}.`;
    return null;
}

// ============================================================
// DATABASE
// ============================================================
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
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

    // Seed admin
    const admin = await query('SELECT id FROM users WHERE is_admin = TRUE LIMIT 1');
    if (admin.rows.length === 0) {
        const hashed = hashPassword('28822722MUSTA');
        await query(
            'INSERT INTO users (username, email, password, is_admin) VALUES ($1,$2,$3,TRUE) ON CONFLICT DO NOTHING',
            ['admin', 'musitafahkenny288227@gmail.com', hashed]
        );
        console.log('✅ Admin created: musitafahkenny288227@gmail.com / 28822722MUSTA');
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
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
        setTimeout(() => resolve(Buffer.concat(chunks)), 60000);
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

    // Rate limiting — 60 requests per minute per IP
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

    if (pathname.startsWith('/uploads/')) {
        return serveStatic(req, res, path.join(__dirname, pathname), origin);
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

    // ── GET /api/health ──────────────────────────────────────
    if (pathname === '/api/health') return J(200, { status:'ok', uptime: process.uptime() });

    // ── POST /api/auth/register ──────────────────────────────
    if (method === 'POST' && pathname === '/api/auth/register') {
        if (authRateLimit(ip)) return J(429, { error: 'Too many attempts. Try again in a minute.' });
        const { username, email, password } = await parseJSON(req);
        if (!username || !email || !password) return J(400, { error:'All fields required' });
        if (username.length < 3) return J(400, { error:'Username must be at least 3 characters' });
        if (password.length < 6) return J(400, { error:'Password must be at least 6 characters' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return J(400, { error:'Invalid email' });
        const exists = await query('SELECT id FROM users WHERE email=$1 OR username=$2', [email, username]);
        if (exists.rows.length) return J(409, { error:'Email or username already taken' });
        const r = await query('INSERT INTO users (username,email,password) VALUES ($1,$2,$3) RETURNING *', [username, email, hashPassword(password)]);
        const u = r.rows[0];
        const token = signJWT({ id:u.id, username:u.username, email:u.email, isAdmin:false });
        return J(201, { token, user: pub(u) });
    }

    // ── POST /api/auth/login ─────────────────────────────────
    if (method === 'POST' && pathname === '/api/auth/login') {
        if (authRateLimit(ip)) return J(429, { error: 'Too many attempts. Try again in a minute.' });
        const { email, password } = await parseJSON(req);
        if (!email || !password) return J(400, { error:'Email and password required' });
        const r = await query('SELECT * FROM users WHERE email=$1', [email]);
        const u = r.rows[0];
        if (!u || !verifyPassword(password, u.password)) return J(401, { error:'Invalid email or password' });
        const token = signJWT({ id:u.id, username:u.username, email:u.email, isAdmin:!!u.is_admin });
        return J(200, { token, user: pub(u) });
    }

    // ── GET /api/auth/me ─────────────────────────────────────
    if (method === 'GET' && pathname === '/api/auth/me') {
        if (!user) return J(401, { error:'Unauthorized' });
        const r = await query('SELECT * FROM users WHERE id=$1', [user.id]);
        if (!r.rows[0]) return J(404, { error:'User not found' });
        return J(200, pub(r.rows[0]));
    }

    // ── POST /api/auth/change-password ───────────────────────
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

    // ── GET /api/stats ───────────────────────────────────────
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

    // ── GET /api/songs ───────────────────────────────────────
    if (method === 'GET' && pathname === '/api/songs') {
        const q        = parsed.searchParams;
        const category = q.get('category') || 'all';
        const search   = q.get('search') || '';
        const genre    = q.get('genre') || '';
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

        const orderMap = { new:'created_at DESC', trending:'play_count DESC', top:'like_count DESC' };
        const order = orderMap[category] || 'created_at DESC';

        // Count query — no ORDER BY
        const total = await query(`SELECT COUNT(*) FROM songs ${where}`, params);

        // Data query — with ORDER BY, LIMIT, OFFSET
        const dataParams = [...params, limit, offset];
        const songs = await query(
            `SELECT * FROM songs ${where} ORDER BY ${order} LIMIT $${idx} OFFSET $${idx+1}`,
            dataParams
        );

        const likedIds = user ? (await query('SELECT song_id FROM likes WHERE user_id=$1', [user.id])).rows.map(r => r.song_id) : [];

        return J(200, {
            songs: songs.rows.map(s => ({ ...s, liked: likedIds.includes(s.id) })),
            total: parseInt(total.rows[0].count),
            offset, limit
        });
    }

    // ── GET /api/songs/admin/pending ─────────────────────────
    if (method === 'GET' && pathname === '/api/songs/admin/pending') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const r = await query(`SELECT s.*, u.username AS uploader_name FROM songs s LEFT JOIN users u ON s.uploaded_by=u.id WHERE s.approved=FALSE ORDER BY s.created_at DESC`);
        return J(200, { songs: r.rows });
    }

    // ── GET /api/songs/admin/users ───────────────────────────
    if (method === 'GET' && pathname === '/api/songs/admin/users') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const r = await query('SELECT * FROM users ORDER BY created_at DESC');
        return J(200, { users: r.rows.map(pub) });
    }

    // ── GET /api/songs/likes/mine ────────────────────────────
    if (method === 'GET' && pathname === '/api/songs/likes/mine') {
        if (!user) return J(401, { error:'Unauthorized' });
        const r = await query(`SELECT s.* FROM songs s INNER JOIN likes l ON l.song_id=s.id WHERE l.user_id=$1 AND s.approved=TRUE ORDER BY l.created_at DESC`, [user.id]);
        return J(200, { songs: r.rows.map(s => ({ ...s, liked: true })) });
    }

    // ── GET /api/songs/:id ───────────────────────────────────
    if (method === 'GET' && seg[0]==='songs' && seg[1] && !isNaN(seg[1]) && !seg[2]) {
        const r = await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Song not found' });
        const song = r.rows[0];
        await query('UPDATE songs SET play_count=play_count+1 WHERE id=$1', [song.id]);
        await query('INSERT INTO plays (user_id,song_id,ip) VALUES ($1,$2,$3)', [user?.id||null, song.id, ip]);
        return J(200, { ...song, play_count: song.play_count + 1 });
    }

    // ── POST /api/songs ──────────────────────────────────────
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
        try {
            filePath  = await r2Upload(files.song,  'songs');
            coverPath = files.cover ? await r2Upload(files.cover, 'covers') : null;
        } catch(e) {
            console.error('[R2 failed, using local]', e.message);
            filePath  = saveLocal(files.song,  'songs');
            coverPath = files.cover ? saveLocal(files.cover, 'covers') : null;
        }

        const r = await query(
            'INSERT INTO songs (title,artist,genre,duration,lyrics,file_path,cover_path,uploaded_by,approved) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
            [title.trim(), artist.trim(), genre||'Other', duration||'3:00', lyrics||'', filePath, coverPath, user.id, !!user.isAdmin]
        );
        return J(201, r.rows[0]);
    }

    // ── DELETE /api/songs/:id ────────────────────────────────
    if (method === 'DELETE' && seg[0]==='songs' && seg[1] && !seg[2]) {
        if (!user) return J(401, { error:'Unauthorized' });
        const r = await query('SELECT * FROM songs WHERE id=$1', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Song not found' });
        const song = r.rows[0];
        if (!user.isAdmin && song.uploaded_by !== user.id) return J(403, { error:'Forbidden' });
        await query('DELETE FROM songs WHERE id=$1', [seg[1]]);
        return J(200, { success:true });
    }
    if (method === 'PATCH' && seg[0]==='songs' && seg[2]==='approve') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        await query('UPDATE songs SET approved=TRUE WHERE id=$1', [seg[1]]);
        return J(200, { success:true });
    }

    // ── PATCH /api/songs/:id/reject ──────────────────────────
    if (method === 'PATCH' && seg[0]==='songs' && seg[2]==='reject') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        await query('UPDATE songs SET approved=FALSE WHERE id=$1', [seg[1]]);
        return J(200, { success:true });
    }

    // ── POST /api/songs/:id/like ─────────────────────────────
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

    // ── POST /api/songs/:id/download ─────────────────────────
    if (method === 'POST' && seg[0]==='songs' && seg[2]==='download') {
        const r = await query('SELECT * FROM songs WHERE id=$1 AND approved=TRUE', [seg[1]]);
        if (!r.rows[0]) return J(404, { error:'Not found' });
        await query('UPDATE songs SET download_count=download_count+1 WHERE id=$1', [seg[1]]);
        await query('INSERT INTO downloads (user_id,song_id,ip) VALUES ($1,$2,$3)', [user?.id||null, seg[1], ip]);
        return J(200, { success:true });
    }

    // ── PATCH /api/songs/admin/users/:id/admin ───────────────
    if (method === 'PATCH' && seg[0]==='songs' && seg[1]==='admin' && seg[2]==='users' && seg[4]==='admin') {
        if (!user?.isAdmin) return J(403, { error:'Admin only' });
        const body = await parseJSON(req);
        await query('UPDATE users SET is_admin=$1 WHERE id=$2', [!!body.isAdmin, seg[3]]);
        return J(200, { success:true });
    }

    J(404, { error:'Endpoint not found' });
}

// Public user object
function pub(u) {
    return { id:u.id, username:u.username, email:u.email, isAdmin:!!u.is_admin, createdAt:u.created_at };
}

// ============================================================
// START
// ============================================================
initDB().then(() => {
    server.listen(PORT, () => {
        console.log('\n╔══════════════════════════════════════════╗');
        console.log(`║  🎧  DJ Musta Music Server               ║`);
        console.log(`║  http://localhost:${PORT}                   ║`);
        console.log('╚══════════════════════════════════════════╝');
        console.log(`\n  Admin: musitafahkenny288227@gmail.com / 28822722MUSTA`);
        console.log(`  DB:    Supabase PostgreSQL\n`);
    });
}).catch(e => {
    console.error('Failed to connect to database:', e.message);
    process.exit(1);
});
