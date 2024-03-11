param ( 
    [string]$BackendPort = "3001",
    [bool]$Dev = $true
)

function Find-GitRoot {
    param  (
        [System.IO.DirectoryInfo]$dir
    )
    if (Test-Path "$($dir.FullName)\.git") { return $dir }
    else {
        if ($dir.Parent -ne $null) { return Find-GitRoot -dir $dir.Parent }
        else { return $null }
    }
}

function MoveTo-GitRoot {
    $cur = Get-Location

    $root = Find-GitRoot -dir (Get-Item $cur)
    
    if ($root -ne $null) {
        Set-Location -Path $root.FullName
        Write-Output "Moved to Git root: $($root.FullName)"
        return $true
    } else { 
        Write-Output "No Git root found in any parent directories"
        return $false
    }
}

function TestBinary {
    param (
        [string]$BinaryName
    )

    return Test-Path $(Get-Command $BinaryName).Source
}

# 1. Move to git root
$success = MoveTo-GitRoot
if ($success -eq $false) { exit -1 }

# 2. Test npm
$success = TestBinary -BinaryName npm
if ($success -eq $false) {
    Write-Output "Could not find npm - make sure it exists in current directory or on path"
    exit -1
}

# 3. Test npx
$success = TestBinary -BinaryName npx
if ($success -eq $false) {
    Write-Output "Could not find npx - make sure it exists in current directory or on path"
    exit -1
}

# 4. start backend | npx tsx server/index.ts --port 3001 --dev
$BackendProcessArguments = @{
    "FilePath" = $(Get-Command npx).Source
    "ArgumentList" = @(
        "tsx"
        "server/index.ts"
        "--port"
        $BackendPort
    )
}

if ($Dev -eq $true) { $BackendProcessArguments["ArgumentList"] += "--dev" }

Start-Process @BackendProcessArguments

# 5. start frontend
$FrontendProcessArguments = @{
    "FilePath" = $(Get-Command npm).Source
    "ArgumentList" = @(
        "run"
    )
}

if ($Dev -eq $true) { $FrontendProcessArguments["ArgumentList"] += "dev" }

Start-Process @FrontendProcessArguments
