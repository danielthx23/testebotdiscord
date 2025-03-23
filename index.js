const { Client, GatewayIntentBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder } = require('discord.js');
const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  getVoiceConnection, 
  NoSubscriberBehavior, 
  AudioPlayerStatus 
} = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const ytSearch = require('yt-search');
require('dotenv').config();

// Parse cookies from the environment variable
const cookiesString = process.env.YOUTUBE_COOKIES;
const cookies = cookiesString.split(',').map(cookie => {
  const [name, value] = cookie.trim().split('=');
  return { name, value };
});

// Create the agent using the cookies
const agent = ytdl.createAgent(cookies);

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

  if (message.mentions.has(client.user)) {
    return message.channel.send("Meu prefixo é `;`, se precisar de ajuda digite `;help`");
  }

  const userMessage = message.content;
  const args = userMessage.split();
  const command = args.shift().toLowerCase();

  if (userMessage.startsWith(';play')) {
    if (!message.member.voice.channel) {
      return message.reply("Mf isn't even in a channel :skull:");
    }

    const args = userMessage.split(' ').slice(1);
    if (args.length === 0) {
      return message.reply("url todo cagado, manda um que funciona");
    }

    const query = args.join(' ').split(',');
    if (ytdl.validateURL(query)) {
      return playFromURL(query, message);
    } else {
      return searchAndCreateSelectMenu(query, message);
    }
  }

  const commands = {
    ";join": joinVoice,
    ";leave": leaveVoice,
    ";skip": skipTrack,
    ";pause": pauseTrack,
    ";resume": resumeTrack,
    ";np": nowPlaying,
    ";queue": listarQueue,
    ";help": commandList,
  };

  if (commands[command]) {
    return commands[command](message, args);
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
    const info = await ytdl.getInfo(url, { agent });
    if (!info || info.videoDetails.isLive) {
      return message.reply("url todo cagado, manda um que funciona");
    }
    joinVoiceChannel({
      channelId: message.member.voice.channel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });
    addToQueue(message.guild.id, { title: info.videoDetails.title, url }, message);
  } catch (error) {
    console.error('Erro ao buscar áudio:', error);
    return message.reply("não deu pra processar esse video não man :broken_heart:");
  }
}

async function searchAndCreateSelectMenu(query, message) {
  try {
    if (query.length === 1) {

    const results = await ytSearch(query[0]);
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
      joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });
      addToQueue(message.guild.id, { title: selectedVideo.title, url: selectedVideo.url }, message);
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') reply.edit({ content: 'demorou demais', components: [] });
    });
    } else {
      joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });
      query.forEach(async title => {
        const results = await ytSearch(title);
        addToQueue(message.guild.id, { title: results.videos[0].title, url: results.videos[0].url }, message);
      })
    }
  } catch (error) {
    console.error('Erro ao buscar vídeo:', error);
    message.reply('deu ruim');
  }
}

function addToQueue(guildId, song, message) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue) {
    queue.set(guildId, { songs: [song], isSongBeingSkipped: false });
    playVideo(guildId, message);
  } else {
    serverQueue.songs.push(song);
    message.channel.send(`adicionado à fila: \`${song.title}\``);
  }
}

async function playVideo(guildId, message) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue || serverQueue.songs.length === 0) {
    queue.delete(guildId);
    return message.channel.send("acabou os vídeos.");
  }

  const song = serverQueue.songs[0];
  let connection = getVoiceConnection(guildId);

  if (connection) {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });

    // Pass the cookies from your environment variable via requestOptions
    const stream = ytdl(song.url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      requestOptions: {
        headers: {
          Cookie: process.env.YOUTUBE_COOKIES
        }
      }
    });

    const resource = createAudioResource(stream);
    player.play(resource);
    connection.subscribe(player);

    message.channel.send(
      `She sounds exactly like \`${song.title}\`, it's scary  :sweat: :sweat_smile: :cold_sweat: - pedido do ${message.member.displayName}`
    );

    player.on('error', (error) => {
      console.error('Erro ao tocar áudio:', error);
      message.channel.send('deu ruim');
    });

    player.on(AudioPlayerStatus.Idle, () => {
      const serverQueue = queue.get(guildId);
      if (!serverQueue) return;

      if (serverQueue.isSongBeingSkipped) {
        serverQueue.isSongBeingSkipped = false;
        return;
      }

      if (serverQueue.songs.length > 0) {
        serverQueue.songs.shift();
        playVideo(guildId, message);
      } else {
        queue.delete(guildId);
        connection.destroy();
        message.channel.send("acabou os vídeos.");
      }
    });
  }
}

// Remaining functions like skipTrack, pauseTrack, etc.

client.login(process.env.DISCORD_TOKEN);
