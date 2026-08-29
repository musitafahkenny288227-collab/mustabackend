#!/bin/bash
cd "c:/Users/MUSTA/Desktop/WEBSITE"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "Installing Wrangler CLI..."
    npm install -g wrangler
fi

# Authenticate with Cloudflare using the API token
export CLOUDFLARE_API_TOKEN="cfut_weCAW6ThFQzMhPADQMAZPzuxmMyIIWWzp79m78dgfc27c3f9"

# Deploy the worker
echo "Deploying worker to Cloudflare..."
cd "MUSTA FINAL HTML"
wrangler deploy worker.js --name djmusta

echo "Worker deployment complete!"
