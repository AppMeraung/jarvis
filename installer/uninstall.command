#!/bin/zsh
# Buang Jarvis dari Mac ini, termasuk kunci API dan tetapan yang disimpan.
LABEL="com.jarvis.assistant"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Applications/Jarvis Mini.app" "$HOME/Applications/Jarvis.app" "$HOME/Library/Application Support/Jarvis"
echo "Jarvis sudah dibuang."
