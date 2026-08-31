// ============================================================
// ADVANCED FEATURES FOR DJ MUSTA
// Complete Professional Music Platform
// ============================================================

// ============================================================
// 1. PLAYLIST MANAGEMENT SYSTEM
// ============================================================

class PlaylistManager {
    constructor() {
        this.playlists = JSON.parse(localStorage.getItem('playlists') || '[]');
        this.currentPlaylist = null;
    }

    createPlaylist(name, description = '') {
        const playlist = {
            id: Date.now(),
            name: name,
            description: description,
            songs: [],
            createdAt: new Date().toISOString(),
            cover: null,
            isPublic: false
        };
        this.playlists.push(playlist);
        this.save();
        showToast('✅ Playlist created: ' + name);
        return playlist;
    }

    addToPlaylist(playlistId, song) {
        const playlist = this.playlists.find(p => p.id === playlistId);
        if (playlist) {
            if (!playlist.songs.find(s => s.id === song.id)) {
                playlist.songs.push(song);
                this.save();
                showToast(`✅ Added to ${playlist.name}`);
            } else {
                showToast('⚠️ Song already in playlist');
            }
        }
    }

    removeFromPlaylist(playlistId, songId) {
        const playlist = this.playlists.find(p => p.id === playlistId);
        if (playlist) {
            playlist.songs = playlist.songs.filter(s => s.id !== songId);
            this.save();
            showToast('✅ Removed from playlist');
        }
    }

    deletePlaylist(playlistId) {
        this.playlists = this.playlists.filter(p => p.id !== playlistId);
        this.save();
        showToast('✅ Playlist deleted');
    }

    sharePlaylist(playlistId) {
        const playlist = this.playlists.find(p => p.id === playlistId);
        if (!playlist) return;

        const songList = playlist.songs.map((s, i) => `${i + 1}. ${s.title} - ${s.artist}`).join('\n');
        const text = `🎵 Check out my playlist "${playlist.name}" on DJ Musta!\n\n${songList}\n\n🔗 ${window.location.origin}?playlist=${playlistId}`;
        
        const shareModal = `
            <div style="position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px" onclick="this.remove()">
                <div style="background:var(--card);border-radius:20px;padding:30px;max-width:500px;width:100%" onclick="event.stopPropagation()">
                    <h3 style="font-size:22px;font-weight:700;margin-bottom:20px">📤 Share Playlist</h3>
                    <div style="display:grid;gap:12px">
                        <a href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" style="padding:14px 20px;background:#25D366;color:white;border-radius:10px;text-align:center;font-weight:600;font-size:15px">📱 WhatsApp</a>
                        <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.origin + '?playlist=' + playlistId)}" target="_blank" style="padding:14px 20px;background:#1877F2;color:white;border-radius:10px;text-align:center;font-weight:600;font-size:15px">📘 Facebook</a>
                        <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}" target="_blank" style="padding:14px 20px;background:#1DA1F2;color:white;border-radius:10px;text-align:center;font-weight:600;font-size:15px">🐦 Twitter</a>
                        <button onclick="copyToClipboard('${window.location.origin}?playlist=${playlistId}');showToast('✅ Link copied!');this.closest('[style*=fixed]').remove()" style="padding:14px 20px;background:var(--pink);color:white;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-size:15px">📋 Copy Link</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', shareModal);
    }

    save() {
        localStorage.setItem('playlists', JSON.stringify(this.playlists));
    }

    getAll() {
        return this.playlists;
    }

    getById(id) {
        return this.playlists.find(p => p.id === parseInt(id));
    }
}

window.playlistManager = new PlaylistManager();

// Show add to playlist modal
window.showAddToPlaylist = function(song) {
    const playlists = window.playlistManager.getAll();
    
    const modal = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px" onclick="this.remove()">
            <div style="background:var(--card);border-radius:20px;padding:30px;max-width:500px;width:100%;max-height:80vh;overflow-y:auto" onclick="event.stopPropagation()">
                <h3 style="font-size:22px;font-weight:700;margin-bottom:20px">➕ Add to Playlist</h3>
                
                <div style="margin-bottom:20px">
                    <input id="newPlaylistName" placeholder="New playlist name..." style="width:100%;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);margin-bottom:10px"/>
                    <button onclick="createAndAddToPlaylist('${song.id}')" style="width:100%;padding:12px;background:var(--pink);color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer">✨ Create New Playlist</button>
                </div>
                
                <div style="border-top:1px solid var(--border);padding-top:20px">
                    ${playlists.length === 0 ? '<p style="text-align:center;color:var(--muted);padding:20px">No playlists yet. Create one above!</p>' : ''}
                    ${playlists.map(p => `
                        <div onclick="window.playlistManager.addToPlaylist(${p.id}, ${JSON.stringify(song).replace(/"/g, '&quot;')});this.closest('[style*=fixed]').remove()" style="padding:12px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.2);border-radius:8px;margin-bottom:8px;cursor:pointer;transition:all 0.2s" onmouseover="this.style.background='rgba(168,85,247,0.2)'" onmouseout="this.style.background='rgba(168,85,247,0.1)'">
                            <div style="font-weight:600;margin-bottom:4px">${p.name}</div>
                            <div style="font-size:13px;color:var(--muted)">${p.songs.length} songs</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modal);
};

