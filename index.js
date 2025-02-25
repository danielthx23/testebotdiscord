const { Client, GatewayIntentBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder } = require('discord.js');
const { 
  joinVoiceChannel, 
  getVoiceConnection, 
  NoSubscriberBehavior, 
  AudioPlayerStatus 
} = require('@discordjs/voice');
const { DisTube } = require('distube');
const ytSearch = require('yt-search');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
  ],
  partials: ['CHANNEL'],
});

let queue = new Map();

// Initialize distube
const distube = new DisTube(client, {
  searchSongs: true,  // Enables search feature
  emitNewSongOnly: true, // Emits only new songs in the queue
  leaveOnFinish: true,  // Automatically leaves the channel when the queue finishes
});

client.once("ready", async () => {
  const channelId = "373861944718917644"; 

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel) {
      channel.send("to on");
    } else {
      console.log("achei esse canal nn");
    }
  } catch (error) {
    console.error("deu ruim", error);
  }
});

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  const content = message.content.trim();

  if (content.startsWith('teto toca')) {
    if (!message.member.voice.channel) {
      return message.reply("Mf isn't even in a channel :skull:");
    }

    const args = content.split(' ').slice(2);
    if (args.length === 0) {
      return message.reply("url todo cagado, manda um que funciona");
    }

    const query = args.join(' ');
    if (ytdl.validateURL(query)) {
      return playFromURL(query, message);
    } else {
      return searchAndCreateSelectMenu(query, message);
    }
  }

  const commands = {
    "teto entra": joinVoice,
    "teto sai": leaveVoice,
    "teto pular": skipTrack,
    "teto pausar": pauseTrack,
    "teto retomar": resumeTrack,
    "teto agora": nowPlaying,
    "teto queue": listarQueue
  };

  if (commands[content]) {
    return commands[content](message);
  }
});

async function joinVoice(message) {
  if (!message.member.voice.channel) {
    return message.reply("entra num canal de voz");
  }

  const connection = joinVoiceChannel({
    channelId: message.member.voice.channel.id,
    guildId: message.guild.id,
    adapterCreator: message.guild.voiceAdapterCreator,
  });

  message.reply("sup");
}

function leaveVoice(message) {
  const connection = getVoiceConnection(message.guild.id);
  if (!connection) {
    return message.reply("nem to num canal de voz");
  }

  connection.destroy();
  message.reply("flw");
}

async function playFromURL(url, message) {
  try {
    distube.play(message.member.voice.channel, url, { member: message.member, textChannel: message.channel });
  } catch (error) {
    console.error('Erro ao buscar áudio:', error);
    return message.reply("não deu pra processar esse video não man :broken_heart:");
  }
}

async function searchAndCreateSelectMenu(query, message) {
  try {
    const results = await ytSearch(query);
    if (results.videos.length === 0) return message.reply('achei isso no youtube não');

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('video_select')
      .setPlaceholder('escolhe um vídeo aí')
      .addOptions(
        results.videos.slice(0, 5).map(video => (
          new StringSelectMenuOptionBuilder()
            .setLabel(video.title)
            .setDescription(video.author.name)
            .setValue(video.url)
        ))
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const reply = await message.reply({ content: 'escolhe um ae:', components: [row] });

    const filter = (interaction) => interaction.user.id === message.author.id;
    const collector = reply.createMessageComponentCollector({ filter, time: 60000 });

    collector.on('collect', async (interaction) => {
      const selectedVideo = results.videos.find(video => video.url === interaction.values[0]);
      await interaction.update({ content: `tu selecionou: \`${selectedVideo.title}\``, components: [] });
      distube.play(message.member.voice.channel, selectedVideo.url, { member: message.member, textChannel: message.channel });
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') reply.edit({ content: 'demorou demais', components: [] });
    });
  } catch (error) {
    console.error('Erro ao buscar vídeo:', error);
    message.reply('deu ruim');
  }
}

function skipTrack(message) {
  const connection = getVoiceConnection(message.guild.id);
  if (!connection) {
    return message.reply("nem to tocando nada.");
  }

  distube.skip(message);
  message.reply("pulando a música...");
}

function pauseTrack(message) {
  const connection = getVoiceConnection(message.guild.id);
  if (!connection) return message.reply("nn to tocando nada.");
  
  distube.pause(message);
  message.reply("video pausado");
}

function resumeTrack(message) {
  const connection = getVoiceConnection(message.guild.id);
  if (!connection) return message.reply("nn to tocando nada.");

  distube.resume(message);
  message.reply("video retomado");
}

function nowPlaying(message) {
  const queue = distube.getQueue(message);
  if (!queue || !queue.songs.length) return message.reply("não tem música tocando.");

  message.reply(`to tocando \`${queue.songs[0].name}\``);
}

function listarQueue(message) {
  const queue = distube.getQueue(message);
  if (!queue || !queue.songs.length) return message.reply("não tem música tocando.");

  const listaDeVideos = queue.songs
    .map((song, index) => `${index + 1}. ${song.name}`)
    .join("\n");
   
    message.reply(`**fila ai:**\n${listaDeVideos}`);
}

client.login(process.env.DISCORD_TOKEN);
