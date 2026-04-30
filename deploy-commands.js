const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config.json');

const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Open the Putra Beats command center'),

  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song, playlist, or search query')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('Song URL, playlist URL, or search query')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('playsearch')
    .setDescription('Search songs and choose one from a dropdown')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('Search query')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue'),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current song'),

  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume playback'),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current song'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback and clear the queue'),

  new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Apply an audio filter')
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Filter type')
        .setRequired(true)
        .addChoices(
          { name: 'None', value: 'none' },
          { name: 'Bass Boost', value: 'bass' },
          { name: 'Nightcore', value: 'nightcore' },
          { name: 'Slow + Reverb', value: 'reverb' },
          { name: 'Slow', value: 'slow' }
        )
    )
    .addStringOption(option =>
      option
        .setName('restart_song')
        .setDescription('Restart the current song after applying the filter')
        .setRequired(false)
        .addChoices(
          { name: 'Yes', value: 'yes' },
          { name: 'No', value: 'no' }
        )
    )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log('Started refreshing application (/) commands...');

    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();
