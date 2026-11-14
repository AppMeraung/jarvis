#!/bin/zsh
# Bina dist/Jarvis.zip untuk diberi kepada pembeli: kod dan pemasang sahaja, tanpa kunci API atau tetapan Mac ini.
set -e
cd "$(dirname "$0")"
node --test
rm -rf dist && mkdir -p dist/Jarvis/app
cp server.js tools.js index.html dist/Jarvis/app/
cp -R head facepoly dist/Jarvis/app/
cp -R installer/ dist/Jarvis/
chmod +x dist/Jarvis/*.command
if grep -rIl "AIza" dist/Jarvis; then echo "BERHENTI: ada kunci API dalam pakej"; exit 1; fi
(cd dist && zip -qr Jarvis.zip Jarvis)
ls -lh dist/Jarvis.zip