window.createAndAddToPlaylist = function(songId) {
    const name = document.getElementById('newPlaylistName').value.trim();
    if (!name) {
        showToast('⚠️ Please enter playlist name');
        return;
    }
    const playlist = window.playlistManager.createPlaylist(name);
    // Find song and add it
    const song = window.allSongs.find(s => s.id === songId);
    if (song) {
        window.playlistManager.addToPlaylist(playlist.id, song);
    }
    document.querySelector('[style*="position:fixed"]').remove();
};

// ============================================================
// 2. ANALYTICS DASHBOARD
// ============================================================

class AnalyticsDashboard {
    constructor() {
        this.stats = JSON.parse(localStorage.getItem('analytics') || '{}');
        if (!this.stats.visits) this.initStats();
    }

    initStats() {
        this.stats = {
            visits: [],
            plays: {},
            downloads: {},
            searches: {},
            dailyVisits: 0,
            lastReset: new Date().toDateString()
        };
        this.save();
    }

    trackVisit() {
        const today = new Date().toDateString();
        if (this.stats.lastReset !== today) {
            this.stats.dailyVisits = 0;
            this.stats.lastReset = today;
        }
        this.stats.dailyVisits++;
        this.stats.visits.push({ date: new Date().toISOString() });
        // Cap to last 500 visits to prevent localStorage from growing indefinitely
        if (this.stats.visits.length > 500) {
            this.stats.visits = this.stats.visits.slice(-500);
        }
        this.save();
    }

    trackPlay(songId) {
        this.stats.plays[songId] = (this.stats.plays[songId] || 0) + 1;
        this.save();
    }

    trackDownload(songId) {
        this.stats.downloads[songId] = (this.stats.downloads[songId] || 0) + 1;
        this.save();
    }

    trackSearch(term) {
        this.stats.searches[term] = (this.stats.searches[term] || 0) + 1;
        this.save();
    }

    getTopSongs(type = 'plays', limit = 10) {
        const data = this.stats[type];
        return Object.entries(data)
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([id, count]) => ({ id, count }));
    }

    getPopularSearches(limit = 10) {
        return Object.entries(this.stats.searches)
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit);
    }

    save() {
        localStorage.setItem('analytics', JSON.stringify(this.stats));
    }
}

window.analytics = new AnalyticsDashboard();
window.analytics.trackVisit();

