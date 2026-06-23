TrackSplit Studio portable use
==============================

How to start:
1. Double-click Start-TrackSplit.bat.
2. Keep the command window open.
3. Open http://127.0.0.1:4173/ in a browser.

Features:
- Convert the original full audio to M4A (AAC 192 kbps, 44,100 Hz, stereo).
- Search kugeci.com for matching LRC lyrics using the audio filename.
- Convert Traditional Chinese filenames to Simplified Chinese before searching.
- Convert downloaded Simplified Chinese LRC files to Taiwan Traditional Chinese.

Filename suggestion:
- Singer - Song title.mp3
- The app searches by song title and uses the singer name to rank matching results.

Required files:
- index.html
- server.js
- Start-TrackSplit.bat
- package.json
- node_modules\
- bin\ffmpeg.exe or ffmpeg on PATH
- bin\node.exe or node on PATH

GitHub note:
- The repo is configured to keep large binary tools out of version control.
- If you want the portable Windows bundle, keep the executables in your local working copy or publish them as a release asset.

Notes:
- Lyrics search and download require an internet connection.
- Lyrics are provided by kugeci.com. Follow the website terms and copyright rules.
