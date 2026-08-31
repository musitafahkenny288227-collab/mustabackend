// ============================================================
// DJ MUSTA - EXTENDED FEATURES (ALL 15 MISSING FEATURES)
// This file adds: Comments, Clickable Cards, Following,
// Notifications, History, Queue UI, Recommendations,
// Top Charts, Genre/Year Filters, Artist Bios/Social Links,
// User Stats, and Dark/Light Theme Toggle
// ============================================================

// ── GLOBAL STATE FOR NEW FEATURES ──
let recentlyPlayedHistory = [];
let followedArtists = [];
let notifications = [];
// Note: toggleTheme, queueVisible, currentTheme are managed in index.html

// ============================================================
// 2. SONG DETAIL MODAL — delegates to index.html's implementation
// openSongDetail, closeModal, playSongFromModal, downloadFromModal,
// shareFromModal, loadComments, renderComments, postComment are all
// defined in index.html and use window.currentModalSong for state.
// This file must NOT redefine them to avoid split-brain state.
// ============================================================

// ============================================================
// 4. FOLLOWING SYSTEM
// ============================================================
async function toggleFollow(artistName, btn) {
  if (!currentUser) { showAuth('login'); return; }
  
  try {
    const isFollowing = btn.classList.contains('following');
    if (isFollowing) {
      await api(`/artists/${encodeURIComponent(artistName)}/follow`, {method: 'DELETE'});
      btn.classList.remove('following');
      btn.textContent = '➕ Follow';
      showToast(`Unfollowed ${artistName}`, '👋');
    } else {
      await api(`/artists/${encodeURIComponent(artistName)}/follow`, {method: 'POST'});
      btn.classList.add('following');
      btn.textContent = '✓ Following';
      showToast(`Now following ${artistName}`, '❤️');
    }
    loadFollowedArtists();
  } catch(e) {
    showToast(e.message, '❌');
  }
}

async function loadFollowedArtists() {
  if (!currentUser) return;
  try {
    const d = await api('/following');
    followedArtists = d.artists || [];
  } catch(e) {
    console.error('Failed to load followed artists:', e);
  }
}

// ============================================================
// 5. NOTIFICATIONS
// ============================================================
async function loadNotifications() {
  if (!currentUser) return;
  try {
    const d = await api('/notifications');
    notifications = d.notifications || [];
    updateNotificationBadge();
  } catch(e) {
    console.error('Failed to load notifications:', e);
  }
}

