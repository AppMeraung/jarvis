#!/bin/zsh
# Pemasang Jarvis. Dwiklik fail ini. Ia menyalin Jarvis ke Mac ini dan menghidupkannya setiap kali Mac dibuka.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/app"                 # layout of the zip
[ -d "$SRC" ] || SRC="$HERE/.."   # layout of the GitHub repository
DEST="${JARVIS_HOME:-$HOME/Library/Application Support/Jarvis}"
URL="http://localhost:4199"
LABEL="com.jarvis.assistant"

NODE="$(command -v node || true)"
for p in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.local/bin/node"; do [ -z "$NODE" ] && [ -x "$p" ] && NODE="$p"; done
if [ -z "$NODE" ] || [ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Jarvis perlukan Node.js versi 20 atau lebih baru."
  echo "Pasang dari https://nodejs.org (butang LTS), kemudian dwiklik fail ini semula."
  open "https://nodejs.org/en/download"
  exit 1
fi

mkdir -p "$DEST"
for f in server.js tools.js autopilot.js index.html head facepoly; do rm -rf "$DEST/$f"; cp -R "$SRC/$f" "$DEST/$f"; done
cp "$HERE/uninstall.command" "$DEST/"   # kunci API dan tetapan sedia ada (.env, permissions.json) tidak disentuh
echo "Jarvis disalin ke: $DEST"
[ -n "$JARVIS_NO_AGENT" ] && exit 0   # untuk ujian: salin sahaja

PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$HOME/Applications"
OPEN="open -na 'Google Chrome' --args --app=$URL 2>/dev/null || open $URL"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-c</string>
    <string>(sleep 3; $OPEN) &amp; exec "$NODE" "$DEST/server.js"</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/jarvis.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/jarvis.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

rm -rf "$HOME/Applications/Jarvis.app"
osacompile -o "$HOME/Applications/Jarvis.app" \
  -e "do shell script \"launchctl kickstart gui/\$(id -u)/$LABEL; sleep 1; $OPEN\""

if [ -d "$HERE/Jarvis Mini.app" ]; then   # the small floating head
  rm -rf "$HOME/Applications/Jarvis Mini.app"
  cp -R "$HERE/Jarvis Mini.app" "$HOME/Applications/"
  xattr -dr com.apple.quarantine "$HOME/Applications/Jarvis Mini.app" 2>/dev/null || true
  codesign --force --sign - "$HOME/Applications/Jarvis Mini.app" 2>/dev/null || true
fi

echo
echo "Siap. Jarvis akan terbuka sebentar lagi."
echo "Langkah pertama: masukkan kunci API Gemini di TETAPAN (percuma dari aistudio.google.com/apikey)."
echo "Untuk buka semula kemudian: Applications dalam folder rumah anda > Jarvis."
echo "Jarvis Mini (kepala terapung di tepi skrin) ada di folder yang sama."
