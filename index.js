const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags
} = require('discord.js');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  entersState,
  StreamType
} = require('@discordjs/voice');

const ytdlp = require('yt-dlp-exec');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const ytdlpBinaryPath = path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');

const config = require('./config.json');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

const queue = new Map();
const searchSelectionCache = new Map();

const QUEUE_FILE = path.join(__dirname, 'queue.json');
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

const DEFAULT_COOKIES_FILE = '/opt/Putra-Beats-Music-Player/secrets/youtube-cookies.txt';
const DEFAULT_YTDLP_EXTRACTOR_ARGS = 'youtube:player_client=mweb';
const DEFAULT_STREAM_FORMAT = 'ba[protocol^=http]/ba/bestaudio/best';

const FILTERS = {
  none: null,
  bass: 'bass=g=10',
  nightcore: 'asetrate=48000*1.1,aresample=48000,atempo=1.0',
  reverb: 'atempo=0.9,aecho=0.8:0.9:1000:0.3',
  slow: 'atempo=0.85'
};

// ================= YT-DLP =================

function getCookiesFilePath() {
  const cookiesPath = process.env.YTDLP_COOKIES_FILE || DEFAULT_COOKIES_FILE;
  return fs.existsSync(cookiesPath) ? cookiesPath : null;
}

function getYtdlpBaseOptions() {
  const options = {
    jsRuntimes: 'node',
    extractorArgs: process.env.YTDLP_EXTRACTOR_ARGS || DEFAULT_YTDLP_EXTRACTOR_ARGS
  };

  const cookiesPath = getCookiesFilePath();
  if (cookiesPath) {
    options.cookies = cookiesPath;
  }

  if (process.env.YTDLP_USER_AGENT) {
    options.userAgent = process.env.YTDLP_USER_AGENT;
  }

  return options;
}

function buildYtdlpCliArgs(url, extraOptions = {}) {
  const options = {
    ...getYtdlpBaseOptions(),
    ...extraOptions
  };

  const args = [];

  if (options.jsRuntimes) {
    args.push('--js-runtimes', String(options.jsRuntimes));
  }

  if (options.cookies) {
    args.push('--cookies', String(options.cookies));
  }

  if (options.userAgent) {
    args.push('--user-agent', String(options.userAgent));
  }

  if (options.extractorArgs) {
    args.push('--extractor-args', String(options.extractorArgs));
  }

  if (options.format) {
    args.push('-f', String(options.format));
  }

  args.push('--no-playlist', '-o', '-', url);

  return args;
}

function formatAudioLabel(format) {
  if (!format) return 'Unknown';

  const ext = format.ext ? String(format.ext).toUpperCase() : 'Unknown';
  const abr = format.abr ? `${Math.round(format.abr)} kbps` : null;
  const codec =
    format.acodec && format.acodec !== 'none'
      ? String(format.acodec)
      : null;

  return [ext, abr, codec].filter(Boolean).join(' • ');
}

function sortAudioFormats(a, b) {
  const isDirect = (format) =>
    typeof format?.protocol === 'string' && !format.protocol.includes('m3u8');

  const directA = isDirect(a) ? 1 : 0;
  const directB = isDirect(b) ? 1 : 0;
  if (directB !== directA) return directB - directA;

  const abrA = Number(a?.abr || a?.tbr || 0);
  const abrB = Number(b?.abr || b?.tbr || 0);
  if (abrB !== abrA) return abrB - abrA;

  const asrA = Number(a?.asr || 0);
  const asrB = Number(b?.asr || 0);
  if (asrB !== asrA) return asrB - asrA;

  return 0;
}

function pickBestAudioFormat(info) {
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  if (!formats.length) return null;

  const audioOnly = formats
    .filter((format) =>
      format &&
      format.url &&
      format.acodec &&
      format.acodec !== 'none' &&
      format.vcodec === 'none'
    )
    .sort(sortAudioFormats);

  return audioOnly[0] || null;
}

async function getDirectPlayableUrl(songUrl) {
  const info = await ytdlp(songUrl, {
    ...getYtdlpBaseOptions(),
    dumpSingleJson: true,
    format: DEFAULT_STREAM_FORMAT,
    formatSort: 'proto'
  });

  const requestedDownloads = Array.isArray(info?.requested_downloads)
    ? info.requested_downloads.filter(Boolean)
    : [];

  const requestedAudioOnly = requestedDownloads
    .filter((format) =>
      format &&
      format.url &&
      format.acodec &&
      format.acodec !== 'none' &&
      format.vcodec === 'none'
    )
    .sort(sortAudioFormats)[0];

  const selectedFormat = requestedAudioOnly || pickBestAudioFormat(info);

  if (!selectedFormat?.url) {
    throw new Error(`No playable audio format found for ${songUrl}`);
  }

  if (selectedFormat.vcodec && selectedFormat.vcodec !== 'none') {
    throw new Error(
      `Refusing non-audio-only format ${selectedFormat.format_id} (${selectedFormat.protocol || 'unknown'})`
    );
  }

  return {
    url: selectedFormat.url,
    label: formatAudioLabel(selectedFormat),
    formatId: selectedFormat.format_id
  };
}

// ================= UTILS =================

function isValidUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function formatDuration(seconds) {
  if (!seconds || Number.isNaN(seconds)) return 'Live';

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function parseDurationLabel(durationLabel) {
  if (!durationLabel || durationLabel === 'Live') return null;

  const parts = String(durationLabel)
    .split(':')
    .map((part) => Number(part));

  if (parts.some(Number.isNaN)) return null;

  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  return null;
}

function getThumbnail(info) {
  if (info?.thumbnail) return info.thumbnail;
  if (Array.isArray(info?.thumbnails) && info.thumbnails.length > 0) {
    const lastThumb = info.thumbnails[info.thumbnails.length - 1];
    return lastThumb?.url || null;
  }
  return null;
}

function humanizeFilter(filter) {
  switch (filter) {
    case 'bass':
      return 'Bass Boost';
    case 'nightcore':
      return 'Nightcore';
    case 'reverb':
      return 'Slow + Reverb';
    case 'slow':
      return 'Slow';
    default:
      return 'None';
  }
}

function formatQueuePreview(songs, limit = 5) {
  if (!songs.length) return 'Queue is empty.';

  return songs
    .slice(0, limit)
    .map((song, index) => {
      const prefix = index === 0 ? '▶️' : `${index}.`;
      return `${prefix} **${song.title}** \`${song.duration || 'Live'}\``;
    })
    .join('\n');
}

function truncateText(text, maxLength = 100) {
  const value = String(text || '');
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function cleanupSearchSelectionCache() {
  const now = Date.now();

  for (const [token, entry] of searchSelectionCache.entries()) {
    if (now - entry.createdAt > SEARCH_CACHE_TTL_MS) {
      searchSelectionCache.delete(token);
    }
  }
}

function killStream(serverQueue) {
  if (serverQueue?.currentSourceProcess && !serverQueue.currentSourceProcess.killed) {
    try {
      serverQueue.currentSourceProcess.kill('SIGKILL');
    } catch {}
  }

  if (serverQueue?.currentProcess && !serverQueue.currentProcess.killed) {
    try {
      serverQueue.currentProcess.kill('SIGKILL');
    } catch {}
  }

  serverQueue.currentSourceProcess = null;
  serverQueue.currentProcess = null;
}

function getElapsedSeconds(serverQueue) {
  if (!serverQueue?.startedAt) return 0;

  const now =
    serverQueue.isPaused && serverQueue.pausedAt
      ? serverQueue.pausedAt
      : Date.now();

  const elapsedMs = now - serverQueue.startedAt - (serverQueue.pauseOffsetMs || 0);
  return Math.max(0, Math.floor(elapsedMs / 1000));
}

// ================= SAVE / LOAD =================

function saveQueue() {
  const data = {};

  for (const [guildId, q] of queue.entries()) {
    data[guildId] = {
      songs: q.songs,
      history: q.history,
      voiceChannelId: q.voiceChannelId,
      textChannelId: q.textChannelId,
      filter: q.filter
    };
  }

  fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function createGuildQueue(guildId, voiceChannelId = null, textChannelId = null) {
  const player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Pause
    }
  });

  const serverQueue = {
    guildId,
    connection: null,
    player,
    songs: [],
    history: [],
    voiceChannelId,
    textChannelId,
    filter: 'none',
    isPaused: false,
    pendingAction: null,
    currentProcess: null,
    currentSourceProcess: null,
    nowPlayingMessage: null,
    startedAt: null,
    pausedAt: null,
    pauseOffsetMs: 0
  };

  player.on('error', async (error) => {
    console.error(`Player error in guild ${guildId}:`, error);

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      cleanupQueue(guildId);
      return;
    }

    if (serverQueue.pendingAction === 'stop') {
      serverQueue.pendingAction = null;
      await finishPlayerMessage(guild, '⏹️ Playback stopped');
      cleanupQueue(guildId);
      return;
    }

    serverQueue.pendingAction = null;
    serverQueue.songs.shift();
    saveQueue();

    if (serverQueue.songs.length) {
      await playSong(guild, serverQueue.songs[0]);
    } else {
      await finishPlayerMessage(guild, '✅ Queue finished');
      cleanupQueue(guildId);
    }
  });

  player.on(AudioPlayerStatus.Idle, async () => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      cleanupQueue(guildId);
      return;
    }

    serverQueue.isPaused = false;
    serverQueue.pausedAt = null;
    serverQueue.pauseOffsetMs = 0;
    serverQueue.startedAt = null;

    killStream(serverQueue);

    if (serverQueue.pendingAction === 'stop') {
      serverQueue.pendingAction = null;
      await finishPlayerMessage(guild, '⏹️ Playback stopped');
      cleanupQueue(guildId);
      return;
    }

    serverQueue.pendingAction = null;

    const finishedSong = serverQueue.songs.shift();
    if (finishedSong) {
      serverQueue.history.unshift(finishedSong);
    }

    saveQueue();

    if (!serverQueue.songs.length) {
      await finishPlayerMessage(guild, '✅ Queue finished');
      cleanupQueue(guildId);
      return;
    }

    await playSong(guild, serverQueue.songs[0]);
  });

  return serverQueue;
}

function loadQueue() {
  if (!fs.existsSync(QUEUE_FILE)) return;

  const data = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));

  for (const guildId of Object.keys(data)) {
    const saved = data[guildId];
    const serverQueue = createGuildQueue(
      guildId,
      saved.voiceChannelId || null,
      saved.textChannelId || null
    );

    serverQueue.songs = saved.songs || [];
    serverQueue.history = saved.history || [];
    serverQueue.filter = saved.filter || 'none';

    queue.set(guildId, serverQueue);
  }

  console.log('✅ Queue restored from disk');
}

loadQueue();

// ================= EMBEDS / BUTTONS =================

