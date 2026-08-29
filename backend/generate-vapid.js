/**
 * Run this ONCE on any machine with Node.js to generate your VAPID keys:
 *   node generate-vapid.js
 * 
 * Then set the output values as environment variables on Render.
 */
const crypto = require('crypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding:  { type: 'spki',  format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
});

function toBase64Url(buffer) {
    return buffer.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

const pubKey  = toBase64Url(publicKey.slice(-65));   // uncompressed EC point (04 + 32 + 32)
const privKey = toBase64Url(privateKey.slice(-32));   // raw 32-byte private key

console.log('\n✅ Your VAPID Keys for DJ Musta Push Notifications');
console.log('='.repeat(55));
console.log('\nPublic Key (add to Render + index.html):');
console.log(pubKey);
console.log('\nPrivate Key (add to Render only — never share this):');
console.log(privKey);
console.log('\n='.repeat(55));
console.log('\nRender Environment Variables to set:');
console.log('  VAPID_PUBLIC_KEY  =', pubKey);
console.log('  VAPID_PRIVATE_KEY =', privKey);
console.log('  VAPID_EMAIL       = mailto:musitafahkenny288227@gmail.com');
console.log('\n⚠️  Save these keys! You cannot recover them after closing this window.\n');
