# Putra Beats

<p align="center">
  <img src="https://adamputra-bucket-demo.s3.ap-southeast-1.amazonaws.com/putrabeats.png" alt="Putra Beats Logo" />
</p>

<p align="center">
  <b>Premium Music for Discord</b><br/>
  Smooth playback, smart search, rich controls, filters, and a clean interactive player — optimized for Linux deployment.
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white">
  <img alt="discord.js" src="https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Linux%20%2F%20Debian-black">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg">
  <img alt="Status" src="https://img.shields.io/badge/status-active-success">
</p>

---

## Overview

**Putra Beats** is a premium Discord music bot built for modern server playback.

This Linux version keeps the same premium experience as the Windows build, while using a Linux-safe playback architecture for YouTube extraction, cookies, PO tokens, and ffmpeg handling.

It combines:
- fast music playback
- interactive player controls
- `/playsearch` with dropdown selection
- audio filters
- queue persistence
- polished embeds and branding
- Linux-ready deployment for Debian / Ubuntu VPS servers

The goal is simple: make a music bot that feels smooth, premium, and enjoyable to use — even on Linux where setup is stricter than Windows.

---

## Features

### Core playback
- Play songs from YouTube URLs
- Play playlists
- Play direct search queries
- Queue support
- Skip, pause, resume, and stop

### Smart search flow
- `/playsearch` slash command
- autocomplete while typing
- dropdown selection menu for search results
- cleaner experience than guessing the first result

### Rich player UI
- premium embedded “Now Playing” card
- song thumbnail
- duration display
- selected audio format display
- requester display
- queue preview

### Interactive controls
- Pause / Resume
- Back 10 seconds
- Skip 10 seconds
- Next track
- Stop playback
- Queue button
- DM current song title

### Audio filters
- None
- Bass Boost
- Nightcore
- Slow + Reverb
- Slow

### Linux stability improvements
- queue persistence via `queue.json`
- Linux-safe `yt-dlp -> ffmpeg -> Discord` streaming pipeline
- cookies.txt support for YouTube authentication
- PO token provider support for YouTube playback
- system ffmpeg support on Debian / Ubuntu
- alternative song fallback when a source becomes unavailable
- interaction error handling
- voice reconnect behavior

---

## Commands

### Music
- `/play <query>` — Play a song, playlist, or exact query
- `/playsearch <query>` — Search results and choose one from a dropdown
- `/queue` — Show the current queue

### Playback
- `/pause` — Pause the current song
- `/resume` — Resume playback
- `/skip` — Skip the current song
- `/stop` — Stop playback and clear the queue

### Audio
- `/filter <type> <restart_song>` — Apply an audio filter
- `/help` — Open the Putra Beats command center

---

## Player Buttons

The embedded player includes interactive controls:

- **Pause / Resume** — Toggle playback
- **Back 10s** — Rewind 10 seconds
- **Skip 10s** — Jump forward 10 seconds
- **Next** — Skip to the next track
- **Stop** — Stop playback
- **Queue** — Show current queue
- **DM Song** — Send the current song title to your DM

---

## Tech Stack

