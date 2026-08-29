# Song Playback & Download Debugging Guide

## What I Fixed
I've added comprehensive logging to help diagnose why songs won't play or download. Here's what I changed:

### 1. Enhanced `playSong()` Function (Line ~6701)
- Added detailed console logs showing:
  - Song ID and object properties
  - Full song data structure
  - The streaming URL being used
  - Whether `audio.play()` succeeds or fails
  - Exact error messages from playback failures

### 2. Enhanced `downloadSong()` Function (Line ~6978)
- Added detailed console logs showing:
  - Download parameters (id, title, url, song object)
  - Backend URL being requested
  - Audio and cover buffer sizes
  - Whether ID3 tagging succeeds or falls back

### 3. Enhanced `loadSongs()` Function (Line ~5982)
- Added console logs showing:
  - API request parameters
  - Total songs available vs received
  - First song object structure
  - Any fetch errors with attempt numbers

### 4. New Audio Error Handler
- Added `audio.addEventListener('error', ...)` to catch playback errors
- Shows specific error codes and descriptions
- Displays user-friendly error messages

## How to Debug

### Step 1: Deploy to Live Site
```bash
git add -A
git commit -m "Add comprehensive debugging logs"
git push origin main
```
This will deploy to Cloudflare Pages (djmusta.com)

### Step 2: Open Browser Console
1. Go to https://djmusta.com
2. Press `F12` (or Ctrl+Shift+I) to open Developer Tools
3. Click the "Console" tab
4. You should see logs starting with 🎵, 📡, ✓, ❌, etc.

### Step 3: Trigger Song Loading
- The page will automatically load songs
- Watch console for:
  ```
  🎵 loadSongs called: { reset: true, category: 'all', ... }
  📡 Fetching from API: /songs?...
  ✓ API response: { total: XXX, received: YYY, firstSong: {...} }
  ```

### Step 4: Try Playing a Song
1. Click the play button on any song
2. Look in console for logs starting with:
   - `🎵 playSong called with id: X`
   - `📦 Song object: { ... }`
   - `🔗 Using stream URL: ...`
   - Either `✓ Set audio.src to: ...` OR `🔴 Audio error: ...`

### Step 5: Interpret the Results

#### If you see `✓ Set audio.src to: https://mustabackend-nenb.onrender.com/api/songs/123/stream`
- This is CORRECT
- The URL should start playing
- If it doesn't, check the Audio Error Handler logs (step 4)

#### If you see `🔴 Audio error: MEDIA_ERR_NETWORK`
- **Problem**: Backend server at `https://mustabackend-nenb.onrender.com` is down or unreachable
- **Fix**: Check if backend is running on Render dashboard

#### If you see `🔴 Audio error: MEDIA_ERR_DECODE`
- **Problem**: The audio file format isn't supported by the browser
- **Fix**: Check if backend is returning valid MP3 file

#### If you see `📦 Song object: undefined` or `Song not found!`
- **Problem**: Songs aren't loading from the API
- **Check**: Look at the API response from step 3
- **Likely Cause**: Backend API is down or returning wrong response

#### If `📡 Fetching from API: /songs?...` hangs indefinitely
- **Problem**: API request is timing out
- **Cause**: Backend server on Render may be spinning down (cold start)
- **Fix**: Give it time to wake up (30+ seconds)

### Step 6: Check the Song Object Structure
When you see `📦 Song object:`, expand it in the console. It should look like:
```javascript
{
  id: 123,
  title: "Song Title",
  artist: "Artist Name",
  file_path: "https://r2-bucket.example.com/audio.mp3" OR "/api/songs/123/stream",
  cover_path: "https://r2-bucket.example.com/cover.jpg",
  play_count: 42,
  download_count: 8,
  duration: 234,
  genre: "Ugandan Music",
  approved: true
}
```

**If `file_path` is missing:** The API isn't returning audio paths
**If `file_path` is present:** Your code should work

### Step 7: Test Download
1. Click the download button on a song
2. Look for logs starting with `📥 downloadSong called`
3. Check if it completes with:
   - `✓ Tagged download complete:` → Success!
   - `❌ Tagged download unavailable, trying simple download:` → Fallback to simple download
   - Both fail → Download endpoint is broken

## Common Issues & Fixes

| Issue | Console Sign | Likely Cause | Fix |
|-------|--------------|--------------|-----|
| No songs appear | No `✓ API response` logs | Backend down | Wait or restart backend |
| Play button does nothing | `Song not found!` | songs array is empty | Check API response |
| Audio won't play | `🔴 Audio error: MEDIA_ERR_NETWORK` | Streaming endpoint down | Restart backend |
| Audio won't play | `🔴 Audio error: MEDIA_ERR_DECODE` | Invalid audio format | Re-upload songs |
| Download spins forever | No `✓ Tagged download` logs | Download endpoint timeout | Check backend |

## Backend Health Check
Visit this URL in your browser (copy paste):
```
https://mustabackend-nenb.onrender.com/api/songs?limit=1
```

You should see a response like:
```json
{
  "songs": [{"id": 1, "title": "...", "file_path": "...", ...}],
  "total": 200,
  "offset": 0,
  "limit": 1
}
```

If you get an error, the backend needs to be checked/restarted.

## Report Format
When you test, please share:
1. What you see in the Console when loading songs (copy the first few logs)
2. What happens when you click play (does console show any errors?)
3. URL of the song streaming endpoint (from `🔗 Using stream URL:` logs)
4. The response from the backend health check above
