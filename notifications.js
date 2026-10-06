const https = require('https');
const config = require('./config');

async function sendEmail(to, subject, html) {
  if (!to || !config.BREVO_API_KEY) {
    return false;
  }

  return new Promise((resolve) => {
    const body = JSON.stringify({
      sender: { name: 'DJ Musta Music', email: config.EMAIL_USER },
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
        'api-key': config.BREVO_API_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });

    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

async function sendTelegramNewSong(song) {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID || !song) {
    return false;
  }

  const esc = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const message = `🎵 <b>New Song on DJ Musta</b>\n\n<b>${esc(song.title)}</b> by ${esc(song.artist)}\n\n<a href="${config.SITE_URL}/?song=${encodeURIComponent(song.id)}">Listen now</a>`;
  const body = JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' });

  await new Promise((resolve) => {
    const request = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      response.on('data', () => {});
      response.on('end', resolve);
    });

    request.on('error', resolve);
    request.write(body);
    request.end();
  });

  return true;
}

module.exports = {
  sendEmail,
  sendTelegramNewSong
};