function buildControlRows(serverQueue, disabled = false) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music_pause_resume')
      .setLabel(serverQueue.isPaused ? 'Resume' : 'Pause')
      .setEmoji(serverQueue.isPaused ? '▶️' : '⏸️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId('music_back_10')
      .setLabel('Back 10s')
      .setEmoji('⏪')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId('music_forward_10')
      .setLabel('Skip 10s')
      .setEmoji('⏩')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId('music_next')
      .setLabel('Next')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId('music_stop')
      .setLabel('Stop')
      .setEmoji('⏹️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music_queue')
      .setLabel('Queue')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId('music_dm_song')
      .setLabel('DM Song')
      .setEmoji('✉️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );

  return [row1, row2];
}

function buildPlayerEmbed(guild, serverQueue, song, statusText = '🎶 Now Playing') {
  const embed = new EmbedBuilder()
    .setColor(serverQueue.isPaused ? 0xf1c40f : 0x5865f2)
    .setAuthor({
      name: 'Putra Beats Music Player',
      iconURL: client.user.displayAvatarURL()
    })
    .setTitle(song.title || 'Unknown title')
    .setURL(song.url || null)
    .setDescription(`${statusText}\n\nUse the buttons below to control the player.`)
    .addFields(
      {
        name: 'Duration',
        value: `\`${song.duration || 'Live'}\``,
        inline: true
      },
      {
        name: 'Filter',
        value: `\`${humanizeFilter(serverQueue.filter)}\``,
        inline: true
      },
      {
        name: 'Audio Format',
        value: `\`${song.audioFormat || 'Detecting...'}\``,
        inline: true
      },
      {
        name: 'Requested By',
        value: song.requestedBy ? `\`${song.requestedBy}\`` : '`Unknown`',
        inline: true
      },
      {
        name: 'Up Next',
        value:
          serverQueue.songs.length > 1
            ? serverQueue.songs
                .slice(1, 4)
                .map((item, i) => `${i + 1}. ${item.title}`)
                .join('\n')
            : 'No more tracks in queue.'
      }
    )
    .setFooter({
      text: `Putra Beats © 2026 • ${Math.max(serverQueue.songs.length - 1, 0)} more track(s)`
    })
    .setTimestamp();

  if (song.thumbnail) {
    embed.setThumbnail(song.thumbnail);
  }

  return embed;
}

function buildFinishedEmbed(guild, message) {
  return new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({
      name: 'Putra Beats Music Player',
      iconURL: client.user.displayAvatarURL()
    })
    .setTitle('Player Status')
    .setDescription(message)
    .setFooter({ text: guild.name })
    .setTimestamp();
}

function buildSearchResultsEmbed(query, results) {
  const lines = results.slice(0, 10).map((song, index) => {
    return `**${index + 1}.** ${song.title} \`${song.duration || 'Live'}\``;
  });

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({
      name: 'Putra Beats Music Player',
      iconURL: client.user.displayAvatarURL()
    })
    .setTitle('Search Results')
    .setDescription(`Results for **${truncateText(query, 100)}**\n\n${lines.join('\n')}`)
    .setFooter({ text: 'Choose one result from the dropdown below.' })
    .setTimestamp();
}

async function upsertPlayerMessage(guild, statusText = '🎶 Now Playing') {
  const serverQueue = queue.get(guild.id);
  if (!serverQueue || !serverQueue.textChannelId || !serverQueue.songs[0]) return;

  const channel = guild.channels.cache.get(serverQueue.textChannelId);
  if (!channel || !channel.isTextBased()) return;

  const payload = {
    embeds: [buildPlayerEmbed(guild, serverQueue, serverQueue.songs[0], statusText)],
    components: buildControlRows(serverQueue)
  };

  try {
    if (serverQueue.nowPlayingMessage) {
      serverQueue.nowPlayingMessage = await serverQueue.nowPlayingMessage.edit(payload);
    } else {
      serverQueue.nowPlayingMessage = await channel.send(payload);
    }
  } catch {
    try {
      serverQueue.nowPlayingMessage = await channel.send(payload);
    } catch (error) {
      console.error('Failed to send player embed:', error);
    }
  }
}

async function finishPlayerMessage(guild, message) {
  const serverQueue = queue.get(guild.id);
  if (!serverQueue || !serverQueue.textChannelId) return;

  const channel = guild.channels.cache.get(serverQueue.textChannelId);
  if (!channel || !channel.isTextBased()) return;

  const payload = {
    embeds: [buildFinishedEmbed(guild, message)],
    components: buildControlRows(serverQueue, true)
  };

  try {
    if (serverQueue.nowPlayingMessage) {
      serverQueue.nowPlayingMessage = await serverQueue.nowPlayingMessage.edit(payload);
    } else {
      serverQueue.nowPlayingMessage = await channel.send(payload);
    }
  } catch {}
}

// ================= VOICE =================

async function connectToVoice(guild, voiceChannelId, serverQueue) {
  const voiceChannel = guild.channels.cache.get(voiceChannelId);
  if (!voiceChannel) {
    throw new Error('Voice channel not found.');
  }

  if (
    serverQueue.connection &&
    serverQueue.connection.joinConfig.channelId === voiceChannelId
  ) {
    return serverQueue.connection;
  }

  if (serverQueue.connection) {
    try {
      serverQueue.connection.destroy();
    } catch {}
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true
  });

  serverQueue.connection = connection;
  connection.subscribe(serverQueue.player);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    connection.destroy();
    throw new Error('Failed to connect to voice channel.');
  }

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
      ]);
    } catch {
      cleanupQueue(guild.id);
    }
  });

  return connection;
}