function updateNotificationBadge() {
  const unread = notifications.filter(n => !n.is_read).length;
  let badge = document.getElementById('notifBadge');
  if (!badge && unread > 0) {
    // Create badge if doesn't exist
    const userMenu = document.getElementById('userMenu');
    if (userMenu) {
      badge = document.createElement('span');
      badge.id = 'notifBadge';
      badge.style.cssText = 'position:absolute;top:-4px;right:-4px;background:#ff3d6b;color:white;font-size:10px;font-weight:700;padding:2px 6px;border-radius:50px;min-width:18px;text-align:center';
      userMenu.appendChild(badge);
    }
  }
  if (badge) {
    if (unread > 0) {
      badge.textContent = unread;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }
}

async function markAllNotificationsRead() {
  if (!currentUser) return;
  try {
    await api('/notifications/read-all', {method: 'PATCH'});
    notifications.forEach(n => n.is_read = true);
    updateNotificationBadge();
  } catch(e) {
    console.error('Failed to mark notifications as read:', e);
  }
}

// ============================================================
// 6. RECENTLY PLAYED HISTORY
// ============================================================
function addToHistory(song) {
  // Add to local history (limit to 50)
  recentlyPlayedHistory = recentlyPlayedHistory.filter(s => s.id !== song.id);
  recentlyPlayedHistory.unshift({...song, played_at: new Date()});
  if (recentlyPlayedHistory.length > 50) recentlyPlayedHistory.pop();
  
  // Save to localStorage
  try {
    localStorage.setItem('djm_history', JSON.stringify(recentlyPlayedHistory.slice(0, 20)));
  } catch(e) {}
}

async function loadHistory() {
  if (!currentUser) {
    // Load from localStorage if not logged in
    try {
      const stored = localStorage.getItem('djm_history');
      if (stored) recentlyPlayedHistory = JSON.parse(stored);
    } catch(e) {}
    renderHistory(recentlyPlayedHistory);
    return;
  }
  
  // Load from API if logged in
  try {
    const d = await api('/history/recent');
    recentlyPlayedHistory = d.songs || [];
    renderHistory(recentlyPlayedHistory);
  } catch(e) {
    showToast('Failed to load history', '❌');
  }
}

function renderHistory(songs) {
  const container = document.getElementById('historyList');
  if (!songs || songs.length === 0) {
    container.innerHTML = '<p style="color:var(--muted);padding:20px">No recently played songs</p>';
    return;
  }
  
  container.innerHTML = songs.map(s => `
    <div class="song-row" onclick="playSong(${s.id})">
      <img src="${imgSrc(s.cover_path)}" style="width:46px;height:46px;border-radius:8px;object-fit:cover;flex-shrink:0"/>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</div>
        <div style="font-size:12px;color:var(--muted)">${esc(s.artist)}</div>
      </div>
      <span style="font-size:11px;color:var(--muted)">${s.played_at ? new Date(s.played_at).toLocaleDateString() : ''}</span>
      <button onclick="event.stopPropagation();playSong(${s.id})" style="width:30px;height:30px;border-radius:50%;background:var(--pink);color:white;border:none;cursor:pointer;font-size:13px">▶</button>
    </div>
  `).join('');
}

// ============================================================
// 7. QUEUE MANAGEMENT UI — queue panel removed from HTML,
//    queue state is managed via window.playlist in index.html
// ============================================================
function toggleQueue() {
  // Queue panel was removed — no-op to prevent null reference errors
}

function renderQueue() {
  // Queue panel was removed — no-op to prevent null reference errors
}

function removeFromQueue(idx) {
  if (!window.playlist) return;
  window.playlist.splice(idx, 1);
  if (window.playIndex >= idx && window.playIndex > 0) window.playIndex--;
  if (typeof showToast === 'function') showToast('Removed from queue', '🗑️');
}

function clearQueue() {
  if (window.playlist) window.playlist = [];
  window.playIndex = 0;
  if (typeof showToast === 'function') showToast('Queue cleared', '🗑️');
}

// ============================================================
// 8. RECOMMENDATIONS
// ============================================================
async function loadRecommendations() {
  if (!currentUser) {
    showToast('Login to see recommendations', '🔒');
    showAuth('login');
    return;
  }
  
  try {
    const d = await api('/recommendations');
    renderRecommendations(d.songs || []);
  } catch(e) {
    document.getElementById('recommendationsGrid').innerHTML = '<p style="color:var(--muted)">No recommendations yet. Like some songs!</p>';
  }
}

function renderRecommendations(songList) {
  const container = document.getElementById('recommendationsGrid');
  if (songList.length === 0) {
    container.innerHTML = '<p style="color:var(--muted)">No recommendations yet. Like some songs to get started!</p>';
    return;
  }
  
  container.className = 'music-grid';
  container.innerHTML = songList.slice(0, 8).map(s => `
    <div class="music-card" onclick="openSongDetail(${s.id})">
      <div class="card-img-wrap">
        <img src="${imgSrc(s.cover_path)}" loading="lazy"/>
        <div class="card-overlay">
          <button class="ov-btn" onclick="event.stopPropagation();playSong(${s.id})">▶</button>
        </div>
      </div>
      <div class="card-info">
        <div class="card-title">${esc(s.title)}</div>
        <a class="card-artist" href="${artistPath(s.artist)}" onclick="event.stopPropagation()" style="display:block;text-decoration:none;color:inherit">${esc(s.artist)}</a>
      </div>
    </div>
  `).join('');
}

// ============================================================
// 9. TOP CHARTS / TRENDING
// ============================================================
async function loadTopCharts() {
  try {
    const d = await api('/trending');
    renderTopCharts(d.songs || []);
  } catch(e) {
    document.getElementById('topChartsGrid').innerHTML = '<p style="color:var(--muted)">Could not load top charts</p>';
  }
}

function renderTopCharts(songList) {
  const container = document.getElementById('topChartsGrid');
  if (songList.length === 0) {
    container.innerHTML = '<p style="color:var(--muted)">No trending songs yet</p>';
    return;
  }
  
  container.innerHTML = songList.slice(0, 10).map((s, idx) => `
    <div class="song-row" onclick="playSong(${s.id})">
      <div style="font-weight:900;color:var(--pink);font-size:18px;width:32px;text-align:center">#${idx + 1}</div>
      <img src="${imgSrc(s.cover_path)}" style="width:50px;height:50px;border-radius:8px;object-fit:cover"/>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</div>
        <div style="font-size:12px;color:var(--muted)">${esc(s.artist)} • ${s.play_count || 0} plays</div>
      </div>
      <button onclick="event.stopPropagation();playSong(${s.id})" style="width:34px;height:34px;border-radius:50%;background:var(--pink);color:white;border:none;cursor:pointer;font-size:14px">▶</button>
    </div>
  `).join('');
}

// ============================================================
// 10. GENRE & YEAR FILTERS
// ============================================================
function filterByYear(year) {
  const yearValue = String(year);
  const sourceSongs = window.songs || [];
  const filteredSongs = sourceSongs.filter(song => String(song.release_year || song.releaseYear || '').startsWith(yearValue));
  if (typeof renderSongs === 'function') {
    renderSongs(filteredSongs, false);
    showToast(filteredSongs.length ? `${filteredSongs.length} songs from ${year}` : `No songs found from ${year}`, filteredSongs.length ? '✅' : 'ℹ️');
  }
}

function showGenreFilter() {
  const genres = ['All', 'Afrobeat', 'Dancehall', 'R&B', 'Gospel', 'Hip Hop', 'Pop', 'Other'];
  // This creates a genre picker
  showToast('Use genre buttons in nav', '🎸');
}

// ============================================================
// 11. ARTIST BIOS & SOCIAL LINKS
// ============================================================
async function loadArtistDetailWithSocial(artistName) {
  try {
    const d = await api('/artists/' + encodeURIComponent(artistName));
    const artist = d.artist || {name: artistName, bio: '', photo_url: null};
    const artistSongs = d.songs || [];
    
    // Show artist detail section
    document.getElementById('artistDetailName').textContent = artist.name;
    document.getElementById('artistDetailBio').textContent = artist.bio ||
      (window.getAutomaticArtistBio ? await window.getAutomaticArtistBio(artist.name, artistSongs) : `Explore ${artist.name}'s music on DJ Musta.`);
    document.getElementById('artistDetailCount').textContent = `${artistSongs.length} songs`;
    
    const artistPhoto = artist.photo_url || artist.photoUrl || artistSongs.find(song => song.cover_path || song.cover_image)?.cover_path || artistSongs.find(song => song.cover_image)?.cover_image;
    if (artistPhoto) {
      document.getElementById('artistDetailPhoto').src = typeof imgSrc === 'function' ? imgSrc(artistPhoto) : artistPhoto;
      document.getElementById('artistDetailPhoto').style.display = 'block';
    } else {
      document.getElementById('artistDetailPhoto').style.display = 'none';
    }
    
    // Social links
    const socialContainer = document.getElementById('artistSocialLinks');
    if (socialContainer) {
      let socialHTML = '';
      if (artist.instagram) socialHTML += `<a href="${artist.instagram}" target="_blank" style="color:var(--pink);font-size:20px">📷</a>`;
      if (artist.twitter) socialHTML += `<a href="${artist.twitter}" target="_blank" style="color:var(--pink);font-size:20px">🐦</a>`;
      if (artist.facebook) socialHTML += `<a href="${artist.facebook}" target="_blank" style="color:var(--pink);font-size:20px">📘</a>`;
      socialContainer.innerHTML = socialHTML || '<span style="color:var(--muted);font-size:12px">No social links</span>';
    }
    
    // Check if user is following
    if (currentUser) {
      const followCheck = await api(`/artists/${encodeURIComponent(artistName)}/following`);
      const followBtn = document.getElementById('artistFollowBtn');
      if (followBtn) {
        if (followCheck.following) {
          followBtn.classList.add('following');
          followBtn.textContent = '✓ Following';
        } else {
          followBtn.classList.remove('following');
          followBtn.textContent = '➕ Follow';
        }
        followBtn.style.display = 'inline-block';
      }
    }
    
    // Render songs
    renderSongs(artistSongs, false);
    
  } catch(e) {
    showToast('Failed to load artist details', '❌');
  }
}

// ============================================================
// 12. USER STATISTICS
// ============================================================
async function loadUserStats() {
  if (!currentUser) return;
  try {
    const d = await api('/stats/user');
    document.getElementById('profilePlays').textContent = d.plays || 0;
    document.getElementById('profileLikes').textContent = d.likes || 0;
    document.getElementById('profileDownloads') ? (document.getElementById('profileDownloads').textContent = d.downloads || 0) : null;
  } catch(e) {
    console.error('Failed to load user stats:', e);
  }
}

// ============================================================
// 13. SHARE FUNCTIONALITY (Enhanced)
// ============================================================
let currentShareData = null;

function openShare(id, title, artist) {
  const slug = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 60);
  currentShareData = { id, title, artist, url: `https://djmusta.com/song/${slug(title)}/${slug(artist)}` };
  document.getElementById('shareTitle').textContent = `${title} by ${artist}`;
  document.getElementById('shareModal').style.display = 'flex';
}

