#!/bin/zsh
# Builds "Jarvis Mini.app" from mini.swift for both Apple Silicon and Intel Macs.
# Usage: build-mini.sh [folder]   (default: the Desktop)
set -e
cd "$(dirname "$0")"
APP="${1:-$HOME/Desktop}/Jarvis Mini.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
BIN="$APP/Contents/MacOS/JarvisMini"
swiftc -O -target arm64-apple-macos13 mini.swift -o "$BIN-arm64"
swiftc -O -target x86_64-apple-macos13 mini.swift -o "$BIN-x86_64"
lipo -create "$BIN-arm64" "$BIN-x86_64" -output "$BIN"
rm "$BIN-arm64" "$BIN-x86_64"
cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Jarvis Mini</string>
  <key>CFBundleIdentifier</key><string>com.jarvis.mini</string>
  <key>CFBundleExecutable</key><string>JarvisMini</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>Jarvis mendengar arahan suara anda.</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
EOF
xattr -cr "$APP" # Finder attributes on the Desktop make codesign refuse
codesign --force --sign - "$APP"
echo "Siap: $APP"
