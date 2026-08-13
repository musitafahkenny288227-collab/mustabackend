// ============================================================
// DJ MUSTA MUSIC - ZERO DEPENDENCY SERVER
// Pure Node.js built-ins only: http, fs, path, crypto, url
// Run: node server.js
// ============================================================
'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT         = process.env.PORT || 5000;
const JWT_SECRET   = process.env.JWT_SECRET || 'djmusta_secret_2026_change_me';
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

// All data lives next to server.js inside backend/
// On Render this is the deployed app directory — persistent across restarts
// (Render does NOT wipe the app directory between restarts, only between deploys)
const DB_FILE = path.join(__dirname, 'djmusta.json');
const UPLOADS = path.join(__dirname, 'uploads');
const ROOT    = path.join(__dirname, '..');

// ============================================================
// JSON DATABASE (flat file, no SQLite needed)
// ============================================================
let DB = { users: [], songs: [], likes: [], plays: [], downloads: [] };

function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        // ensure all tables exist
        ['users','songs','likes','plays','downloads'].forEach(t => { if (!DB[t]) DB[t] = []; });
    } catch(e) { console.error('DB load error:', e.message); }
}

function saveDB() {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2)); } catch(e) { console.error('DB save error:', e.message); }
}

function nextId(table) {
    const arr = DB[table];
    return arr.length ? Math.max(...arr.map(r => r.id)) + 1 : 1;
}

loadDB();