function cleanupQueue(guildId) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue) return;

  killStream(serverQueue);

  try {
    serverQueue.connection?.destroy();
  } catch {}

  queue.delete(guildId);
  saveQueue();
}

// ================= SONG RESOLUTION =================

function mapSongInfo(info, originalQuery, requestedBy) {
  let songUrl =
    info?.webpage_url ||
    info?.original_url ||
    null;

  if (!songUrl && info?.id) {
    songUrl = `https://www.youtube.com/watch?v=${info.id}`;
  }

  if (!songUrl && typeof info?.url === 'string') {
    if (info.url.startsWith('http://') || info.url.startsWith('https://')) {
      songUrl = info.url;
    } else if (/^[a-zA-Z0-9_-]{11}$/.test(info.url)) {
      songUrl = `https://www.youtube.com/watch?v=${info.url}`;
    }
  }

  if (!songUrl && isValidUrl(originalQuery)) {
    songUrl = originalQuery;
  }

  return {
    title: info?.title || 'Unknown title',
    url: songUrl,
    thumbnail: getThumbnail(info),
    duration: formatDuration(info?.duration),
    requestedBy,
    audioFormat: 'Detecting...',
    alternativeTried: false
  };
}

async function resolveSongs(query, requestedBy) {
  const isUrl = isValidUrl(query);
  const isPlaylist = isUrl && query.includes('list=');
  const shouldUseFlat = !isUrl || isPlaylist;
  const input = isUrl ? query : `ytsearch1:${query}`;

  const result = await ytdlp(input, {
    ...getYtdlpBaseOptions(),
    dumpSingleJson: true,
    flatPlaylist: shouldUseFlat
  });

  const rawEntries = Array.isArray(result?.entries)
    ? result.entries.filter(Boolean)
    : [result];

  return rawEntries
    .map((entry) => mapSongInfo(entry, query, requestedBy))
    .filter((song) => song.url);
}

async function searchYouTubeResults(query, requestedBy, limit = 10) {
  const result = await ytdlp(`ytsearch${limit}:${query}`, {
    ...getYtdlpBaseOptions(),
    dumpSingleJson: true,
    flatPlaylist: true
  });

  const entries = Array.isArray(result?.entries) ? result.entries.filter(Boolean) : [];

  return entries
    .map((entry) => mapSongInfo(entry, query, requestedBy))
    .filter((song) => song.url)
    .slice(0, limit);
}

async function isSongPlayable(song) {
  if (!song?.url) return false;

  try {
    await getDirectPlayableUrl(song.url);
    return true;
  } catch {
    return false;
  }
}

async function findAlternativeSong(originalSong) {
  if (!originalSong?.title) return null;

  try {
    const result = await ytdlp(`ytsearch5:${originalSong.title}`, {
      ...getYtdlpBaseOptions(),
      dumpSingleJson: true,
      flatPlaylist: true
    });

    const entries = Array.isArray(result?.entries) ? result.entries.filter(Boolean) : [];

    for (const entry of entries) {
      const candidate = mapSongInfo(entry, originalSong.title, originalSong.requestedBy);

      if (!candidate?.url) continue;
      if (candidate.url === originalSong.url) continue;

      const playable = await isSongPlayable(candidate);
      if (!playable) continue;

      candidate.alternativeTried = true;
      return candidate;
    }

    return null;
  } catch (error) {
    console.error('Alternative search failed:', error);
    return null;
  }
}

async function tryPlayAlternative(guild, failedSong) {
  const serverQueue = queue.get(guild.id);
  if (!serverQueue) return false;

  const alternative = await findAlternativeSong(failedSong);
  if (!alternative) return false;

  console.log(`Fallback match found: ${failedSong.title} -> ${alternative.title}`);

  serverQueue.songs[0] = alternative;
  saveQueue();

  await upsertPlayerMessage(
    guild,
    '🔁 Original source unavailable, switched to a similar playable result'
  );

  await playSong(guild, alternative);
  return true;
}

// ================= PLAYER =================