function shareVia(platform) {
  if (!currentShareData) return;
  const { title, artist, url } = currentShareData;
  const text = `Check out "${title}" by ${artist} on DJ Musta!`;
  
  let shareUrl = '';
  switch(platform) {
    case 'whatsapp':
      shareUrl = `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`;
      break;
    case 'twitter':
      shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
      break;
    case 'facebook':
      shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
      break;
    case 'copy':
      navigator.clipboard.writeText(url).then(() => {
        showToast('Link copied to clipboard!', '📋');
        closeModal('shareModal');
      });
      return;
  }
  
  if (shareUrl) {
    window.open(shareUrl, '_blank', 'width=600,height=400');
    closeModal('shareModal');
  }
}

// ============================================================
// 14. EDIT SONG (ADMIN)
// ============================================================
function openEditSong(song) {
  if (!currentUser?.isAdmin && !currentUser?.is_admin) return;
  
  document.getElementById('editSongId').value = song.id;
  document.getElementById('editTitle').value = song.title;
  document.getElementById('editArtist').value = song.artist;
  document.getElementById('editGenre').value = song.genre || 'Other';
  document.getElementById('editDuration').value = song.duration || '3:00';
  document.getElementById('editLyrics').value = song.lyrics || '';
  document.getElementById('editSongModal').style.display = 'flex';
}

