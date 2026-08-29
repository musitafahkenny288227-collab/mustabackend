$token = "cfut_weCAW6ThFQzMhPADQMAZPzuxmMyIIWWzp79m78dgfc27c3f9"
$accountId = "4fb9c546cc898314c24d358bb3360f92"
$scriptName = "djmusta"

# Read the worker.js file
$workerCode = Get-Content -Path "MUSTA FINAL HTML\worker.js" -Raw

# Create the API URL
$apiUrl = "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/$scriptName"

# Create headers
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/javascript"
}

# Deploy the worker
try {
    Write-Host "Deploying worker to Cloudflare..."
    Write-Host "URL: $apiUrl"
    
    $response = Invoke-WebRequest -Uri $apiUrl `
        -Method PUT `
        -Headers $headers `
        -Body $workerCode `
        -ErrorAction Stop
    
    $result = $response.Content | ConvertFrom-Json
    Write-Host "Deploy response:"
    Write-Host ($result | ConvertTo-Json -Depth 10)
    
    if ($result.success) {
        Write-Host "[OK] Worker deployed successfully!" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Deployment failed:" -ForegroundColor Red
        Write-Host ($result.errors | ConvertTo-Json)
    }
} catch {
    Write-Host "[ERROR] Error during deployment:" -ForegroundColor Red
    Write-Host "Status Code: " $_.Exception.Response.StatusCode
    Write-Host "Message: " $_.Exception.Message
    try {
        $streamReader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $errorBody = $streamReader.ReadToEnd()
        Write-Host "Response Body:" $errorBody
    } catch {
        Write-Host "Could not read response body"
    }
}