// Ensure upload directories exist
['songs', 'covers'].forEach(d => {
    const dir = path.join(UPLOADS, d);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ============================================================
// SEED ADMIN
// ============================================================
if (!DB.users.find(u => u.isAdmin)) {
    DB.users.push({
        id: nextId('users'), username: 'admin',
        email: 'admin@djmusta.com',
        password: hashPassword('admin123'),
        isAdmin: true, createdAt: new Date().toISOString()
    });
    console.log('✅ Admin created: admin@djmusta.com / admin123');
    saveDB();
}

// ============================================================
// SEED EXISTING UPLOAD FILES
// ============================================================
(function seedSongs() {
    const songsDir  = path.join(UPLOADS, 'songs');
    const coversDir = path.join(UPLOADS, 'covers');
    if (!fs.existsSync(songsDir)) return;

    const songFiles  = fs.readdirSync(songsDir).filter(f => /\.(mp3|wav|m4a)$/i.test(f));
    const coverFiles = fs.existsSync(coversDir)
        ? fs.readdirSync(coversDir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
        : [];

    songFiles.forEach((file, i) => {
        const filePath = `/uploads/songs/${file}`;
        if (DB.songs.find(s => s.file_path === filePath)) return;
        const nameNoExt = file.replace(/^\d+-/, '').replace(/\.[^.]+$/, '');
        const parts     = nameNoExt.split('-');
        const title     = decodeURIComponent((parts[0] || nameNoExt).replace(/_/g,' ')).trim();
        const artist    = decodeURIComponent((parts[1] || 'Unknown Artist').replace(/_/g,' ')).trim();
        const coverPath = coverFiles[i] ? `/uploads/covers/${coverFiles[i]}` : null;
        DB.songs.push({
            id: nextId('songs'), title, artist, genre: 'Afrobeat',
            duration: '3:00', lyrics: '', file_path: filePath,
            cover_path: coverPath, uploaded_by: 1,
            play_count: 0, download_count: 0, like_count: 0,
            approved: true, createdAt: new Date().toISOString()
        });
        console.log(`✅ Seeded: "${title}" by ${artist}`);
    });
    saveDB();
})();

// ============================================================
// CRYPTO HELPERS (no bcrypt — use PBKDF2 via built-in crypto)
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
// JWT HELPERS (HMAC-SHA256, no library)
// ============================================================
function b64url(str) { return Buffer.from(str).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }
function b64decode(str) { return Buffer.from(str.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'); }

function signJWT(payload) {
    const header  = b64url(JSON.stringify({ alg:'HS256', typ:'JWT' }));
    const body    = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 60*60*24*7 }));
    const sig     = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
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
// HTTP HELPERS
// ============================================================
function corsHeaders() {
    return {
        'Access-Control-Allow-Origin':  FRONTEND_URL === '*' ? '*' : FRONTEND_URL,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': 'true'
    };
}

function json(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        ...corsHeaders(),
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
    });
}

function parseJSON(req) {
    return readBody(req).then(buf => {
        try { return JSON.parse(buf.toString()); } catch { return {}; }
    });
}

// ============================================================
// MULTIPART PARSER (for file uploads, no multer)
// ============================================================
function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const ct = req.headers['content-type'] || '';
        const boundaryMatch = ct.match(/boundary=(.+)/);
        if (!boundaryMatch) return reject(new Error('No boundary'));
        const boundary = '--' + boundaryMatch[1].trim();

        readBody(req).then(buf => {
            const fields = {};
            const files  = {};

            const sep     = Buffer.from('\r\n');
            const bound   = Buffer.from(boundary);
            const endBound = Buffer.from(boundary + '--');

            let pos = 0;
            while (pos < buf.length) {
                // find boundary
                const bStart = indexOf(buf, bound, pos);
                if (bStart === -1) break;
                pos = bStart + bound.length;
                if (buf.slice(pos, pos+2).toString() === '--') break;
                pos += 2; // skip \r\n after boundary

                // read headers
                const headEnd = indexOf(buf, Buffer.from('\r\n\r\n'), pos);
                if (headEnd === -1) break;
                const headStr = buf.slice(pos, headEnd).toString();
                pos = headEnd + 4;

                // find next boundary
                const nextBound = indexOf(buf, bound, pos);
                const partData  = nextBound === -1 ? buf.slice(pos) : buf.slice(pos, nextBound - 2);
                pos = nextBound === -1 ? buf.length : nextBound;

                // parse headers
                const dispMatch    = headStr.match(/Content-Disposition:[^\r\n]*name="([^"]+)"/i);
                const filenameMatch = headStr.match(/filename="([^"]+)"/i);
                const ctMatch      = headStr.match(/Content-Type:\s*([^\r\n]+)/i);
                if (!dispMatch) continue;
                const fieldName = dispMatch[1];

                if (filenameMatch) {
                    files[fieldName] = {
                        filename: filenameMatch[1],
                        mimetype: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
                        data: partData
                    };
                } else {
                    fields[fieldName] = partData.toString();
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

function saveUpload(fileObj, folder) {
    if (!fileObj) return null;
    const dir  = path.join(UPLOADS, folder);
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
    '.html':'text/html', '.css':'text/css', '.js':'application/javascript',
    '.json':'application/json', '.mp3':'audio/mpeg', '.wav':'audio/wav',
    '.m4a':'audio/mp4', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
    '.png':'image/png', '.webp':'image/webp', '.gif':'image/gif',
    '.ico':'image/x-icon', '.svg':'image/svg+xml', '.txt':'text/plain'
};

function serveStatic(req, res, filePath) {
    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            // SPA fallback
            const index = path.join(ROOT, 'index.html');
            fs.readFile(index, (e2, data) => {
                if (e2) { res.writeHead(404); res.end('Not found'); return; }
                res.writeHead(200, { 'Content-Type':'text/html', ...corsHeaders() });
                res.end(data);
            });
            return;
        }
        const ext  = path.extname(filePath).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        const isAudio = mime.startsWith('audio/');

        // Range support for audio streaming
        if (isAudio && req.headers.range) {
            const total = stat.size;
            const [s, e] = req.headers.range.replace(/bytes=/, '').split('-');
            const start = parseInt(s, 10);
            const end   = e ? parseInt(e, 10) : Math.min(start + 1024*1024 - 1, total - 1);
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${total}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': end - start + 1,
                'Content-Type': mime
            });
            fs.createReadStream(filePath, { start, end }).pipe(res);
            return;
        }

        res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': stat.size,
            'Accept-Ranges': 'bytes',
            'Cache-Control': isAudio ? 'public,max-age=3600' : 'no-cache',
            ...corsHeaders()
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

// ============================================================
// ROUTER
// ============================================================
const server = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders());
        return res.end();
    }

    const parsed   = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = parsed.pathname;
    const method   = req.method;
    const ip       = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // ── API routes ──────────────────────────────────────────
    if (pathname.startsWith('/api/')) {
        try {
            await handleAPI(req, res, pathname, method, parsed, ip);
        } catch(e) {
            console.error('[API Error]', e);
            json(res, 500, { error: 'Internal server error' });
        }
        return;
    }

    // ── Static files ────────────────────────────────────────
    // uploads/
    if (pathname.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, pathname);
        return serveStatic(req, res, filePath);
    }

    // everything else → ROOT (WEBSITE/)
    let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
    serveStatic(req, res, filePath);
});

