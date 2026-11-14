#!/bin/zsh
# Pasang Jarvis terus dari GitHub:  curl -fsSL https://raw.githubusercontent.com/AppMeraung/jarvis/main/get.sh | zsh
set -e
T="$(mktemp -d)"
echo "Memuat turun Jarvis..."
curl -fsSL https://github.com/AppMeraung/jarvis/archive/refs/heads/main.tar.gz | tar -xz -C "$T"
zsh "$T/jarvis-main/installer/install.command"