async function playSong(guild, song, attempt = 0, startSeconds = 0) {
  const serverQueue = queue.get(guild.id);
  if (!serverQueue) return;

  if (!song) {
    await finishPlayerMessage(guild, '✅ Queue finished');
    cleanupQueue(guild.id);
    return;
  }

  try {
    if (!song.thumbnail || !song.duration || song.title === 'Unknown title') {
      try {
        const info = await ytdlp(song.url, {
          ...getYtdlpBaseOptions(),
          dumpSingleJson: true
        });

        song.title = info?.title || song.title;
        song.thumbnail = song.thumbnail || getThumbnail(info);
        song.duration = song.duration || formatDuration(info?.duration);
        saveQueue();
      } catch (error) {
        console.error('Metadata refresh error:', error);
      }
    }

    const streamData = await getDirectPlayableUrl(song.url);
    song.audioFormat = streamData.label;
    console.log(`Selected format ${streamData.formatId} (${streamData.label})`);

    const ytdlpArgs = buildYtdlpCliArgs(song.url, {
      format: DEFAULT_STREAM_FORMAT
    });

    const ffmpegArgs = [
      '-nostdin',
      '-loglevel', 'warning',
      '-i', 'pipe:0',
      '-vn'
    ];

    if (startSeconds > 0) {
      ffmpegArgs.push('-ss', String(startSeconds));
    }

    const filterChain = FILTERS[serverQueue.filter];
    if (filterChain) {
      ffmpegArgs.push('-af', filterChain);
    }

    ffmpegArgs.push(
      '-c:a', 'libopus',
      '-ar', '48000',
      '-ac', '2',
      '-b:a', '128k',
      '-f', 'ogg',
      'pipe:1'
    );

    killStream(serverQueue);

    const sourceProcess = spawn(ytdlpBinaryPath, ytdlpArgs, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const ffmpeg = spawn(ffmpegPath, ffmpegArgs, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverQueue.currentSourceProcess = sourceProcess;
    serverQueue.currentProcess = ffmpeg;

    sourceProcess.stdout.pipe(ffmpeg.stdin);

    ffmpeg.stdin.on('error', (error) => {
      if (error?.code !== 'EPIPE') {
        console.error('ffmpeg stdin error:', error);
      }
    });

    sourceProcess.stderr.on('data', (data) => {
      const message = String(data || '').trim();
      if (message) {
        console.error('[yt-dlp-stream]', message);
      }
    });

    sourceProcess.on('close', (code, signal) => {
      if (sourceProcess.stdout && !sourceProcess.stdout.destroyed) {
        sourceProcess.stdout.unpipe(ffmpeg.stdin);
      }

      if (ffmpeg.stdin && !ffmpeg.stdin.destroyed) {
        ffmpeg.stdin.end();
      }

      if (code && code !== 0) {
        console.error(`yt-dlp stream closed with code=${code} signal=${signal || 'none'}`);
      }

      if (serverQueue.currentSourceProcess === sourceProcess) {
        serverQueue.currentSourceProcess = null;
      }
    });

    sourceProcess.on('error', (error) => {
      console.error('yt-dlp stream spawn error:', error);
    });

    ffmpeg.stderr.on('data', (data) => {
      const message = String(data || '').trim();
      if (message) {
        console.error('[ffmpeg]', message);
      }
    });

    ffmpeg.on('close', (code, signal) => {
      if (sourceProcess.stdout && !sourceProcess.stdout.destroyed) {
        sourceProcess.stdout.unpipe(ffmpeg.stdin);
      }

      if (sourceProcess && !sourceProcess.killed) {
        try {
          sourceProcess.kill('SIGKILL');
        } catch {}
      }

      if (code && code !== 0) {
        console.error(`ffmpeg closed with code=${code} signal=${signal || 'none'}`);
      }

      if (serverQueue.currentProcess === ffmpeg) {
        serverQueue.currentProcess = null;
      }

      if (serverQueue.currentSourceProcess === sourceProcess) {
        serverQueue.currentSourceProcess = null;
      }
    });

    ffmpeg.on('error', (error) => {
      console.error('ffmpeg spawn error:', error);
    });

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.OggOpus
    });

    serverQueue.player.play(resource);
    serverQueue.isPaused = false;
    serverQueue.startedAt = Date.now() - (startSeconds * 1000);
    serverQueue.pausedAt = null;
    serverQueue.pauseOffsetMs = 0;

    await upsertPlayerMessage(
      guild,
      serverQueue.filter === 'none'
        ? '🎶 Now Playing'
        : `🎛️ Now Playing • ${humanizeFilter(serverQueue.filter)}`
    );

    saveQueue();
  } catch (error) {
    console.error('Playback error:', error);

    if (attempt < 2) {
      return playSong(guild, song, attempt + 1, startSeconds);
    }

    if (song && !song.alternativeTried && song.title) {
      song.alternativeTried = true;
      const swapped = await tryPlayAlternative(guild, song);
      if (swapped) return;
    }

    serverQueue.songs.shift();
    saveQueue();
    return playSong(guild, serverQueue.songs[0]);
  }
}

// ================= READY =================

client.once(Events.ClientReady, async () => {
  console.log(`✅ Ready: ${client.user.tag}`);
  console.log(`Using cookies file: ${getCookiesFilePath() || 'not found'}`);
  console.log(`Using extractor args: ${process.env.YTDLP_EXTRACTOR_ARGS || DEFAULT_YTDLP_EXTRACTOR_ARGS}`);
  console.log(`ffmpeg path: ${ffmpegPath}`);

  for (const [guildId, serverQueue] of queue.entries()) {
    if (!serverQueue.songs.length || !serverQueue.voiceChannelId) continue;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    try {
      await connectToVoice(guild, serverQueue.voiceChannelId, serverQueue);
      await playSong(guild, serverQueue.songs[0]);
    } catch (error) {
      console.error(`Failed to resume queue for guild ${guildId}:`, error);
      cleanupQueue(guildId);
    }
  }
});

// ================= HELPERS =================

function sameVoiceChannel(interaction) {
  const memberChannelId = interaction.member.voice.channelId;
  const botChannelId = interaction.guild.members.me?.voice?.channelId;

  return memberChannelId && botChannelId && memberChannelId === botChannelId;
}

async function sendQueueEmbed(interaction, serverQueue, ephemeral = false) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({
      name: 'Putra Beats Music Player',
      iconURL: client.user.displayAvatarURL()
    })
    .setTitle('Current Queue')
    .setDescription(formatQueuePreview(serverQueue.songs))
    .addFields({
      name: 'Total Songs',
      value: `\`${serverQueue.songs.length}\``,
      inline: true
    })
    .setTimestamp();

  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ embeds: [embed], ephemeral });
  }

  return interaction.reply({ embeds: [embed], ephemeral });
}

