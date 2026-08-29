# Copy worker.js to clipboard

$code = Get-Content -Path 'c:\Users\MUSTA\Desktop\WEBSITE\MUSTA FINAL HTML\worker.js' -Raw

# Copy to clipboard
Set-Clipboard -Value $code

Write-Host "Worker code copied to clipboard! (check)"
Write-Host ("File size: " + $code.Length + " bytes")
Write-Host ""
Write-Host "Now do this in Cloudflare editor:"
Write-Host "1. Press Ctrl+A (select all)"
Write-Host "2. Press Delete"
Write-Host "3. Press Ctrl+V (paste)"
Write-Host "4. Click Deploy button"
