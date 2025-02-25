const { Client, GatewayIntentBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder } = require('discord.js');
const { DisTube } = require('distube');
const ytdl = require('@distube/ytdl-core');
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

const distube = new DisTube(client, {
  nsfw: true,
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
      return message.reply("Você precisa estar em um canal de voz!");
    }

    const args = content.split(' ').slice(2);
    if (args.length === 0) {
      return message.reply("URL inválida, envie uma que funcione.");
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

async function playFromURL(url, message) {
  try {
    distube.play(message.member.voice.channel, url, {
      member: message.member,
      textChannel: message.channel,
    });
    message.reply(`Agora tocando: ${url}`);
  } catch (error) {
    console.error('Erro ao tocar áudio:', error);
    message.reply("Não consegui processar esse vídeo.");
  }
}

async function searchAndCreateSelectMenu(query, message) {
  try {
    const results = await distube.search(query);
    if (results.length === 0) return message.reply('Não encontrei resultados no YouTube.');

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('video_select')
      .setPlaceholder('Escolha um vídeo')
      .addOptions(
        results.slice(0, 5).map((video, index) => (
          new StringSelectMenuOptionBuilder()
            .setLabel(video.name)
            .setDescription(video.channel.name)
            .setValue(video.url)
        ))
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const reply = await message.reply({ content: 'Escolha um vídeo:', components: [row] });

    const filter = (interaction) => interaction.user.id === message.author.id;
    const collector = reply.createMessageComponentCollector({ filter, time: 60000 });

    collector.on('collect', async (interaction) => {
      const selectedVideo = results.find(video => video.url === interaction.values[0]);
      await interaction.update({ content: `Você escolheu: \`${selectedVideo.name}\``, components: [] });
      distube.play(message.member.voice.channel, selectedVideo.url, {
        member: message.member,
        textChannel: message.channel,
      });
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') reply.edit({ content: 'Tempo esgotado!', components: [] });
    });
  } catch (error) {
    console.error('Erro ao buscar vídeo:', error);
    message.reply('Erro ao buscar o vídeo.');
  }
}

function joinVoice(message) {
  if (!message.member.voice.channel) {
    return message.reply("Você precisa entrar em um canal de voz.");
  }

  distube.voices.join(message.member.voice.channel);
  message.reply("Entrei no canal de voz!");
}

function leaveVoice(message) {
  distube.voices.leave(message.guild.id);
  message.reply("Saí do canal de voz.");
}

function skipTrack(message) {
  distube.skip(message);
  message.reply("Pulei a música!");
}

function pauseTrack(message) {
  distube.pause(message);
  message.reply("Música pausada.");
}

function resumeTrack(message) {
  distube.resume(message);
  message.reply("Música retomada.");
}

function nowPlaying(message) {
  const queue = distube.getQueue(message.guild.id);
  if (!queue || !queue.songs.length) return message.reply("Não tem nada tocando no momento.");

  message.reply(`Tocando agora: \`${queue.songs[0].name}\``);
}

function listarQueue(message) {
  const queue = distube.getQueue(message.guild.id);
  if (!queue || !queue.songs.length) return message.reply("A fila está vazia.");

  const listaDeVideos = queue.songs
    .map((song, index) => `${index + 1}. ${song.name}`)
    .join("\n");

  message.reply(`**Fila de músicas:**\n${listaDeVideos}`);
}

client.login(process.env.DISCORD_TOKEN);