// Show LOCAL analytics dashboard (client-side stats only).
// Named showLocalAnalytics to avoid overriding the real backend
// showAnalyticsDashboard defined in index.html.
window.showLocalAnalytics = function() {
    const topPlays = window.analytics.getTopSongs('plays', 5);
    const topDownloads = window.analytics.getTopSongs('downloads', 5);
    const topSearches = window.analytics.getPopularSearches(5);

    const dashboard = `
        <div style="padding:20px;max-width:1200px;margin:0 auto">
            <h2 style="font-size:28px;font-weight:800;margin-bottom:30px">📊 Local Analytics (This Device)</h2>
            
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px;margin-bottom:30px">
                <div style="background:linear-gradient(135deg,#a855f7,#9333ea);padding:24px;border-radius:16px;color:white">
                    <div style="font-size:14px;opacity:0.9;margin-bottom:8px">Today's Visitors</div>
                    <div style="font-size:36px;font-weight:800">${window.analytics.stats.dailyVisits}</div>
                </div>
                <div style="background:linear-gradient(135deg,#3b82f6,#2563eb);padding:24px;border-radius:16px;color:white">
                    <div style="font-size:14px;opacity:0.9;margin-bottom:8px">Total Plays</div>
                    <div style="font-size:36px;font-weight:800">${Object.values(window.analytics.stats.plays).reduce((a,b)=>a+b,0)}</div>
                </div>
                <div style="background:linear-gradient(135deg,#10b981,#059669);padding:24px;border-radius:16px;color:white">
                    <div style="font-size:14px;opacity:0.9;margin-bottom:8px">Total Downloads</div>
                    <div style="font-size:36px;font-weight:800">${Object.values(window.analytics.stats.downloads).reduce((a,b)=>a+b,0)}</div>
                </div>
                <div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:24px;border-radius:16px;color:white">
                    <div style="font-size:14px;opacity:0.9;margin-bottom:8px">Total Searches</div>
                    <div style="font-size:36px;font-weight:800">${Object.keys(window.analytics.stats.searches).length}</div>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:20px">
                <div style="background:var(--card);padding:24px;border-radius:16px;border:1px solid var(--border)">
                    <h3 style="font-size:18px;font-weight:700;margin-bottom:16px">🎵 Most Played</h3>
                    ${topPlays.map((item, i) => `
                        <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
                            <span>${i+1}. Song #${item.id}</span>
                            <span style="color:var(--pink);font-weight:600">${item.count} plays</span>
                        </div>
                    `).join('')}
                </div>

                <div style="background:var(--card);padding:24px;border-radius:16px;border:1px solid var(--border)">
                    <h3 style="font-size:18px;font-weight:700;margin-bottom:16px">📥 Most Downloaded</h3>
                    ${topDownloads.map((item, i) => `
                        <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
                            <span>${i+1}. Song #${item.id}</span>
                            <span style="color:var(--pink);font-weight:600">${item.count} downloads</span>
                        </div>
                    `).join('')}
                </div>

                <div style="background:var(--card);padding:24px;border-radius:16px;border:1px solid var(--border)">
                    <h3 style="font-size:18px;font-weight:700;margin-bottom:16px">🔍 Popular Searches</h3>
                    ${topSearches.map(([term, count], i) => `
                        <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
                            <span>${i+1}. ${term}</span>
                            <span style="color:var(--pink);font-weight:600">${count} searches</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
    
    const target = document.getElementById('songsGrid') || document.getElementById('mainContent') || document.body;
    target.innerHTML = dashboard;
};

// ============================================================
// 3. NOTIFICATION SYSTEM
// ============================================================

class NotificationSystem {
    constructor() {
        this.notifications = JSON.parse(localStorage.getItem('notifications') || '[]');
        this.requestPermission();
    }

    async requestPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission();
        }
    }

    add(title, message, type = 'info', actionUrl = null) {
        const notification = {
            id: Date.now(),
            title,
            message,
            type, // info, success, warning
            read: false,
            createdAt: new Date().toISOString(),
            actionUrl
        };
        
        this.notifications.unshift(notification);
        this.save();
        this.updateBadge();
        
        // Show browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, {
                body: message,
                icon: '/favicon.svg',
                badge: '/favicon.svg'
            });
        }
        
        return notification;
    }

    markAsRead(id) {
        const notif = this.notifications.find(n => n.id === id);
        if (notif) {
            notif.read = true;
            this.save();
            this.updateBadge();
        }
    }

    markAllAsRead() {
        this.notifications.forEach(n => n.read = true);
        this.save();
        this.updateBadge();
    }

    getUnreadCount() {
        return this.notifications.filter(n => !n.read).length;
    }

    updateBadge() {
        const count = this.getUnreadCount();
        const badge = document.getElementById('notifBadge');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'flex' : 'none';
        }
    }

    save() {
        localStorage.setItem('notifications', JSON.stringify(this.notifications));
    }
}

window.notificationSystem = new NotificationSystem();

