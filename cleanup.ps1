$ErrorActionPreference = "Stop"
$maxRetries = 5
$retryDelay = 2

function Force-Delete-Path ($path) {
    if (Test-Path $path) {
        Write-Host "Deleting $path..."
        for ($i = 0; $i -lt $maxRetries; $i++) {
            try {
                Remove-Item -Recurse -Force $path -ErrorAction Stop
                Write-Host "Deleted $path"
                return
            } catch {
                Write-Host "Attempt $($i+1) failed: $_"
                Start-Sleep -Seconds $retryDelay
            }
        }
        Write-Error "Failed to delete $path after $maxRetries attempts."
    } else {
        Write-Host "$path does not exist."
    }
}

Force-Delete-Path "node_modules"
Force-Delete-Path "package-lock.json"
