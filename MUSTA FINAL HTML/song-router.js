// ============================================================
// SEO-FRIENDLY URL ROUTER
// Handles /song/song-title URLs instead of ?song=id
// ============================================================

class SongRouter {
    constructor() {
        this.init();
    }

    init() {
        // Handle browser back/forward buttons
        window.addEventListener('popstate', (e) => {
            if (e.state && e.state.songId) {
                this.loadSong(e.state.songId, false);
            } else {
                this.showHomepage();
            }
        });

        // Handle initial page load
        this.handleInitialRoute();
    }

    /**
     * Handle initial page load routing
     */
    handleInitialRoute() {
        const path = window.location.pathname;

        // Prevent empty song routes like /song/ or /song// from staying blank
        if (path === '/song' || path === '/song/' || path === '/song//') {
            window.history.replaceState({}, 'DJ Musta | Uganda Music', '/');
            document.title = 'DJ Musta | Uganda Music 2026';
            return;
        }

        // Check if it's a song URL: /song/song-title or /song/123
        if (path.startsWith('/song/')) {
            const songIdentifier = path.split('/song/')[1];
            if (songIdentifier) {
                this.loadSongBySlug(songIdentifier);
            }
        }
        // Check for old query parameter format (?song=id) and redirect
        else if (window.location.search.includes('song=')) {
            const params = new URLSearchParams(window.location.search);
            const songId = params.get('song');
            if (songId) {
                // Redirect to new pretty URL
                this.redirectToSongUrl(songId);
            }
        }
    }

    /**
     * Create SEO-friendly slug from song title
     * @param {String} title - Song title
     * @returns {String} URL-safe slug
     */
    createSlug(title) {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with dashes
            .replace(/^-+|-+$/g, '')       // Remove leading/trailing dashes
            .substring(0, 60);              // Max 60 chars
    }

    createSongPath(song) {
        const titleSlug = this.createSlug(song.title);
        const artistSlug = song.artist ? `/${this.createSlug(song.artist)}` : '';
        return `/song/${titleSlug}${artistSlug}`;
    }

    /**
     * Navigate to song with pretty URL
     * @param {Number} songId - Song ID
     * @param {String} songTitle - Song title
     * @param {Boolean} pushState - Whether to push to history
     */
    navigateToSong(songId, songTitle, pushState = true) {
        const song = window.songs?.find(item => item.id === songId);
        const url = song ? this.createSongPath(song) : `/song/${this.createSlug(songTitle)}`;
        const slug = url.replace('/song/', '');
        
        if (pushState) {
            window.history.pushState(
                { songId, songTitle, slug },
                `${songTitle} | DJ Musta`,
                url
            );
        }
        
        // Update page title
        document.title = `${songTitle} | DJ Musta Music`;
        
        // Update meta tags for sharing
        this.updateMetaTags(songTitle, songId);
    }

    /**
     * Load song by slug or ID
     * @param {String} identifier - Can be slug or ID
     */
    async loadSongBySlug(identifier) {
        const API = window.API || 'https://mustabackend-nenb.onrender.com';

        // Helper: play song once we have the data
        const playSongData = (song) => {
            // Push pretty URL
            const slug = this.createSongPath(song).replace('/song/', '');
            window.history.replaceState(
                { songId: song.id, songTitle: song.title, slug },
                `${song.title} | DJ Musta Music`,
                `/song/${slug}`
            );
            document.title = `${song.title} by ${song.artist} | DJ Musta Music`;
            this.updateMetaTags(song.title, song.id);
            // Wait for playSong to be available (page may still be loading)
            const tryPlay = (attempts = 0) => {
                if (window.playSong) {
                    window.playSong(song.id);
                } else if (attempts < 30) {
                    setTimeout(() => tryPlay(attempts + 1), 300);
                }
            };
            tryPlay();
        };

        // 1. Try window.songs cache first (already loaded)
        const [titleIdentifier, artistIdentifier] = identifier.split('/');
        const inCache = window.songs && window.songs.find(s => {
            return (this.createSlug(s.title) === titleIdentifier &&
                (!artistIdentifier || this.createSlug(s.artist) === artistIdentifier)) || String(s.id) === identifier;
        });
        if (inCache) { playSongData(inCache); return; }

        // 2. Fetch from API by search (slug → search term)
        try {
            const searchTerm = titleIdentifier.replace(/-/g, ' ');
            const res = await fetch(
                `${API}/api/songs?search=${encodeURIComponent(searchTerm)}&limit=5`
            );
            if (res.ok) {
                const data = await res.json();
                const songs = data.songs || [];
                // Find best match — prefer exact slug match
                const match = songs.find(s => this.createSlug(s.title) === titleIdentifier &&
                    (!artistIdentifier || this.createSlug(s.artist) === artistIdentifier))
                            || songs[0];
                if (match) {
                    // Add to window.songs so playSong can find it
                    if (!window.songs) window.songs = [];
                    if (!window.songs.find(s => s.id === match.id)) {
                        window.songs.unshift(match);
                    }
                    playSongData(match);
                    return;
                }
            }
        } catch (e) {
            console.warn('Song router: API search failed', e);
        }

        // 3. Try numeric ID fallback
        if (!isNaN(identifier)) {
            try {
                const res = await fetch(`${API}/api/songs?limit=500&category=all`);
                if (res.ok) {
                    const data = await res.json();
                    const match = (data.songs || []).find(s => String(s.id) === identifier);
                    if (match) { playSongData(match); return; }
                }
            } catch(e) {}
        }

        // 4. Nothing found — stay on homepage, show a toast when ready
        console.warn('Song router: song not found for slug:', identifier);
        const showNotFound = () => {
            if (window.showToast) {
                window.showToast('Song not found', '⚠️');
            } else {
                setTimeout(showNotFound, 500);
            }
        };
        showNotFound();
    }