// Show notifications panel
window.showNotifications = function() {
    const notifs = window.notificationSystem.notifications;
    
    const panel = `
        <div style="position:fixed;top:60px;right:20px;width:400px;max-width:calc(100vw - 40px);max-height:600px;background:var(--card);border:1px solid var(--border);border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,0.3);z-index:9999;overflow:hidden">
            <div style="padding:20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
                <h3 style="font-size:18px;font-weight:700">🔔 Notifications</h3>
                <div style="display:flex;gap:10px">
                    <button onclick="window.notificationSystem.markAllAsRead();showNotifications()" style="font-size:12px;background:rgba(168,85,247,0.1);color:var(--pink);border:none;padding:6px 12px;border-radius:6px;cursor:pointer">Mark all read</button>
                    <button onclick="document.getElementById('notifPanel').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer">&times;</button>
                </div>
            </div>
            <div style="max-height:500px;overflow-y:auto;padding:10px">
                ${notifs.length === 0 ? '<p style="text-align:center;color:var(--muted);padding:40px">No notifications</p>' : ''}
                ${notifs.map(n => `
                    <div onclick="window.notificationSystem.markAsRead(${n.id});this.style.opacity='0.6'" style="padding:16px;background:${n.read ? 'transparent' : 'rgba(168,85,247,0.1)'};border-radius:8px;margin-bottom:8px;cursor:pointer;border-left:3px solid ${n.type === 'success' ? '#10b981' : n.type === 'warning' ? '#f59e0b' : 'var(--pink)'}">
                        <div style="font-weight:600;margin-bottom:4px">${n.title}</div>
                        <div style="font-size:13px;color:var(--muted);margin-bottom:8px">${n.message}</div>
                        <div style="font-size:11px;color:var(--muted)">${new Date(n.createdAt).toLocaleString()}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    
    // Remove existing panel
    const existing = document.getElementById('notifPanel');
    if (existing) existing.remove();
    
    const div = document.createElement('div');
    div.id = 'notifPanel';
    div.innerHTML = panel;
    document.body.appendChild(div);
};

// ============================================================
// 4. ARTIST VERIFICATION SYSTEM
// ============================================================

// ============================================================
// 5. PREMIUM UPGRADE (WhatsApp contact — no payment processing)
// ============================================================
// showPremiumUpgrade is defined in index.html and handles this.

// ============================================================
// 6. MOBILE APP FEATURES (PWA)
// ============================================================

// Offline download mode
class OfflineManager {
    constructor() {
        this.downloads = JSON.parse(localStorage.getItem('offlineDownloads') || '[]');
    }

    async downloadForOffline(song) {
        try {
            const response = await fetch(song.audioUrl);
            const blob = await response.blob();
            const reader = new FileReader();
            
            reader.onloadend = () => {
                this.downloads.push({
                    ...song,
                    offlineData: reader.result,
                    downloadedAt: new Date().toISOString()
                });
                this.save();
                showToast('✅ Available offline!');
            };
            
            reader.readAsDataURL(blob);
        } catch (error) {
            showToast('❌ Offline download failed');
        }
    }

    getOfflineSongs() {
        return this.downloads;
    }

    save() {
        localStorage.setItem('offlineDownloads', JSON.stringify(this.downloads));
    }
}

window.offlineManager = new OfflineManager();

// PWA Install Prompt
window.showPWAInstall = function() {
    if (window.deferredPrompt) {
        window.deferredPrompt.prompt();
        window.deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                showToast('✅ App installed!');
            }
            window.deferredPrompt = null;
        });
    }
};

