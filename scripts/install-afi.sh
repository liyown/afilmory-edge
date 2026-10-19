#!/usr/bin/env sh
set -eu

REPO="${AFI_REPO:-liyown/afilmory-edge}"
VERSION="${AFI_VERSION:-latest}"
INSTALL_DIR="${AFI_INSTALL_DIR:-$HOME/.local/bin}"
FROM_SOURCE="${AFI_FROM_SOURCE:-0}"

say() {
  printf '%s\n' "$*"
}

warn() {
  printf '警告: %s\n' "$*" >&2
}

die() {
  printf '错误: %s\n' "$*" >&2
  exit 1
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 --connect-timeout 15 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    return 1
  fi
}

os="$(uname -s)"
arch="$(uname -m)"

case "$os:$arch" in
  Darwin:arm64)
    asset="afi-darwin-arm64"
    ;;
  Darwin:x86_64)
    asset="afi-darwin-x86_64"
    ;;
  Linux:x86_64 | Linux:amd64)
    asset="afi-linux-x86_64"
    ;;
  Linux:aarch64 | Linux:arm64)
    asset="afi-linux-arm64"
    ;;
  *)
    die "暂不支持当前平台: $os $arch（支持 macOS/Linux 的 arm64 与 x86_64）"
    ;;
esac

tmp="$(mktemp -d "${TMPDIR:-/tmp}/afi-install.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT INT TERM

binary=""

if [ "$FROM_SOURCE" != "1" ]; then
  if [ "$VERSION" = "latest" ]; then
    base_url="https://github.com/$REPO/releases/latest/download"
  else
    base_url="https://github.com/$REPO/releases/download/$VERSION"
  fi
  archive="$tmp/$asset.tar.gz"

  say "正在下载 $asset..."
  if download "$base_url/$asset.tar.gz" "$archive"; then
    if download "$base_url/$asset.tar.gz.sha256" "$tmp/$asset.sha256" 2>/dev/null; then
      expected="$(tr -d '[:space:]' < "$tmp/$asset.sha256")"
      if command -v sha256sum >/dev/null 2>&1; then
        actual="$(sha256sum "$archive" | awk '{print $1}')"
      else
        actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
      fi
      [ "$expected" = "$actual" ] || die "校验失败，下载文件可能不完整"
    fi

    tar -xzf "$archive" -C "$tmp"
    [ -f "$tmp/afi" ] || die "压缩包里没有 afi 二进制"
    binary="$tmp/afi"
  else
    warn "没有找到当前平台的预编译包，尝试从源码安装。"
  fi
fi

if [ -z "$binary" ]; then
  command -v cargo >/dev/null 2>&1 || die "未安装 Rust/Cargo。请先安装 Rust: https://rustup.rs"

  say "正在从源码构建 afi（第一次会慢一些）..."
  if [ -f "apps/sync/Cargo.toml" ]; then
    source_dir="$PWD"
  else
    command -v git >/dev/null 2>&1 || die "从源码安装需要 git"
    source_dir="$tmp/source"
    git clone --depth 1 "https://github.com/$REPO.git" "$source_dir"
  fi

  cargo install --quiet --path "$source_dir/apps/sync" --locked --root "$tmp/cargo-root"
  binary="$tmp/cargo-root/bin/afi"
fi

mkdir -p "$INSTALL_DIR"
staged="$INSTALL_DIR/.afi.new.$$"
if command -v install >/dev/null 2>&1; then
  install -m 755 "$binary" "$staged"
else
  cp "$binary" "$staged"
  chmod 755 "$staged"
fi
mv "$staged" "$INSTALL_DIR/afi"

say ""
say "afi 已安装到 $INSTALL_DIR/afi"
"$INSTALL_DIR/afi" --version

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    say ""
    say "把下面这行加入你的 shell 配置（~/.zshrc 或 ~/.bashrc）："
    say "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

say ""
say "下一步："
say "  afi login"
say "  cd ~/Pictures/import && afi add"
