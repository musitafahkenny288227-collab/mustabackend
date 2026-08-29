# Deploy updated worker.js to Cloudflare

# Get the worker code
$workerCode = Get-Content -Path 'c:\Users\MUSTA\Desktop\WEBSITE\MUSTA FINAL HTML\worker.js' -Raw

# API credentials
$accountId = '4fb9c546cc898314c24d358bb3360f92'
$workerName = 'djmustasongs'
$bearerToken = 'cfut_weCAW6ThFQzMhPADQMAZPzuxmMyIIWWzp79m78dgfc27c3f9'
$url = "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/services/$workerName/environments/production/content"

# Create the request headers
$headers = @{
    'Authorization' = "Bearer $bearerToken"
    'Content-Type' = 'application/javascript'
}

Write-Host "Deploying worker code to Cloudflare..."
Write-Host "URL: $url"
Write-Host "Code size: $($workerCode.Length) bytes"

# Try to upload
try {
    $response = Invoke-WebRequest -Uri $url -Method PUT -Headers $headers -Body $workerCode -ErrorAction Stop
    Write-Host "✅ Upload successful!"
    Write-Host "Status Code: $($response.StatusCode)"
    Write-Host "Response: $($response.Content)"
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        Write-Host "Status Code: $($_.Exception.Response.StatusCode)"
        $errorContent = $_.Exception.Response.Content.ReadAsStream()
        $reader = [System.IO.StreamReader]::new($errorContent)
        Write-Host "Response: $($reader.ReadToEnd())"
    }
}