// Listen for PWA install event
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.deferredPrompt = e;
    
    // Show install banner
    const banner = `
        <div id="pwaInstallBanner" style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#a855f7,#3b82f6);padding:16px 24px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.4);z-index:9998;display:flex;align-items:center;gap:16px;max-width:400px;width:calc(100% - 40px)">
            <div style="flex:1;color:white">
                <div style="font-weight:700;margin-bottom:4px">📱 Install DJ Musta App</div>
                <div style="font-size:13px;opacity:0.9">Get the app for better experience!</div>
            </div>
            <button onclick="showPWAInstall()" style="background:white;color:var(--pink);border:none;padding:8px 16px;border-radius:6px;font-weight:600;cursor:pointer">Install</button>
            <button onclick="document.getElementById('pwaInstallBanner').remove()" style="background:rgba(255,255,255,0.2);color:white;border:none;padding:8px 12px;border-radius:6px;cursor:pointer">&times;</button>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', banner);
});

// ============================================================
// 7. AUDIO FEATURES (Visualizer)
// ============================================================

class AudioEnhancer {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
    }

    init(audioElement) {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaElementSource(audioElement);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            
            source.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
        }
    }

    startVisualizer(canvasId) {
        if (!this.analyser) return;
        
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const draw = () => {
            requestAnimationFrame(draw);
            this.analyser.getByteFrequencyData(dataArray);
            
            ctx.fillStyle = 'rgb(10, 14, 39)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            const barWidth = (canvas.width / bufferLength) * 2.5;
            let barHeight;
            let x = 0;
            
            for (let i = 0; i < bufferLength; i++) {
                barHeight = dataArray[i] / 2;
                
                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                gradient.addColorStop(0, '#a855f7');
                gradient.addColorStop(1, '#3b82f6');
                ctx.fillStyle = gradient;
                
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                x += barWidth + 1;
            }
        };
        
        draw();
    }
}

window.audioEnhancer = new AudioEnhancer();

// ============================================================
// 8. MULTI-LANGUAGE SUPPORT
// ============================================================

const uiTranslations = {
    en: {
        home: 'Home',
        search: 'Search songs, artists...',
        playlists: 'Playlists',
        downloads: 'Downloads',
        settings: 'Settings',
        newSongs: 'New Songs',
        trending: 'Trending',
        play: 'Play',
        download: 'Download',
        share: 'Share',
        like: 'Like'
    },
    lg: { // Luganda
        home: 'Awaka',
        search: 'Noonya ennyimba...',
        playlists: 'Olukalala',
        downloads: 'Ebiwankuliddwa',
        settings: 'Enteekateeka',
        newSongs: 'Ennyimba Empya',
        trending: 'Ezakaayimirira',
        play: 'Zanya',
        download: 'Wanula',
        share: 'Gabana',
        like: 'Siima'
    },
    sw: { // Swahili
        home: 'Nyumbani',
        search: 'Tafuta nyimbo...',
        playlists: 'Orodha',
        downloads: 'Pakua',
        settings: 'Mipangilio',
        newSongs: 'Nyimbo Mpya',
        trending: 'Maarufu',
        play: 'Cheza',
        download: 'Pakua',
        share: 'Shiriki',
        like: 'Penda'
    }
};

window.currentLanguage = localStorage.getItem('language') || 'en';

// window.t() — quick translation lookup using the uiTranslations table above.
// changeLanguage() and showLanguageSelector() are defined in index.html (uses
// language-support.js full implementation) and must NOT be overridden here.
window.t = function(key) {
    return uiTranslations[window.currentLanguage]?.[key] || uiTranslations.en[key] || key;
};

// ============================================================
// INITIALIZE ADVANCED FEATURES
// ============================================================

// ============================================================
// INITIALIZE ADVANCED FEATURES
// ============================================================

// Set default language
if (!window.currentLanguage) {
  window.currentLanguage = localStorage.getItem('language') || 'en';
}

// Helper functions for UI
window.openAddToPlaylist = function(songId, title) {
    const song = window.allSongs?.find(s => s.id === songId) || { id: songId, title: title };
    if (window.playlistManager) {
        showAddToPlaylist(song);
    } else {
        showToast('Playlists loading...');
    }
};

window.openShare = function(songId, title, artist) {
    const slugify = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    const titleSlug = slugify(title) || `song-${songId}`;
    const artistSlug = artist ? `/${slugify(artist)}` : '';
    const songUrl = `${window.location.origin}/song/${titleSlug}${artistSlug}`;
    window.shareData = { id: songId, title, artist, url: songUrl };
    const titleEl = document.getElementById('shareTitle');
    if (titleEl) titleEl.textContent = `"${title}" by ${artist}`;
    const modal = document.getElementById('shareModal');
    if (modal) modal.style.display = 'flex';
};

// Do NOT override navToPage here — the real version in index.html loads backend data.
// advanced-features.js page views are available via showPlaylistsPage etc. directly.

window.showPlaylistsPage = function() {
    if (!window.playlistManager) {
        showToast('Playlists loading...');
        return;
    }
    
    const playlists = window.playlistManager.getAll();
    const content = document.getElementById('songsGrid') || document.getElementById('mainContent');
    
    const html = `
        <div style="padding:20px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:30px">
                <h2 style="font-size:28px;font-weight:800">📋 My Playlists</h2>
                <button onclick="createNewPlaylist()" style="padding:12px 24px;background:var(--pink);color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer">➕ Create Playlist</button>
            </div>
            
            ${playlists.length === 0 ? `
                <div style="text-align:center;padding:80px 20px;color:var(--muted)">
                    <div style="font-size:64px;margin-bottom:20px">📋</div>
                    <h3 style="font-size:24px;margin-bottom:12px;color:var(--text)">No Playlists Yet</h3>
                    <p style="margin-bottom:24px">Create your first playlist to organize your favorite songs!</p>
                    <button onclick="createNewPlaylist()" style="padding:12px 32px;background:var(--pink);color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer">Create Playlist</button>
                </div>
            ` : `
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:20px">
                    ${playlists.map(p => `
                        <div onclick="viewPlaylist(${p.id})" style="background:var(--card);border-radius:16px;padding:20px;cursor:pointer;transition:transform 0.2s" onmouseover="this.style.transform='translateY(-4px)'" onmouseout="this.style.transform=''">
                            <div style="width:100%;aspect-ratio:1/1;background:linear-gradient(135deg,#a855f7,#3b82f6);border-radius:12px;margin-bottom:16px;display:flex;align-items:center;justify-content:center;font-size:48px">
                                🎵
                            </div>
                            <h3 style="font-size:16px;font-weight:700;margin-bottom:8px">${p.name}</h3>
                            <p style="font-size:13px;color:var(--muted)">${p.songs.length} songs</p>
                            <div style="display:flex;gap:8px;margin-top:12px">
                                <button onclick="event.stopPropagation();window.playlistManager.sharePlaylist(${p.id})" style="flex:1;padding:8px;background:rgba(168,85,247,0.1);border:1px solid var(--pink);color:var(--pink);border-radius:6px;font-size:12px;font-weight:600">📤 Share</button>
                                <button onclick="event.stopPropagation();deletePlaylist(${p.id})" style="padding:8px 12px;background:rgba(255,59,48,0.1);border:1px solid #ff3b30;color:#ff3b30;border-radius:6px;font-size:12px">🗑️</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
            
            <button onclick="showSection('songsSection');loadSongs()" style="margin-top:30px;padding:12px 24px;background:rgba(255,255,255,0.08);border:1px solid var(--border);color:var(--text);border-radius:8px;font-weight:600;cursor:pointer">← Back to Songs</button>
        </div>
    `;
    
    if (content) content.innerHTML = html;
};

window.createNewPlaylist = function() {
    const name = prompt('Enter playlist name:');
    if (name && window.playlistManager) {
        window.playlistManager.createPlaylist(name);
        showPlaylistsPage();
    }
};

window.viewPlaylist = function(playlistId) {
    if (!window.playlistManager) return;
    
    const playlist = window.playlistManager.getById(playlistId);
    if (!playlist) return;
    
    const content = document.getElementById('songsGrid') || document.getElementById('mainContent');
    const html = `
        <div style="padding:20px">
            <button onclick="showPlaylistsPage()" style="margin-bottom:20px;padding:8px 16px;background:rgba(255,255,255,0.08);border:none;color:var(--text);border-radius:6px;cursor:pointer">← Back to Playlists</button>
            
            <div style="display:flex;gap:24px;margin-bottom:30px">
                <div style="width:200px;height:200px;background:linear-gradient(135deg,#a855f7,#3b82f6);border-radius:16px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:72px">
                    🎵
                </div>
                <div style="flex:1">
                    <h1 style="font-size:36px;font-weight:800;margin-bottom:12px">${playlist.name}</h1>
                    <p style="color:var(--muted);margin-bottom:16px">${playlist.songs.length} songs</p>
                    <div style="display:flex;gap:12px">
                        <button onclick="playPlaylist(${playlistId})" style="padding:12px 32px;background:var(--pink);color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer">▶ Play All</button>
                        <button onclick="window.playlistManager.sharePlaylist(${playlistId})" style="padding:12px 24px;background:rgba(255,255,255,0.08);border:1px solid var(--border);color:var(--text);border-radius:8px;font-weight:600;cursor:pointer">📤 Share</button>
                    </div>
                </div>
            </div>
            
            ${playlist.songs.length === 0 ? `
                <div style="text-align:center;padding:60px 20px;color:var(--muted)">
                    <p>No songs in this playlist yet. Add some songs!</p>
                </div>
            ` : `
                <div>
                    ${playlist.songs.map((s, i) => `
                        <div style="display:flex;align-items:center;gap:16px;padding:12px;background:var(--card);border-radius:12px;margin-bottom:8px">
                            <span style="color:var(--muted);font-weight:700;width:30px">${i + 1}</span>
                            <img src="${s.cover || ''}" style="width:50px;height:50px;border-radius:8px" onerror="this.style.display='none'"/>
                            <div style="flex:1">
                                <div style="font-weight:600">${s.title}</div>
                                <div style="font-size:13px;color:var(--muted)">${window.formatArtistNames ? window.formatArtistNames(s.artist) : s.artist}</div>
                            </div>
                            <button onclick="playSong(${s.id})" style="padding:8px 16px;background:var(--pink);color:white;border:none;border-radius:6px;cursor:pointer">▶ Play</button>
                            <button onclick="window.playlistManager.removeFromPlaylist(${playlistId}, ${s.id});viewPlaylist(${playlistId})" style="padding:8px;background:rgba(255,59,48,0.1);border:none;color:#ff3b30;border-radius:6px;cursor:pointer">Remove</button>
                        </div>
                    `).join('')}
                </div>
            `}
        </div>
    `;
    
    if (content) content.innerHTML = html;
};

window.deletePlaylist = function(playlistId) {
    if (confirm('Delete this playlist?') && window.playlistManager) {
        window.playlistManager.deletePlaylist(playlistId);
        showPlaylistsPage();
    }
};

window.showFavoritesPage = function() {
    const likes = JSON.parse(localStorage.getItem('likedSongs') || '[]');
    const content = document.getElementById('songsGrid') || document.getElementById('mainContent');
    
    content.innerHTML = `
        <div style="padding:20px">
            <h2 style="font-size:28px;font-weight:800;margin-bottom:30px">❤️ My Favorites</h2>
            <div class="music-grid" id="favoritesGrid">
                ${likes.length === 0 ? '<p style="text-align:center;color:var(--muted);padding:60px">No favorites yet. Like some songs by clicking the ♥ button!</p>' : 'Loading favorites...'}
            </div>
            <button onclick="showSection('songsSection');loadSongs()" style="margin-top:30px;padding:12px 24px;background:rgba(255,255,255,0.08);border:1px solid var(--border);color:var(--text);border-radius:8px;font-weight:600;cursor:pointer">← Back to Songs</button>
        </div>
    `;
    
    // Load actual songs (you'd need to fetch these from window.songs or allSongs)
    if (likes.length > 0 && window.songs) {
        const favSongs = window.songs.filter(s => likes.includes(s.id));
        if (window.renderSongs && favSongs.length > 0) {
            const grid = document.getElementById('favoritesGrid');
            if (grid) {
                grid.innerHTML = '';
                window.renderSongs(favSongs);
            }
        }
    }
};

window.showHistoryPage = function() {
    const content = document.getElementById('songsGrid') || document.getElementById('mainContent');
    content.innerHTML = `
        <div style="padding:20px">
            <h2 style="font-size:28px;font-weight:800;margin-bottom:30px">🕐 Recently Played</h2>
            <p style="color:var(--muted)">Your listening history will appear here.</p>
            <button onclick="showSection('songsSection');loadSongs()" style="margin-top:30px;padding:12px 24px;background:rgba(255,255,255,0.08);border:1px solid var(--border);color:var(--text);border-radius:8px;font-weight:600;cursor:pointer">← Back to Songs</button>
        </div>
    `;
};

window.showArtistsPage = function() {
    if (typeof navToPage === 'function') navToPage('artists');
    else if (typeof loadArtists === 'function') loadArtists();
};

document.addEventListener('DOMContentLoaded', function() {
    // Update notification badge
    window.notificationSystem.updateBadge();
    
    // Initialize audio enhancer when player loads
    const audioPlayer = document.getElementById('audioPlayer');
    if (audioPlayer) {
        audioPlayer.addEventListener('loadedmetadata', () => {
            window.audioEnhancer.init(audioPlayer);
        });
    }
    
    // Track analytics
    const originalOnSearch = window.onSearch;
    window.onSearch = function(term) {
        if (term) window.analytics.trackSearch(term);
        return originalOnSearch(term);
    };
    
    console.log('✅ All advanced features loaded!');
});
