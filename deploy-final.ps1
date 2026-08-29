# Final attempt: Upload worker to Cloudflare using correct endpoint

$code = Get-Content -Path 'c:\Users\MUSTA\Desktop\WEBSITE\MUSTA FINAL HTML\worker.js' -Raw

$accountId = '4fb9c546cc898314c24d358bb3360f92'
$workerId = 'djmustasongs'
$token = 'cfut_weCAW6ThFQzMhPADQMAZPzuxmMyIIWWzp79m78dgfc27c3f9'

# Try the /content endpoint which is for script content upload
$url = "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/services/$workerId/environments/production/content"

Write-Host "Uploading to: $url"
Write-Host "Code size: $($code.Length) bytes"
Write-Host ""

$headers = @{
    'Authorization' = "Bearer $token"
}

try {
    # Use Invoke-RestMethod for better JSON handling
    $response = Invoke-RestMethod -Uri $url `
        -Method 'PUT' `
        -Headers $headers `
        -Body $code `
        -ContentType 'application/javascript' `
        -ErrorAction Stop
    
    Write-Host "SUCCESS!"
    Write-Host ($response | ConvertTo-Json -Depth 3)
    Write-Host ""
    Write-Host "Deployed! Test: https://djmusta.com/artist/bobi-wine"
    
} catch {
    Write-Host "API Error:"
    Write-Host $_.Exception.Message
    
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $stream.Position = 0
        $reader = [System.IO.StreamReader]::new($stream)
        $body = $reader.ReadToEnd()
        Write-Host "Response: $body"
    }
}