// ============================================================
// API HANDLER
// ============================================================
async function handleAPI(req, res, pathname, method, parsed, ip) {
    const seg = pathname.replace('/api/', '').split('/'); // e.g. ['songs','5','like']
    const user = getUser(req);

    // ── POST /api/auth/register ──────────────────────────────
    if (method === 'POST' && pathname === '/api/auth/register') {
        const { username, email, password } = await parseJSON(req);
        if (!username || !email || !password) return json(res, 400, { error: 'All fields required' });
        if (username.length < 3)  return json(res, 400, { error: 'Username must be at least 3 characters' });
        if (password.length < 6)  return json(res, 400, { error: 'Password must be at least 6 characters' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Invalid email' });
        if (DB.users.find(u => u.email === email || u.username === username))
            return json(res, 409, { error: 'Email or username already taken' });

        const u = { id: nextId('users'), username, email, password: hashPassword(password),
                    isAdmin: false, createdAt: new Date().toISOString() };
        DB.users.push(u); saveDB();
        const token = signJWT({ id: u.id, username, email, isAdmin: false });
        return json(res, 201, { token, user: pub(u) });
    }

    // ── POST /api/auth/login ─────────────────────────────────
    if (method === 'POST' && pathname === '/api/auth/login') {
        const { email, password } = await parseJSON(req);
        if (!email || !password) return json(res, 400, { error: 'Email and password required' });
        const u = DB.users.find(u => u.email === email);
        if (!u || !verifyPassword(password, u.password))
            return json(res, 401, { error: 'Invalid email or password' });
        const token = signJWT({ id: u.id, username: u.username, email: u.email, isAdmin: !!u.isAdmin });
        return json(res, 200, { token, user: pub(u) });
    }

    // ── GET /api/auth/me ─────────────────────────────────────
    if (method === 'GET' && pathname === '/api/auth/me') {
        if (!user) return json(res, 401, { error: 'Unauthorized' });
        const u = DB.users.find(u => u.id === user.id);
        if (!u) return json(res, 404, { error: 'User not found' });
        return json(res, 200, pub(u));
    }

    // ── GET /api/stats ───────────────────────────────────────
    if (method === 'GET' && pathname === '/api/stats') {
        const approved = DB.songs.filter(s => s.approved);
        return json(res, 200, {
            songs:     approved.length,
            artists:   new Set(approved.map(s => s.artist)).size,
            plays:     approved.reduce((a,s) => a + (s.play_count||0), 0),
            downloads: approved.reduce((a,s) => a + (s.download_count||0), 0),
            likes:     approved.reduce((a,s) => a + (s.like_count||0), 0),
            users:     DB.users.length,
            pending:   DB.songs.filter(s => !s.approved).length
        });
    }

    // ── GET /api/songs ───────────────────────────────────────
    if (method === 'GET' && pathname === '/api/songs') {
        const q        = parsed.searchParams;
        const category = q.get('category') || 'all';
        const search   = (q.get('search') || '').toLowerCase();
        const genre    = (q.get('genre')  || '').toLowerCase();
        const limit    = Math.min(parseInt(q.get('limit')  || 20), 100);
        const offset   = parseInt(q.get('offset') || 0);

        let songs = DB.songs.filter(s => s.approved);
        if (search) songs = songs.filter(s => s.title.toLowerCase().includes(search) || s.artist.toLowerCase().includes(search));
        if (genre)  songs = songs.filter(s => (s.genre||'').toLowerCase() === genre);

        if (category === 'new')      songs.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
        else if (category === 'trending') songs.sort((a,b) => (b.play_count||0) - (a.play_count||0));
        else if (category === 'top')      songs.sort((a,b) => (b.like_count||0)  - (a.like_count||0));
        else songs.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

        const total  = songs.length;
        const paged  = songs.slice(offset, offset + limit);
        const likedIds = user ? DB.likes.filter(l => l.user_id === user.id).map(l => l.song_id) : [];

        return json(res, 200, {
            songs: paged.map(s => ({ ...s, password: undefined, liked: likedIds.includes(s.id) })),
            total, offset, limit
        });
    }

    // ── GET /api/songs/admin/pending ─────────────────────────
    if (method === 'GET' && pathname === '/api/songs/admin/pending') {
        if (!user?.isAdmin) return json(res, 403, { error: 'Admin only' });
        const songs = DB.songs.filter(s => !s.approved).map(s => {
            const uploader = DB.users.find(u => u.id === s.uploaded_by);
            return { ...s, uploader_name: uploader?.username || 'Unknown' };
        });
        return json(res, 200, { songs });
    }

    // ── GET /api/songs/admin/users ───────────────────────────
    if (method === 'GET' && pathname === '/api/songs/admin/users') {
        if (!user?.isAdmin) return json(res, 403, { error: 'Admin only' });
        return json(res, 200, { users: DB.users.map(pub) });
    }

    // ── GET /api/songs/likes/mine ────────────────────────────
    if (method === 'GET' && pathname === '/api/songs/likes/mine') {
        if (!user) return json(res, 401, { error: 'Unauthorized' });
        const likedIds = DB.likes.filter(l => l.user_id === user.id).map(l => l.song_id);
        const songs    = DB.songs.filter(s => s.approved && likedIds.includes(s.id));
        return json(res, 200, { songs: songs.map(s => ({ ...s, liked: true })) });
    }

    // ── GET /api/songs/:id ───────────────────────────────────
    if (method === 'GET' && seg[0] === 'songs' && seg[1] && !isNaN(seg[1]) && !seg[2]) {
        const song = DB.songs.find(s => s.id === parseInt(seg[1]) && s.approved);
        if (!song) return json(res, 404, { error: 'Song not found' });
        song.play_count = (song.play_count || 0) + 1;
        DB.plays.push({ id: nextId('plays'), song_id: song.id, user_id: user?.id||null, ip, createdAt: new Date().toISOString() });
        saveDB();
        return json(res, 200, song);
    }

    // ── POST /api/songs (upload) ─────────────────────────────
    if (method === 'POST' && pathname === '/api/songs') {
        if (!user) return json(res, 401, { error: 'Login required' });
        const ct = req.headers['content-type'] || '';
        if (!ct.includes('multipart/form-data')) return json(res, 400, { error: 'Multipart required' });

        const { fields, files } = await parseMultipart(req);
        const { title, artist, genre, duration, lyrics } = fields;
        if (!title?.trim())  return json(res, 400, { error: 'Title required' });
        if (!artist?.trim()) return json(res, 400, { error: 'Artist required' });
        if (!files.song)     return json(res, 400, { error: 'Audio file required' });

        const filePath  = saveUpload(files.song,  'songs');
        const coverPath = files.cover ? saveUpload(files.cover, 'covers') : null;
        const song = {
            id: nextId('songs'), title: title.trim(), artist: artist.trim(),
            genre: genre || 'Other', duration: duration || '3:00',
            lyrics: lyrics || '', file_path: filePath, cover_path: coverPath,
            uploaded_by: user.id, play_count: 0, download_count: 0, like_count: 0,
            approved: !!user.isAdmin, createdAt: new Date().toISOString()
        };
        DB.songs.push(song); saveDB();
        return json(res, 201, song);
    }

    // ── DELETE /api/songs/:id ────────────────────────────────
    if (method === 'DELETE' && seg[0] === 'songs' && seg[1] && !seg[2]) {
        if (!user) return json(res, 401, { error: 'Unauthorized' });
        const idx = DB.songs.findIndex(s => s.id === parseInt(seg[1]));
        if (idx === -1) return json(res, 404, { error: 'Song not found' });
        const song = DB.songs[idx];
        if (!user.isAdmin && song.uploaded_by !== user.id) return json(res, 403, { error: 'Forbidden' });
        [song.file_path, song.cover_path].forEach(fp => {
            if (!fp) return;
            const abs = path.join(__dirname, fp);
            try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch {}
        });
        DB.songs.splice(idx, 1); saveDB();
        return json(res, 200, { success: true });
    }

    // ── PATCH /api/songs/:id/approve ─────────────────────────
    if (method === 'PATCH' && seg[0] === 'songs' && seg[2] === 'approve') {
        if (!user?.isAdmin) return json(res, 403, { error: 'Admin only' });
        const song = DB.songs.find(s => s.id === parseInt(seg[1]));
        if (!song) return json(res, 404, { error: 'Not found' });
        song.approved = true; saveDB();
        return json(res, 200, { success: true });
    }

    // ── PATCH /api/songs/:id/reject ──────────────────────────
    if (method === 'PATCH' && seg[0] === 'songs' && seg[2] === 'reject') {
        if (!user?.isAdmin) return json(res, 403, { error: 'Admin only' });
        const song = DB.songs.find(s => s.id === parseInt(seg[1]));
        if (!song) return json(res, 404, { error: 'Not found' });
        song.approved = false; saveDB();
        return json(res, 200, { success: true });
    }

    // ── POST /api/songs/:id/like ─────────────────────────────
    if (method === 'POST' && seg[0] === 'songs' && seg[2] === 'like') {
        if (!user) return json(res, 401, { error: 'Login required' });
        const songId = parseInt(seg[1]);
        const song   = DB.songs.find(s => s.id === songId && s.approved);
        if (!song) return json(res, 404, { error: 'Not found' });
        const idx = DB.likes.findIndex(l => l.user_id === user.id && l.song_id === songId);
        if (idx !== -1) {
            DB.likes.splice(idx, 1);
            song.like_count = Math.max(0, (song.like_count||0) - 1);
            saveDB();
            return json(res, 200, { liked: false, likeCount: song.like_count });
        } else {
            DB.likes.push({ id: nextId('likes'), user_id: user.id, song_id: songId, createdAt: new Date().toISOString() });
            song.like_count = (song.like_count||0) + 1;
            saveDB();
            return json(res, 200, { liked: true, likeCount: song.like_count });
        }
    }

    // ── POST /api/songs/:id/download ─────────────────────────
    if (method === 'POST' && seg[0] === 'songs' && seg[2] === 'download') {
        const song = DB.songs.find(s => s.id === parseInt(seg[1]) && s.approved);
        if (!song) return json(res, 404, { error: 'Not found' });
        song.download_count = (song.download_count||0) + 1;
        DB.downloads.push({ id: nextId('downloads'), song_id: song.id, user_id: user?.id||null, ip, createdAt: new Date().toISOString() });
        saveDB();
        return json(res, 200, { success: true, downloadCount: song.download_count });
    }

    // ── PATCH /api/songs/admin/users/:id/admin ───────────────
    if (method === 'PATCH' && seg[0]==='songs' && seg[1]==='admin' && seg[2]==='users' && seg[4]==='admin') {
        if (!user?.isAdmin) return json(res, 403, { error: 'Admin only' });
        const u = DB.users.find(u => u.id === parseInt(seg[3]));
        if (!u) return json(res, 404, { error: 'User not found' });
        const body = await parseJSON(req);
        u.isAdmin = !!body.isAdmin; saveDB();
        return json(res, 200, { success: true });
    }

    // ── /api/health ──────────────────────────────────────────
    if (pathname === '/api/health') return json(res, 200, { status: 'ok', uptime: process.uptime() });

    json(res, 404, { error: 'API endpoint not found' });
}

// Public user object (no password)
function pub(u) {
    return { id: u.id, username: u.username, email: u.email, isAdmin: !!u.isAdmin, createdAt: u.createdAt };
}

// ============================================================
// START
// ============================================================
server.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log(`║  🎧  DJ Musta Music Server               ║`);
    console.log(`║  http://localhost:${PORT}                   ║`);
    console.log('╚══════════════════════════════════════════╝');
    console.log(`\n  Admin: admin@djmusta.com / admin123`);
    console.log(`  DB:    backend/djmusta.json\n`);
});