- [Node.js](https://nodejs.org/)
- [discord.js v14](https://discord.js.org/)
- [@discordjs/voice](https://www.npmjs.com/package/@discordjs/voice)
- [yt-dlp-exec](https://www.npmjs.com/package/yt-dlp-exec)
- [ffmpeg](https://ffmpeg.org/)
- [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider)

---

## Installation

### 1. Clone the project

```bash
git clone https://github.com/adamdev-id/Putra-Beats-Music-Player.git
cd Putra-Beats-Music-Player
```

### 2. Install Linux dependencies

For Debian / Ubuntu:

```bash
sudo apt update
sudo apt install -y ffmpeg git curl
```

Check ffmpeg:

```bash
which ffmpeg
ffmpeg -version
```

Expected path:

```bash
/usr/bin/ffmpeg
```

### 3. Install Node dependencies

```bash
npm install
```

### 4. Create `config.json`

Create a `config.json` file in the project root:

```json
{
  "token": "YOUR_BOT_TOKEN",
  "clientId": "YOUR_APPLICATION_CLIENT_ID",
  "guildId": "YOUR_TEST_GUILD_ID"
}
```

### 5. Create YouTube cookies folder

```bash
mkdir -p /opt/Putra-Beats-Music-Player/secrets
```

Export your YouTube cookies to:

```txt
/opt/Putra-Beats-Music-Player/secrets/youtube-cookies.txt
```

Then lock permissions:

```bash
chmod 600 /opt/Putra-Beats-Music-Player/secrets/youtube-cookies.txt
```

### 6. Install PO token provider plugin

```bash
mkdir -p ~/.config/yt-dlp/plugins
cd /tmp
curl -L -o bgutil-ytdlp-pot-provider.zip \
  https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip
cp bgutil-ytdlp-pot-provider.zip ~/.config/yt-dlp/plugins/
```

### 7. Install and run bgutil provider server

```bash
cd ~
git clone --single-branch --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git
cd ~/bgutil-ytdlp-pot-provider/server
npm ci
npx tsc
nohup node build/main.js > ~/bgutil-provider.log 2>&1 &
```

Optional check:

```bash
ps aux | grep build/main.js
tail -n 50 ~/bgutil-provider.log
```

### 8. Deploy slash commands

```bash
node deploy-commands.js
```

### 9. Start the bot

```bash
export YTDLP_COOKIES_FILE=/opt/Putra-Beats-Music-Player/secrets/youtube-cookies.txt
export YTDLP_EXTRACTOR_ARGS=youtube:player_client=mweb
export FFMPEG_PATH=/usr/bin/ffmpeg
unset YTDLP_USER_AGENT
node index.js
```

---

## Linux Setup Notes

If you are deploying on Debian / Ubuntu:

1. Install Node.js 20+
2. Install ffmpeg from apt
3. Run `npm install`
4. Export a valid `cookies.txt` from a signed-in YouTube session
5. Install the PO token plugin and provider server
6. Deploy commands with `node deploy-commands.js`
7. Start the bot with the Linux environment variables shown above

Windows is usually easier because YouTube playback tends to be less strict in local testing.

Linux is more sensitive because playback depends on:
- valid YouTube cookies
- extractor client selection
- PO tokens
- system ffmpeg behavior
- piping yt-dlp into ffmpeg instead of letting ffmpeg fetch YouTube URLs directly

---

## Server Deployment Notes

For a private VPS or Linux server:

- install Node.js 20+
- install ffmpeg with apt
- install dependencies with `npm install`
- keep the project running with **pm2**, **systemd**, or Docker
- redeploy commands after changing slash command definitions
- make sure outbound network access is allowed for Discord and YouTube-related requests
- keep your `youtube-cookies.txt` file private and refreshed when needed

Example using PM2:

```bash
npm install -g pm2
pm2 start index.js --name putra-beats --update-env
pm2 save
pm2 startup
```

Example environment before PM2 start:

```bash
export YTDLP_COOKIES_FILE=/opt/Putra-Beats-Music-Player/secrets/youtube-cookies.txt
export YTDLP_EXTRACTOR_ARGS=youtube:player_client=mweb
export FFMPEG_PATH=/usr/bin/ffmpeg
unset YTDLP_USER_AGENT
```

---

## `/playsearch` Flow

`/playsearch` gives Putra Beats a more premium music selection flow:

1. User types `/playsearch`
2. Discord autocomplete suggests search text matches while typing
3. Bot returns a dropdown menu with top results
4. User selects the desired song
5. Bot queues or plays the chosen track

This is the closest Discord-native experience to a search combobox.

---

## Configuration Notes

### `config.json`

| Key | Description |
|---|---|
| `token` | Discord bot token |
| `clientId` | Discord application client ID |
| `guildId` | Test server ID for guild command deployment |

### Queue persistence

The bot stores queue state in:

```txt
queue.json
```

This allows the bot to restore queued songs after a restart in supported scenarios.

### Linux environment variables

| Variable | Description |
|---|---|
| `YTDLP_COOKIES_FILE` | Path to exported YouTube cookies |
| `YTDLP_EXTRACTOR_ARGS` | Recommended: `youtube:player_client=mweb` |
| `FFMPEG_PATH` | Recommended: `/usr/bin/ffmpeg` |
| `YTDLP_USER_AGENT` | Leave unset unless you know you need it |

---

## Troubleshooting

### Commands do not appear
Re-run:

```bash
node deploy-commands.js
```

Then restart the bot.

### Bot joins but no music plays
Check:
- bot has permission to connect and speak
- `ffmpeg` is installed and available at `/usr/bin/ffmpeg`
- current source is playable
- cookies file is valid
- PO token provider is running

### `Unknown interaction`
This usually means the bot responded too late to a slash command, select menu, or button interaction. Use deferred replies or deferred updates for actions that take time.

### `Sign in to confirm you're not a bot`
This usually means your YouTube cookies are invalid, expired, or exported incorrectly.

Fix:
- sign in to YouTube in a fresh private/incognito browser window
- export a fresh `cookies.txt`
- replace the old file on the server

### `LOGIN_REQUIRED`
This usually means the current cookies are not being accepted by YouTube.

Fix:
- refresh cookies
- confirm the bot is using the correct cookie file path
- keep `youtube:player_client=mweb`

### `403 Forbidden`
This can happen if ffmpeg tries to fetch YouTube media directly.

The Linux version avoids this by using:

```txt
yt-dlp -> ffmpeg -> Discord
```

### `No supported JavaScript runtime could be found`
Make sure Node.js 20+ is installed and the bot uses:

```txt
jsRuntimes: 'node'
```

### `Requested format is not available`
This can happen on certain YouTube videos depending on extraction path, cookies, PO tokens, or available formats.

The bot includes fallback logic and Linux-safe streaming behavior, but some videos may still require refreshed cookies or a working PO token provider.

### Bot cannot DM the current song
The user may have DMs disabled for the server.

---

## Branding

### App description

**Putra Beats is a premium Discord music bot built for smooth playback, smart search, rich controls, audio filters, and a clean modern player experience.**

### Short description

**Premium Discord music bot with smart search, rich controls, filters, and a sleek interactive player.**

### Help title

**Putra Beats • Command Center**

---

## Project Structure

```txt
.
├── config.json
├── config.example.json
├── deploy-commands.js
├── index.js
├── package.json
├── queue.json
├── README.md
├── .gitignore
└── secrets/
    └── youtube-cookies.txt
```

---

## Recommended Improvements

Ideas for future Linux upgrades:

- loop song / loop queue
- shuffle queue
- lyrics command
- volume control
- remove selected track from queue
- queue pagination
- now playing progress bar
- Spotify / SoundCloud support
- temp current / temp next audio caching for smoother Linux skip behavior
- dashboard / web panel
- automatic cookie health checks
- systemd deployment template

---

## License
This project is licensed under the MIT License.

---

## Credits

Built with ❤️ by **Firdaus Adam Friska Putra**.