    /**
     * Load and play song
     * @param {Number} songId - Song ID
     * @param {Boolean} pushState - Whether to push to history
     */
    loadSong(songId, pushState = true) {
        // Find song in local data
        const song = window.songs?.find(s => s.id === songId);
        
        if (song) {
            // Update URL if needed
            if (pushState) {
                this.navigateToSong(songId, song.title, true);
            }
            
            // Play the song using existing function
            if (window.playSong) {
                window.playSong(songId);
            }
        } else {
            console.warn('Song not found:', songId);
        }
    }

    /**
     * Redirect old query parameter URL to new pretty URL
     * @param {Number} songId - Song ID from ?song=id
     */
    redirectToSongUrl(songId) {
        const song = window.songs?.find(s => s.id === parseInt(songId));
        
        if (song) {
            const newUrl = this.createSongPath(song);
            const slug = newUrl.replace('/song/', '');
            
            // Replace current URL (no back button to old URL)
            window.history.replaceState(
                { songId: song.id, songTitle: song.title, slug },
                `${song.title} | DJ Musta`,
                newUrl
            );
            
            // Update page title
            document.title = `${song.title} | DJ Musta Music`;
            
            // Load the song
            this.loadSong(songId, false);
        }
    }

    /**
     * Show homepage
     */
    showHomepage() {
        window.history.pushState({}, 'DJ Musta | Uganda Music', '/');
        document.title = 'DJ Musta | Uganda Music 2026';
        
        // Stop any playing song if needed
        if (window.audio && !window.audio.paused) {
            // Keep playing, just update URL
        }
    }

    /**
     * Update meta tags for social sharing
     * @param {String} title - Song title
     * @param {Number} songId - Song ID
     */
    updateMetaTags(title, songId) {
        const song = window.songs?.find(s => s.id === songId);
        if (!song) return;

        // Ensure we always use the custom domain for sharing
        const customDomain = 'https://djmusta.com';
        const pathSlug = this.createSongPath(song).replace('/song/', '');
        const shareUrl = `${customDomain}/song/${pathSlug}`;

        // Update or create meta tags
        const metaTags = {
            'og:title': `${title} by ${song.artist} | DJ Musta`,
            'og:description': `Listen to ${title} by ${song.artist}. Download free MP3 on DJ Musta - Uganda's #1 Music Platform`,
            'og:url': shareUrl,
            'twitter:title': `${title} by ${song.artist}`,
            'twitter:description': `Listen to ${title} by ${song.artist}. Download free MP3 on DJ Musta`,
        };

        Object.entries(metaTags).forEach(([property, content]) => {
            let meta = document.querySelector(`meta[property="${property}"]`) || 
                       document.querySelector(`meta[name="${property}"]`);
            
            if (meta) {
                meta.setAttribute('content', content);
            } else {
                meta = document.createElement('meta');
                meta.setAttribute(property.startsWith('og:') ? 'property' : 'name', property);
                meta.setAttribute('content', content);
                document.head.appendChild(meta);
            }
        });
    }

    /**
     * Get shareable URL for a song
     * @param {Object} song - Song object
     * @returns {String} Full URL
     */
    getSongUrl(song) {
        return `${window.location.origin}${this.createSongPath(song)}`;
    }
}

// Initialize router when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.songRouter = new SongRouter();
    });
} else {
    window.songRouter = new SongRouter();
}

// Export for use in other scripts
window.SongRouter = SongRouter;
