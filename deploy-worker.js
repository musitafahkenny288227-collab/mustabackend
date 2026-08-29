const fs = require('fs');
const https = require('https');
const path = require('path');

const token = 'cfut_weCAW6ThFQzMhPADQMAZPzuxmMyIIWWzp79m78dgfc27c3f9';
const accountId = '4fb9c546cc898314c24d358bb3360f92';
const scriptName = 'djmusta';

// Read the worker code
const workerCode = fs.readFileSync(path.join(__dirname, 'MUSTA FINAL HTML', 'worker.js'), 'utf-8');

// Prepare the API request
const options = {
  hostname: 'api.cloudflare.com',
  port: 443,
  path: `/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`,
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/javascript',
    'Content-Length': Buffer.byteLength(workerCode)
  }
};

console.log('Deploying worker to Cloudflare...');
console.log(`URL: https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`);

const req = https.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`Status Code: ${res.statusCode}`);
    
    try {
      const result = JSON.parse(data);
      console.log('Response:', JSON.stringify(result, null, 2));
      
      if (result.success) {
        console.log('[OK] Worker deployed successfully!');
      } else {
        console.log('[ERROR] Deployment failed:');
        if (result.errors) {
          result.errors.forEach(err => {
            console.log(`  - ${err.message}`);
          });
        }
      }
    } catch (e) {
      console.log('[ERROR] Failed to parse response:');
      console.log(data);
    }
  });
});

req.on('error', (err) => {
  console.error('[ERROR]', err.message);
});

req.write(workerCode);
req.end();
