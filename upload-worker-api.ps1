# Upload worker.js to Cloudflare using REST API

$workerCode = Get-Content -Path 'c:\Users\MUSTA\Desktop\WEBSITE\MUSTA FINAL HTML\worker.js' -Raw

$accountId = '4fb9c546cc898314c24d358bb3360f92'
$workerName = 'djmustasongs'
$bearerToken = 'cfut_weCAW6ThFQzMhPADQMAZPzuxmMyIIWWzp79m78dgfc27c3f9'

# API endpoint
$uri = "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/$workerName"

# Headers
$headers = @{
    'Authorization' = "Bearer $bearerToken"
    'Content-Type' = 'application/javascript'
}

Write-Host "Starting upload..."
Write-Host "URI: $uri"
Write-Host "Code size: $($workerCode.Length) bytes"
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $uri `
        -Method Put `
        -Headers $headers `
        -Body $workerCode `
        -ContentType 'application/javascript' `
        -ErrorAction Stop
    
    Write-Host "SUCCESS! Response:"
    Write-Host ($response | ConvertTo-Json)
    
} catch {
    Write-Host "FAILED with error:"
    Write-Host $_.Exception.Message
    
    if ($_.Exception.Response) {
        $streamReader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $streamReader.BaseStream.Position = 0
        $responseBody = $streamReader.ReadToEnd()
        Write-Host "Response: $responseBody"
    }
}