async function seekCurrentSong(guild, secondsOffset) {
  const serverQueue = queue.get(guild.id);
  if (!serverQueue || !serverQueue.songs.length) return false;

  const currentSong = serverQueue.songs[0];
  const currentElapsed = getElapsedSeconds(serverQueue);
  let targetSeconds = Math.max(0, currentElapsed + secondsOffset);

  const totalSeconds = parseDurationLabel(currentSong.duration);
  if (typeof totalSeconds === 'number') {
    targetSeconds = Math.min(targetSeconds, Math.max(0, totalSeconds - 1));
  }

  await playSong(guild, currentSong, 0, targetSeconds);
  return targetSeconds;
}

async function enqueueSongs(guild, voiceChannelId, textChannelId, songs) {
  let serverQueue = queue.get(guild.id);

  if (!serverQueue) {
    serverQueue = createGuildQueue(guild.id, voiceChannelId, textChannelId);
    queue.set(guild.id, serverQueue);
  }

  serverQueue.voiceChannelId = voiceChannelId;
  serverQueue.textChannelId = textChannelId;

  await connectToVoice(guild, voiceChannelId, serverQueue);

  serverQueue.songs.push(...songs);
  saveQueue();

  if (serverQueue.player.state.status !== AudioPlayerStatus.Playing && !serverQueue.isPaused) {
    await playSong(guild, serverQueue.songs[0]);
  } else {
    await upsertPlayerMessage(guild, '➕ Added to Queue');
  }

  return serverQueue;
}

