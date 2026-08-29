#!/usr/bin/env python3
"""
Regenerate sitemap.xml with all songs from the backend API
"""
import urllib.request
import json
from datetime import datetime
from pathlib import Path
import re

API_BASE = 'https://mustabackend-nenb.onrender.com'
SITE_URL = 'https://djmusta.com'
OUT_FILE = Path(__file__).parent / 'sitemap.xml'
TODAY = datetime.now().strftime('%Y-%m-%d')

def create_slug(title):
    """Create URL slug from title"""
    s = str(title or '').lower()
    s = re.sub(r'[^a-z0-9]+', '-', s)
    s = re.sub(r'^-+|-+$', '', s)
    return s[:60]

def fetch_all_songs():
    """Fetch ALL songs from backend API in pages"""
    all_songs = []
    offset = 0
    limit = 100
    
    print("Fetching songs from API...")
    
    while True:
        url = f"{API_BASE}/api/songs?limit={limit}&offset={offset}&category=all"
        print(f"  GET {url}")
        
        try:
            with urllib.request.urlopen(url, timeout=15) as response:
                data = json.loads(response.read())
                songs = data.get('songs', [])
                
                if not songs:
                    break
                
                all_songs.extend(songs)
                print(f"  Fetched {len(all_songs)} songs so far...")
                
                if len(songs) < limit:
                    break
                
                offset += limit
        except Exception as e:
            print(f"  Error fetching: {e}")
            break
    
    print(f"✅ Total songs fetched: {len(all_songs)}")
    return all_songs

def escape_xml(s):
    """Escape XML special characters"""
    if not s:
        return ''
    s = str(s)
    s = s.replace('&', '&amp;')
    s = s.replace('<', '&lt;')
    s = s.replace('>', '&gt;')
    return s

def build_sitemap(songs):
    """Build complete sitemap XML"""
    
    # Static pages
    static_pages = [
        (f"{SITE_URL}", "daily", "1.0"),
        (f"{SITE_URL}/new-music", "daily", "0.95"),
        (f"{SITE_URL}/top-songs", "weekly", "0.92"),
        (f"{SITE_URL}/top-artists", "weekly", "0.90"),
        (f"{SITE_URL}/nonstops", "weekly", "0.88"),
        (f"{SITE_URL}/gospel", "weekly", "0.88"),
    ]
    
    static_xml = '\n'.join([f"""  <url>
    <loc>{loc}</loc>
    <lastmod>{TODAY}</lastmod>
    <changefreq>{freq}</changefreq>
    <priority>{prio}</priority>
  </url>""" for loc, freq, prio in static_pages])
    
    # Song pages
    songs_xml_parts = []
    for s in songs:
        title_slug = create_slug(s.get('title', ''))
        artist_slug = create_slug(s.get('artist', '')) if s.get('artist') else ''
        song_url = f"{SITE_URL}/song/{title_slug}"
        if artist_slug:
            song_url += f"/{artist_slug}"
        
        lastmod = s.get('created_at', TODAY)
        if lastmod and 'T' in lastmod:
            lastmod = lastmod.split('T')[0]
        
        title = escape_xml(s.get('title', ''))
        artist = escape_xml(s.get('artist', ''))
        
        song_entry = f"""  <url><loc>{song_url}</loc><lastmod>{lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority><news:news><news:publication><news:name>DJ Musta Music</news:name><news:language>en</news:language></news:publication><news:title>Stream {title} by {artist}</news:title><news:publication_date>{lastmod}</news:publication_date></news:news></url>"""
        songs_xml_parts.append(song_entry)
    
    songs_xml = '\n'.join(songs_xml_parts)
    
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">

  <!-- ========== STATIC PAGES ========== -->
{static_xml}

  <!-- ========== SONG PAGES ({len(songs)} songs) ========== -->
{songs_xml}
</urlset>"""

def main():
    try:
        print("🎵 DJ Musta Sitemap Generator (Python)")
        print("=" * 50)
        
        songs = fetch_all_songs()
        xml = build_sitemap(songs)
        
        OUT_FILE.write_text(xml, encoding='utf-8')
        
        print(f"\n✅ sitemap.xml written: {OUT_FILE}")
        print(f"   Static pages : 6")
        print(f"   Song pages   : {len(songs)}")
        print(f"   Total URLs   : {len(songs) + 6}")
        print("\n📌 Next steps:")
        print("   1. Deploy your site to Cloudflare Pages")
        print("   2. Go to Google Search Console → Sitemaps")
        print("   3. Submit: https://djmusta.com/sitemap.xml")
        
    except Exception as err:
        print(f"❌ Error: {err}")
        return 1
    
    return 0

if __name__ == '__main__':
    exit(main())
