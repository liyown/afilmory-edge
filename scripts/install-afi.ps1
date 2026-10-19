$ErrorActionPreference = "Stop"

$Repo = if ($env:AFI_REPO) { $env:AFI_REPO } else { "liyown/afilmory-edge" }
$Version = if ($env:AFI_VERSION) { $env:AFI_VERSION } else { "latest" }
$InstallDir = if ($env:AFI_INSTALL_DIR) {
    $env:AFI_INSTALL_DIR
} else {
    Join-Path $env:LOCALAPPDATA "afi\bin"
}
$FromSource = $env:AFI_FROM_SOURCE -eq "1"

$machine = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
switch ($machine) {
    "AMD64" { $asset = "afi-windows-x86_64" }
    "ARM64" {
        $asset = "afi-windows-x86_64"
        Write-Warning "当前使用 Windows ARM64，将安装 x64 版本（Windows 会自动模拟运行）。"
    }
    default { throw "暂不支持当前架构: $machine" }
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("afi-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

try {
    $binary = $null

    if (-not $FromSource) {
        if ($Version -eq "latest") {
            $baseUrl = "https://github.com/$Repo/releases/latest/download"
        } else {
            $baseUrl = "https://github.com/$Repo/releases/download/$Version"
        }

        $zip = Join-Path $tmp "$asset.zip"
        Write-Host "正在下载 $asset..."
        $downloaded = $false
        try {
            Invoke-WebRequest -Uri "$baseUrl/$asset.zip" -OutFile $zip -UseBasicParsing
            $downloaded = $true
        } catch {
            # Fall back to a source build when the release asset is unavailable.
        }

        if ($downloaded) {
            $checksum = "$zip.sha256"
            try {
                Invoke-WebRequest -Uri "$baseUrl/$asset.zip.sha256" -OutFile $checksum -UseBasicParsing
            } catch {
                $checksum = $null
            }
            if ($checksum -and (Test-Path $checksum)) {
                $expected = (Get-Content $checksum -Raw).Trim().ToLower()
                $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
                if ($expected -ne $actual) {
                    throw "校验失败，下载文件可能不完整"
                }
            }

            Expand-Archive -Path $zip -DestinationPath $tmp -Force
            $candidate = Join-Path $tmp "afi.exe"
            if (Test-Path $candidate) {
                $binary = $candidate
            }
        } else {
            Write-Warning "没有找到当前平台的预编译包，尝试从源码安装。"
        }
    }

    if (-not $binary) {
        if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
            throw "未安装 Rust/Cargo。请先安装 Rust: https://rustup.rs"
        }

        Write-Host "正在从源码构建 afi（第一次会慢一些）..."
        if (Test-Path "apps\sync\Cargo.toml") {
            $sourceDir = (Get-Location).Path
        } else {
            if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
                throw "从源码安装需要 git"
            }
            $sourceDir = Join-Path $tmp "source"
            git clone --depth 1 "https://github.com/$Repo.git" $sourceDir
        }

        $cargoRoot = Join-Path $tmp "cargo-root"
        cargo install --quiet --path (Join-Path $sourceDir "apps\sync") --locked --root $cargoRoot
        $binary = Join-Path $cargoRoot "bin\afi.exe"
    }

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    $target = Join-Path $InstallDir "afi.exe"
    Copy-Item $binary $target -Force

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $parts = @($userPath -split ";" | Where-Object { $_ })
    if ($parts -notcontains $InstallDir) {
        $newPath = (($parts + $InstallDir) -join ";")
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    }
    $env:Path = "$env:Path;$InstallDir"

    Write-Host ""
    Write-Host "afi 已安装到 $target"
    & $target --version

    Write-Host ""
    Write-Host "下一步："
    Write-Host "  afi login -s https://photos.liuyaowen.cn"
    Write-Host "  cd $HOME\Pictures\import; afi add"
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
