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

const cookiesString = process.env.YOUTUBE_COOKIES;
let cookies;

try {
  cookies = cookiesString.split(";").map(cookie => {
    const [name, value] = cookie.split("=");
    return { name: name.trim(), value: value.trim() };
  });
  console.log("Parsed cookies:", cookies);
} catch (err) {
  console.error("Failed to parse YOUTUBE_COOKIES.");
  process.exit(1);
}

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
      channel.send("You cannot kill me");
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
    return message.channel.send("Kept you waiting, huh?");
  }

  const userMessage = message.content;
  const args = userMessage.split(' ');
  const command = args.shift().toLowerCase();

  if (userMessage.startsWith(';play')) {
    if (!message.member.voice.channel) {
      return message.reply("Mf isn't even in a channel :skull:");
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
    ";volume": setVolume,
    ";remove": removeFromQueue,
  };

  if (commands[command]) {
    return commands[command](message, args);
  }
});

async function joinVoice(message) {
  if (!message.member.voice.channel) {
    return message.reply("entra num canal de voz");
  }

  joinVoiceChannel({
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
    const info = await ytdl.getInfo(url);
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
      });
    }
  } catch (error) {
    console.error('Erro ao buscar vídeo:', error);
    message.reply('deu ruim');
  }
}

function addToQueue(guildId, song, message) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue) {
    queue.set(guildId, { songs: [song], isSongBeingSkipped: false, volume: 1 });
    playVideo(guildId, message);
  } else {
    serverQueue.songs.push(song);
    message.channel.send(`adicionado à fila: \`${song.title}\``);
  }
}

function skipTrack(message) {
  const serverQueue = queue.get(message.guild.id);
  if (!serverQueue || serverQueue.songs.length < 1) {
    return message.reply("não tem outra música para pular.");
  }

  serverQueue.isSongBeingSkipped = true;

  message.reply(`pulando: \`${serverQueue.songs[0].title}\``);
  serverQueue.songs.shift();
  playVideo(message.guild.id, message);
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

    const stream = ytdl(song.url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      agent: agent,
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 
          'Cookie': cookiesString,
        }
      },
    });

    if (!stream) {
      console.error("Falha ao obter o stream do YouTube.");
      return message.channel.send("Erro ao carregar áudio.");
    }

    const resource = createAudioResource(stream, { inlineVolume: true });
    resource.volume.setVolume(serverQueue.volume || 1);

    player.play(resource);
    connection.subscribe(player);

    message.channel.send(`She sounds exactly like \`${song.title}\`, it's scary  :sweat: :sweat_smile: :cold_sweat: - pedido do ${message.member.displayName}`);

    player.on("error", (error) => {
      console.error("Erro ao tocar áudio:", error);
      message.channel.send("Erro ao reproduzir áudio.");
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

function pauseTrack(message) {
  const connection = getVoiceConnection(message.guild.id);
  if (!connection) return message.reply("nn to tocando nada.");

  connection.state.subscription.player.pause();
  message.reply("video pausado");
}

function resumeTrack(message) {
  const connection = getVoiceConnection(message.guild.id);
  if (!connection) return message.reply("nn to tocando nada.");

  connection.state.subscription.player.unpause();
  message.reply("video retomado");
}

function nowPlaying(message) {
  const serverQueue = queue.get(message.guild.id);
  if (!serverQueue || !serverQueue.songs.length) return message.reply("não tem música tocando.");

  message.reply(`to tocando \`${serverQueue.songs[0].title}\``);
}

function listarQueue(message) {
  const serverQueue = queue.get(message.guild.id);
  if (!serverQueue || !serverQueue.songs.length) return message.reply("não tem música tocando.");

  const listaDeVideos = serverQueue.songs
    .map((song, index) => `${index + 1}. ${song.title}`)
    .join("\n");

  message.reply(`**fila ai:**\n${listaDeVideos}`);
}

function commandList(message) {
  message.reply(
    `**lista de comandos:**\n` +
      `;play - tocar um video, da pra adicionar varios se separar por virgula (coloca o nome do autor pra n errar)\n` +
      `;join - entrar no canal de voz\n` +
      `;leave - sair do canal de voz\n` +
      `;skip - pular o video atual\n` +
      `;pause - pausar o video\n` +
      `;resume - retomar o video\n` +
      `;np - mostrar o video atual\n` +
      `;queue - listar a fila de videos\n` +
      `;volume [0-2] - ajustar volume (1 = 100%)\n` +
      `;remove [n] - remover item n da fila\n` +
      `;help - mostrar esta lista de comandos`
  );
}

function setVolume(message, args) {
  const serverQueue = queue.get(message.guild.id);
  if (!serverQueue) return message.reply("não tem nada tocando.");

  const newVolume = parseFloat(args[0]);
  if (isNaN(newVolume) || newVolume < 0 || newVolume > 2) {
    return message.reply("volume inválido. use um número entre 0 e 2 (1 é o padrão)");
  }

  serverQueue.volume = newVolume;

  try {
    const connection = getVoiceConnection(message.guild.id);
    if (connection?.state?.subscription?.player?._state?.resource?.volume) {
      connection.state.subscription.player._state.resource.volume.setVolume(newVolume);
    }
  } catch (err) {
    console.warn("Não foi possível ajustar o volume do recurso atual.");
  }

  message.reply(`volume ajustado para \`${newVolume * 100}%\``);
}

function removeFromQueue(message, args) {
  const serverQueue = queue.get(message.guild.id);
  if (!serverQueue || serverQueue.songs.length <= 1) {
    return message.reply("a fila está vazia ou só tem a música atual.");
  }

  const index = parseInt(args[0]);
  if (isNaN(index) || index < 2 || index > serverQueue.songs.length) {
    return message.reply("índice inválido. Use um número entre 2 e o tamanho da fila.");
  }

  const removed = serverQueue.songs.splice(index - 1, 1)[0];
  message.reply(`removido da fila: \`${removed.title}\``);
}

client.login(process.env.DISCORD_TOKEN);
