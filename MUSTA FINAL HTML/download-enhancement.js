// Shared tagged MP3 downloader for standalone catalog pages.
(function () {
  // Ensure window.API is set — sub-pages declare `const API` locally; sync it here.
  if (!window.API && typeof API !== 'undefined') window.API = API;

  const writerPromise = import('https://cdn.jsdelivr.net/npm/browser-id3-writer@6.4.0/dist/browser-id3-writer.mjs')
    .then(module => module.ID3Writer);

  function imageUrl(path) {
    if (!path) return '';
    if (path.startsWith('http') || path.startsWith('data:')) return path;
    return window.API + path;
  }

  async function watermarkArtwork(buffer) {
    const image = await createImageBitmap(new Blob([buffer]));
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const bannerHeight = Math.max(70, Math.round(canvas.height * 0.16));
    context.fillStyle = 'rgba(0, 0, 0, 0.72)';
    context.fillRect(0, canvas.height - bannerHeight, canvas.width, bannerHeight);
    context.fillStyle = '#fff';
    context.font = `700 ${Math.max(24, Math.round(canvas.width * 0.045))}px Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('www.djmusta.com', canvas.width / 2, canvas.height - bannerHeight / 2);
    image.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('Artwork watermark failed');
    return blob.arrayBuffer();
  }

  window.downloadTaggedSong = async function (id) {
    const endpoint = `${window.API}/api/songs/${id}/download-file`;
    try {
      const songResponse = await fetch(`${window.API}/api/songs/${id}`);
      const songData = await songResponse.json();
      const song = songData.song || songData;
      const cover = song.cover_image || song.cover_path || song.coverImage || song.cover;
      if (!songResponse.ok || !cover) throw new Error('Song artwork unavailable');
      const coverUrl = imageUrl(cover);
      const coverProxy = `https://images.weserv.nl/?url=${encodeURIComponent(coverUrl)}`;
      const [audioResponse, coverResponse, ID3Writer] = await Promise.all([
        fetch(endpoint),
        fetch(coverProxy),
        writerPromise
      ]);
      if (!audioResponse.ok || !coverResponse.ok) throw new Error('Download assets unavailable');
      const taggedCover = await watermarkArtwork(await coverResponse.arrayBuffer());
      const writer = new ID3Writer(await audioResponse.arrayBuffer());
      writer.setFrame('TIT2', `${song.title} - Downloaded from DJ Musta`)
        .setFrame('TPE1', [song.artist || ''])
        .setFrame('TALB', [song.album || 'DJ Musta Music'])
        .setFrame('TCON', [song.genre || 'Ugandan Music'])
        .setFrame('APIC', { type: 3, data: new Uint8Array(taggedCover), description: 'Cover' })
        .addTag();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(writer.getBlob());
      link.download = `${song.title} - ${song.artist || 'DJ Musta'} - Downloaded from DJ Musta.mp3`.replace(/[\\/:*?"<>|]/g, '-');
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (error) {
      console.warn('Tagged download unavailable; using original file:', error);
      window.open(endpoint, '_blank');
    }
  };
}());