// ================= COMMANDS / COMPONENTS =================

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName !== 'playsearch') return;

      const focused = interaction.options.getFocused();
      if (!focused || focused.trim().length < 2) {
        return interaction.respond([]);
      }

      let results = [];
      try {
        results = await searchYouTubeResults(focused.trim(), interaction.user.username, 8);
      } catch (error) {
        console.error('Autocomplete search error:', error);
      }

      return interaction.respond(
        results.slice(0, 8).map((song) => ({
          name: truncateText(song.title, 100),
          value: truncateText(song.title, 100)
        }))
      );
    }

    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'help') {
        const embed = new EmbedBuilder()
          .setColor(0x0f172a)
          .setAuthor({
            name: 'Putra Beats Music Player',
            iconURL: client.user.displayAvatarURL()
          })
          .setTitle('Putra Beats • Command Center')
          .setDescription(
            [
              'Premium Discord music, reimagined.',
              '',
              'Fast playback, smart search, rich player controls, sleek embeds, and a smooth listening experience for every server.'
            ].join('\n')
          )
          .addFields(
            {
              name: '🎵 Playback',
              value: [
                '`/play <query>`',
                'Play a song, playlist, or exact query instantly.',
                '',
                '`/playsearch <query>`',
                'Search results and choose a track from a dropdown menu.',
                '',
                '`/queue`',
                'View the current queue.'
              ].join('\n')
            },
            {
              name: '⏯ Control',
              value: [
                '`/pause`',
                'Pause the current track.',
                '',
                '`/resume`',
                'Resume playback.',
                '',
                '`/skip`',
                'Skip the current song.',
                '',
                '`/stop`',
                'Stop playback and clear the queue.'
              ].join('\n')
            },
            {
              name: '🎛 Audio',
              value: [
                '`/filter <type> <restart_song>`',
                'Apply sound effects like Bass Boost, Nightcore, Slow, or Reverb.',
                '',
                '`restart_song: yes`',
                'Restart the track from the beginning with the new filter.',
                '',
                '`restart_song: no`',
                'Continue near the current timestamp with the new filter.'
              ].join('\n')
            },
            {
              name: '🕹 Player Buttons',
              value: [
                '`Pause / Resume` — Toggle playback',
                '`Back 10s` — Rewind 10 seconds',
                '`Skip 10s` — Jump forward 10 seconds',
                '`Next` — Skip to the next track',
                '`Stop` — Stop playback',
                '`Queue` — Show the queue',
                '`DM Song` — Send the current song title to your DM'
              ].join('\n')
            },
            {
              name: '✨ Experience',
              value: [
                '• Clean embedded player UI',
                '• Smart search flow',
                '• Audio format detection',
                '• Queue persistence',
                '• Premium bot branding'
              ].join('\n')
            }
          )
          .setThumbnail(client.user.displayAvatarURL())
          .setFooter({
            text: 'Putra Beats • Premium Music for Discord'
          })
          .setTimestamp();

        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'play') {
        await interaction.deferReply();

        const query = interaction.options.getString('query');
        const voiceChannel = interaction.member.voice.channel;

        if (!voiceChannel) {
          return interaction.editReply('❌ Join a voice channel first.');
        }

        const existingQueue = queue.get(interaction.guild.id);
        if (
          existingQueue?.connection &&
          interaction.guild.members.me?.voice?.channelId &&
          interaction.guild.members.me.voice.channelId !== voiceChannel.id
        ) {
          return interaction.editReply('❌ You must be in the same voice channel as the bot.');
        }

        let songs;
        try {
          songs = await resolveSongs(query, interaction.user.username);
        } catch (error) {
          console.error('Resolve song error:', error);
          return interaction.editReply('❌ Could not find that song or playlist.');
        }

        if (!songs.length) {
          return interaction.editReply('❌ No playable results found.');
        }

        try {
          await enqueueSongs(interaction.guild, voiceChannel.id, interaction.channelId, songs);
        } catch (error) {
          console.error('Queue/play error:', error);
          return interaction.editReply('❌ Failed to join your voice channel or start playback.');
        }

        return interaction.editReply(
          songs.length === 1
            ? `🎵 Added **${songs[0].title}** to the queue.`
            : `🎶 Added playlist with **${songs.length}** tracks to the queue.`
        );
      }

      if (commandName === 'playsearch') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const query = interaction.options.getString('query');
        const voiceChannel = interaction.member.voice.channel;

        if (!voiceChannel) {
          return interaction.editReply('❌ Join a voice channel first.');
        }

        const existingQueue = queue.get(interaction.guild.id);
        if (
          existingQueue?.connection &&
          interaction.guild.members.me?.voice?.channelId &&
          interaction.guild.members.me.voice.channelId !== voiceChannel.id
        ) {
          return interaction.editReply('❌ You must be in the same voice channel as the bot.');
        }

        let results;
        try {
          results = await searchYouTubeResults(query, interaction.user.username, 10);
        } catch (error) {
          console.error('Playsearch error:', error);
          return interaction.editReply('❌ Search failed.');
        }

        if (!results.length) {
          return interaction.editReply('❌ No results found.');
        }

        cleanupSearchSelectionCache();

        const token = `${interaction.user.id}:${Date.now().toString(36)}`;
        searchSelectionCache.set(token, {
          createdAt: Date.now(),
          userId: interaction.user.id,
          guildId: interaction.guild.id,
          voiceChannelId: voiceChannel.id,
          textChannelId: interaction.channelId,
          results
        });

        const menu = new StringSelectMenuBuilder()
          .setCustomId(`music_search_select:${token}`)
          .setPlaceholder('Choose a song...')
          .addOptions(
            results.slice(0, 10).map((song, index) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(truncateText(song.title, 100))
                .setDescription(truncateText(`Duration: ${song.duration || 'Live'}`, 100))
                .setValue(String(index))
            )
          );

        const row = new ActionRowBuilder().addComponents(menu);

        return interaction.editReply({
          embeds: [buildSearchResultsEmbed(query, results)],
          components: [row]
        });
      }

      if (commandName === 'skip') {
        const serverQueue = queue.get(interaction.guild.id);

        if (!serverQueue || !serverQueue.songs.length) {
          return interaction.reply('❌ Nothing is playing.');
        }

        if (!sameVoiceChannel(interaction)) {
          return interaction.reply({
            content: '❌ You must be in the same voice channel as the bot.',
            flags: MessageFlags.Ephemeral
          });
        }

        killStream(serverQueue);
        serverQueue.player.stop();

        return interaction.reply('⏭️ Skipping to the next track...');
      }

      if (commandName === 'stop') {
        const serverQueue = queue.get(interaction.guild.id);

        if (!serverQueue) {
          return interaction.reply('❌ Nothing is playing.');
        }

        if (!sameVoiceChannel(interaction)) {
          return interaction.reply({
            content: '❌ You must be in the same voice channel as the bot.',
            flags: MessageFlags.Ephemeral
          });
        }

        serverQueue.songs = [];
        serverQueue.pendingAction = 'stop';
        killStream(serverQueue);
        serverQueue.player.stop();
        saveQueue();

        return interaction.reply('⏹️ Stopping playback...');
      }

      if (commandName === 'queue') {
        const serverQueue = queue.get(interaction.guild.id);

        if (!serverQueue || !serverQueue.songs.length) {
          return interaction.reply('📭 Queue is empty.');
        }

        return sendQueueEmbed(interaction, serverQueue);
      }

      if (commandName === 'pause') {
        const serverQueue = queue.get(interaction.guild.id);

        if (!serverQueue || !serverQueue.songs.length) {
          return interaction.reply('❌ Nothing is playing.');
        }

        if (!sameVoiceChannel(interaction)) {
          return interaction.reply({
            content: '❌ You must be in the same voice channel as the bot.',
            flags: MessageFlags.Ephemeral
          });
        }

        serverQueue.player.pause();
        serverQueue.isPaused = true;
        serverQueue.pausedAt = Date.now();
        await upsertPlayerMessage(interaction.guild, '⏸️ Playback Paused');

        return interaction.reply('⏸️ Paused.');
      }

      if (commandName === 'resume') {
        const serverQueue = queue.get(interaction.guild.id);

        if (!serverQueue || !serverQueue.songs.length) {
          return interaction.reply('❌ Nothing is queued.');
        }

        if (!sameVoiceChannel(interaction)) {
          return interaction.reply({
            content: '❌ You must be in the same voice channel as the bot.',
            flags: MessageFlags.Ephemeral
          });
        }

        serverQueue.player.unpause();
        serverQueue.isPaused = false;

        if (serverQueue.pausedAt) {
          serverQueue.pauseOffsetMs += Date.now() - serverQueue.pausedAt;
          serverQueue.pausedAt = null;
        }

        await upsertPlayerMessage(interaction.guild, '▶️ Playback Resumed');

        return interaction.reply('▶️ Resumed.');
      }

      if (commandName === 'filter') {
        await interaction.deferReply();

        const serverQueue = queue.get(interaction.guild.id);
        const filter = interaction.options.getString('type');
        const restartSong = interaction.options.getString('restart_song') || 'no';

        if (!serverQueue || !serverQueue.songs.length) {
          return interaction.editReply('❌ Nothing is playing.');
        }

        if (!sameVoiceChannel(interaction)) {
          return interaction.editReply('❌ You must be in the same voice channel as the bot.');
        }

        const currentSong = serverQueue.songs[0];
        const elapsed = getElapsedSeconds(serverQueue);

        serverQueue.filter = filter;
        saveQueue();

        try {
          if (restartSong === 'yes') {
            await playSong(interaction.guild, currentSong, 0, 0);
            return interaction.editReply(
              `🎛️ Filter changed to **${humanizeFilter(filter)}** and restarted the song from the beginning.`
            );
          }

          await playSong(interaction.guild, currentSong, 0, elapsed);
          return interaction.editReply(
            `🎛️ Filter changed to **${humanizeFilter(filter)}** and continued from around **${elapsed}s**.`
          );
        } catch (error) {
          console.error('Filter switch error:', error);
          return interaction.editReply('❌ Failed to apply filter.');
        }
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (!interaction.customId.startsWith('music_search_select:')) return;

      cleanupSearchSelectionCache();

      const token = interaction.customId.slice('music_search_select:'.length);
      const cached = searchSelectionCache.get(token);

      if (!cached) {
        return interaction.reply({
          content: '❌ This search menu has expired. Please run `/playsearch` again.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.user.id !== cached.userId) {
        return interaction.reply({
          content: '❌ This search menu belongs to someone else.',
          flags: MessageFlags.Ephemeral
        });
      }

      const selectedIndex = Number(interaction.values[0]);
      const selectedSong = cached.results[selectedIndex];

      if (!selectedSong) {
        return interaction.reply({
          content: '❌ Invalid selection.',
          flags: MessageFlags.Ephemeral
        });
      }

      const existingQueue = queue.get(interaction.guild.id);
      if (
        existingQueue?.connection &&
        interaction.guild.members.me?.voice?.channelId &&
        interaction.guild.members.me.voice.channelId !== cached.voiceChannelId
      ) {
        return interaction.reply({
          content: '❌ You must be in the same voice channel as the bot.',
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.deferUpdate();

      try {
        await enqueueSongs(
          interaction.guild,
          cached.voiceChannelId,
          cached.textChannelId,
          [selectedSong]
        );

        searchSelectionCache.delete(token);

        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setAuthor({
                name: 'Putra Beats Music Player',
                iconURL: client.user.displayAvatarURL()
              })
              .setTitle('Queued from Search')
              .setDescription(`🎵 Added **${selectedSong.title}** to the queue.`)
              .setTimestamp()
          ],
          components: []
        });
      } catch (error) {
        console.error('Search selection play error:', error);

        await interaction.followUp({
          content: '❌ Failed to queue that result.',
          flags: MessageFlags.Ephemeral
        });
      }

      return;
    }

    if (interaction.isButton()) {
      const serverQueue = queue.get(interaction.guild.id);
      if (!serverQueue) {
        return interaction.reply({
          content: '❌ Nothing is playing right now.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (
        !['music_queue', 'music_dm_song'].includes(interaction.customId) &&
        !sameVoiceChannel(interaction)
      ) {
        return interaction.reply({
          content: '❌ You must be in the same voice channel as the bot.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.customId === 'music_queue') {
        if (!serverQueue.songs.length) {
          return interaction.reply({
            content: '📭 Queue is empty.',
            flags: MessageFlags.Ephemeral
          });
        }

        return sendQueueEmbed(interaction, serverQueue, true);
      }

      if (interaction.customId === 'music_dm_song') {
        const currentSong = serverQueue.songs[0];

        if (!currentSong) {
          return interaction.reply({
            content: '❌ Nothing is playing right now.',
            flags: MessageFlags.Ephemeral
          });
        }

        try {
          await interaction.user.send(
            `🎵 Current song: **${currentSong.title}**\n${currentSong.url || ''}`.trim()
          );

          return interaction.reply({
            content: '✉️ Sent the current song title to your DM.',
            flags: MessageFlags.Ephemeral
          });
        } catch (error) {
          console.error('DM send error:', error);
          return interaction.reply({
            content: '❌ I could not DM you. Please enable DMs from server members.',
            flags: MessageFlags.Ephemeral
          });
        }
      }

      await interaction.deferUpdate();

      if (interaction.customId === 'music_pause_resume') {
        if (serverQueue.isPaused) {
          serverQueue.player.unpause();
          serverQueue.isPaused = false;

          if (serverQueue.pausedAt) {
            serverQueue.pauseOffsetMs += Date.now() - serverQueue.pausedAt;
            serverQueue.pausedAt = null;
          }

          await upsertPlayerMessage(interaction.guild, '▶️ Playback Resumed');
        } else {
          serverQueue.player.pause();
          serverQueue.isPaused = true;
          serverQueue.pausedAt = Date.now();
          await upsertPlayerMessage(interaction.guild, '⏸️ Playback Paused');
        }

        return;
      }

      if (interaction.customId === 'music_back_10') {
        const targetSeconds = await seekCurrentSong(interaction.guild, -10);
        await upsertPlayerMessage(
          interaction.guild,
          `⏪ Jumped back 10s • now at ~${targetSeconds}s`
        );
        return;
      }

      if (interaction.customId === 'music_forward_10') {
        const targetSeconds = await seekCurrentSong(interaction.guild, 10);
        await upsertPlayerMessage(
          interaction.guild,
          `⏩ Skipped ahead 10s • now at ~${targetSeconds}s`
        );
        return;
      }

      if (interaction.customId === 'music_next') {
        killStream(serverQueue);
        serverQueue.player.stop();
        return;
      }

      if (interaction.customId === 'music_stop') {
        serverQueue.songs = [];
        serverQueue.pendingAction = 'stop';
        killStream(serverQueue);
        serverQueue.player.stop();
        saveQueue();
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);

    if (!interaction.isRepliable()) return;

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '❌ Something went wrong while processing that command.',
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '❌ Something went wrong while processing that command.',
          flags: MessageFlags.Ephemeral
        });
      }
    } catch {}
  }
});

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

client.login(config.token);