async function saveEditSong() {
  const id = document.getElementById('editSongId').value;
  const title = document.getElementById('editTitle').value.trim();
  const artist = document.getElementById('editArtist').value.trim();
  const genre = document.getElementById('editGenre').value;
  const duration = document.getElementById('editDuration').value;
  const lyrics = document.getElementById('editLyrics').value;
  
  if (!title || !artist) {
    showToast('Title and artist are required', '⚠️');
    return;
  }
  
  try {
    await api(`/songs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({title, artist, genre, duration, lyrics, releaseYear: new Date().getFullYear()})
    });
    closeModal('editSongModal');
    showToast('Song updated!', '✅');
    loadSongs(true); // Reload
  } catch(e) {
    showToast(e.message, '❌');
  }
}

// ============================================================
// 15. EDIT ARTIST (ADMIN)
// ============================================================
function openEditArtist(name, bio, photoUrl) {
  if (!currentUser?.isAdmin && !currentUser?.is_admin) return;
  
  document.getElementById('editArtistName').value = name;
  document.getElementById('editArtistBio').value = bio || '';
  document.getElementById('editArtistPhoto').value = photoUrl || '';
  document.getElementById('editArtistModal').style.display = 'flex';
}

async function saveEditArtist() {
  const name = document.getElementById('editArtistName').value.trim();
  const bio = document.getElementById('editArtistBio').value.trim();
  let photoUrl = document.getElementById('editArtistPhoto').value.trim();
  const photoFile = document.getElementById('editArtistPhotoFile')?.files[0];
  
  if (!name) {
    showToast('Artist name is required', '⚠️');
    return;
  }
  
  try {
    if (photoFile) {
      showToast('Uploading artist photo...', '⏳');
      const formData = new FormData();
      formData.append('photo', photoFile);
      formData.append('image', photoFile);
      formData.append('artistName', name);
      const response = await fetch(API + '/api/artists/photo', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: formData
      });
      const responseText = await response.text();
      let data = {};
      try { data = responseText ? JSON.parse(responseText) : {}; } catch (e) { }
      if (!response.ok) throw new Error(data.error || data.message || `Photo upload failed (${response.status})`);
      const artist = data.artist || data.profile || data.data || {};
      const uploadedPhoto = data.photo || data.image || data.file || {};
      photoUrl = data.photoUrl || data.photo_url || data.profile_photo || data.profilePhoto || data.profile_photo_url ||
        data.imageUrl || data.image_url || data.fileUrl || data.file_url || data.path || data.url ||
        artist.photoUrl || artist.photo_url || artist.profile_photo || artist.profilePhoto || artist.imageUrl || artist.url ||
        uploadedPhoto.url || uploadedPhoto.path ||
        (responseText && /^https?:\/\//i.test(responseText.trim()) ? responseText.trim() : '');
      if (!photoUrl) {
        const refreshed = await api('/artists/' + encodeURIComponent(name));
        const refreshedArtist = refreshed.artist || refreshed;
        photoUrl = refreshedArtist.photo_url || refreshedArtist.photoUrl || '';
      }
      if (!photoUrl) throw new Error('Upload succeeded, but no artist photo URL was returned');
    }

    await api(`/artists/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: JSON.stringify({bio, photoUrl, photo_url: photoUrl})
    });
    if (typeof artistPhotoCatalog !== 'undefined') {
      artistPhotoCatalog.delete(name.toLowerCase());
      artistPhotoCatalogLoaded = false;
    }
    closeModal('editArtistModal');
    showToast('Artist updated!', '✅');
    // Reload artist detail if viewing
    const detailName = document.getElementById('artistDetailName').textContent;
    if (detailName === name) {
      loadArtistDetailWithSocial(name);
    }
  } catch(e) {
    showToast(e.message, '❌');
  }
}

// ============================================================
// ENHANCED INIT
// ============================================================
function initExtendedFeatures() {
  // Load history from localStorage
  try {
    const stored = localStorage.getItem('djm_history');
    if (stored) recentlyPlayedHistory = JSON.parse(stored);
  } catch(e) {}
  
  // Load followed artists and notifications if logged in
  if (typeof currentUser !== 'undefined' && currentUser) {
    loadFollowedArtists();
    loadNotifications();
    loadUserStats();
  }
  
  console.log('✅ Extended features initialized');
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initExtendedFeatures);
} else {
  initExtendedFeatures();
}
