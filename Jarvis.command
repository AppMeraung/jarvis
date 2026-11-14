#!/bin/zsh
# Double-click untuk hidupkan Jarvis.
cd "$(dirname "$0")"
(sleep 1 && open http://localhost:4199) &
exec node server.js
