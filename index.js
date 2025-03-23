const { Client, GatewayIntentBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder } = require('discord.js');
const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  getVoiceConnection, 
  AudioPlayerStatus,
  NoSubscriberBehavior 
} = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');
require('dotenv').config();

// Parse cookies from the environment variable (expected to be a JSON array)
let cookies;
try {
  cookies = JSON.parse(process.env.YOUTUBE_COOKIES);
} catch (err) {
  console.error("Failed to parse YOUTUBE_COOKIES. Make sure it's valid JSON.");
  process.exit(1);
}

const agentOptions = {
  pipelining: 5,
  maxRedirections: 0,
};

const agent = ytdl.createAgent(cookies, agentOptions);

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
      return message.reply("Você não está em um canal de voz.");
    }
    const args = userMessage.split(' ').slice(1);
    if (args.length === 0) {
      return message.reply("URL inválida ou faltando.");
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
    return message.reply("Você precisa estar em um canal de voz.");
  }
  const connection = joinVoiceChannel({
    channelId: message.member.voice.channel.id,
    guildId: message.guild.id,
    adapterCreator: message.guild.voiceAdapterCreator,
  });
  message.reply("Entrando no canal...");
}

function leaveVoice(message) {
  const connection = getVoiceConnection(message.guild.id);
  if (!connection) {
    return message.reply("Você não está em um canal de voz.");
  }
  connection.destroy();
  message.reply("Saindo do canal...");
}

async function playFromURL(url, message) {
  try {
    const info = await ytdl.getInfo(url, { agent });
    if (!info || info.videoDetails.isLive) {
      return message.reply("O vídeo não está disponível ou é ao vivo.");
    }
    joinVoiceChannel({
      channelId: message.member.voice.channel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });
    addToQueue(message.guild.id, { title: info.videoDetails.title, url }, message);
  } catch (error) {
    console.error('Erro ao buscar áudio:', error);
    return message.reply("Não foi possível processar o vídeo.");
  }
}

async function searchAndCreateSelectMenu(query, message) {
  try {
    if (query.length === 1) {
      const results = await ytSearch(query[0]);
      if (results.videos.length === 0) return message.reply('Nenhum vídeo encontrado.');

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('video_select')
        .setPlaceholder('Escolha um vídeo')
        .addOptions(
          results.videos.slice(0, 5).map(video => (
            new StringSelectMenuOptionBuilder()
              .setLabel(video.title)
              .setDescription(video.author.name)
              .setValue(video.url)
          ))
        );
      const row = new ActionRowBuilder().addComponents(selectMenu);
      const reply = await message.reply({ content: 'Escolha um vídeo:', components: [row] });

      const filter = (interaction) => interaction.user.id === message.author.id;
      const collector = reply.createMessageComponentCollector({ filter, time: 60000 });

      collector.on('collect', async (interaction) => {
        const selectedVideo = results.videos.find(video => video.url === interaction.values[0]);
        await interaction.update({ content: `Você escolheu: \`${selectedVideo.title}\``, components: [] });
        joinVoiceChannel({
          channelId: message.member.voice.channel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });
        addToQueue(message.guild.id, { title: selectedVideo.title, url: selectedVideo.url }, message);
      });

      collector.on('end', (_, reason) => {
        if (reason === 'time') reply.edit({ content: 'Tempo expirado.', components: [] });
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
      });
    }
  } catch (error) {
    console.error('Erro ao buscar vídeo:', error);
    message.reply('Deu erro ao procurar o vídeo.');
  }
}

function addToQueue(guildId, song, message) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue) {
    queue.set(guildId, { songs: [song], isSongBeingSkipped: false });
    playVideo(guildId, message);
  } else {
    serverQueue.songs.push(song);
    message.channel.send(`Adicionado à fila: \`${song.title}\``);
  }
}

function skipTrack(message) {
  const serverQueue = queue.get(message.guild.id);
  if (!serverQueue || serverQueue.songs.length < 1) {
    return message.reply("Não há música para pular.");
  }
  serverQueue.isSongBeingSkipped = true;
  message.reply(`Pulando: \`${serverQueue.songs[0].title}\``);
  serverQueue.songs.shift();
  playVideo(message.guild.id, message);
}

async function playVideo(guildId, message) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue || serverQueue.songs.length === 0) {
    queue.delete(guildId);
    return message.channel.send("Não há mais vídeos na fila.");
  }
  const song = serverQueue.songs[0];
  let connection = getVoiceConnection(guildId);
  if (connection) {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });

    const stream = ytdl(song.url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25,
      requestOptions: {
        headers: {
          Cookie: process.env.YOUTUBE_COOKIES
        }
      },
      agent // também passamos o agent aqui se necessário
    });
    const resource = createAudioResource(stream);
    player.play(resource);
    connection.subscribe(player);

    message.channel.send(`Tocando: \`${song.title}\``);

    player.on('error', (error) => {
      console.error('Erro ao tocar áudio:', error);
      message.channel.send('Deu erro ao tentar tocar o áudio.');
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
        message.channel.send("Acabou os vídeos.");
      }
    });
  }
}

function pauseTrack(message) {
  const connection = getVoiceConnection(message.guild.id);
  if (!connection) return message.reply("Não está tocando nada.");
  connection.state.subscription.player.pause();
  message.reply("Música pausada.");
}

function resumeTrack(message) {
  const connection = getVoiceConnection(message.guild.id);
  if (!connection) return message.reply("Não está tocando nada.");
  connection.state.subscription.player.unpause();
  message.reply("Música retomada.");
}

function nowPlaying(message) {
  const serverQueue = queue.get(message.guild.id);
  if (!serverQueue || !serverQueue.songs.length) return message.reply("Não há música tocando.");
  message.reply(`Tocando agora: \`${serverQueue.songs[0].title}\``);
}

function listarQueue(message) {
  const serverQueue = queue.get(message.guild.id);
  if (!serverQueue || !serverQueue.songs.length) return message.reply("Não há músicas na fila.");
  const listaDeVideos = serverQueue.songs
    .map((song, index) => `${index + 1}. ${song.title}`)
    .join("\n");
  message.reply(`**Fila de músicas:**\n${listaDeVideos}`);
}

function commandList(message) {
  message.reply(
    `**Lista de comandos:**\n` +
    `;play - Tocar um vídeo (pode adicionar vários separados por vírgula).\n` +
    `;join - Entrar no canal de voz.\n` +
    `;leave - Sair do canal de voz.\n` +
    `;skip - Pular o vídeo atual.\n` +
    `;pause - Pausar o vídeo.\n` +
    `;resume - Retomar o vídeo.\n` +
    `;np - Mostrar o vídeo atual.\n` +
    `;queue - Mostrar a fila de vídeos.\n` +
    `;help - Exibir essa lista de comandos.`
  );
}

client.login(process.env.DISCORD_TOKEN);
