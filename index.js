const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, registerFont } = require('canvas');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────

function loadConfig() {
  const defaults = {
    image_width: 1286,
    image_height: 681,
    circle_radius: 124,
    circle_center_x: 637,
    circle_center_y: 153,
    nickname_offset_y: 20,
    nickname_font_size: 40,
    nickname_color: [255, 255, 255],
    nickname_outline_color: [0, 0, 0],
    nickname_outline_width: 0,
    question_y: 450,
    question_font_size: 47,
    question_color: [210, 223, 248],
    question_outline_color: [0, 0, 0],
    question_line_spacing: 48,
    template_path: 'template.png',
    font_path: 'font_bold.ttf',
    arabic_font_path: 'font_bold.ttf',
  };

  try {
    if (fs.existsSync('bot_config.json')) {
      const loaded = JSON.parse(fs.readFileSync('bot_config.json', 'utf8'));
      console.log('✅ Configuration loaded from bot_config.json');
      return { ...defaults, ...loaded };
    }
  } catch (e) {
    console.warn('⚠️  Error loading config, using defaults:', e.message);
  }
  return defaults;
}

const CONFIG = loadConfig();

// Register fonts
try {
  registerFont(path.resolve(CONFIG.font_path), { family: 'BotFont' });
  console.log('✅ Font registered');
} catch (e) {
  console.warn('⚠️  Could not register font:', e.message);
}

// ─── Questions + No-repeat logic ──────────────────────────────────────────

function loadQuestions() {
  try {
    // Prefer JSON if available
    if (fs.existsSync('questions.json')) {
      const data = JSON.parse(fs.readFileSync('questions.json', 'utf8'));
      if (Array.isArray(data) && data.length > 0) return data;
    }
    if (fs.existsSync('questions.txt')) {
      const lines = fs.readFileSync('questions.txt', 'utf8')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
      if (lines.length > 0) return lines;
    }
  } catch (e) {
    console.warn('⚠️  Could not load questions:', e.message);
  }
  return ["What's your favorite color?", "What makes you happy?", "What's your dream?"];
}

const ALL_QUESTIONS = loadQuestions();
console.log(`✅ Loaded ${ALL_QUESTIONS.length} questions`);

// Per-guild question state
// guildState[guildId] = { used: Set, count: number }
const guildState = {};

function getGuildState(guildId) {
  if (!guildState[guildId]) {
    guildState[guildId] = { used: new Set(), count: 0 };
  }
  return guildState[guildId];
}

/**
 * Pick a random question following the no-repeat rule:
 *   - For the first 40 uses: never repeat a question.
 *   - After 40 uses: questions can randomly re-appear (random from full pool).
 *     The pool is still reshuffled so it's not purely sequential.
 */
function pickQuestion(guildId) {
  const state = getGuildState(guildId);
  const total = ALL_QUESTIONS.length;

  state.count += 1;

  if (state.count <= 40) {
    // Strict no-repeat until 40 total uses
    const unused = ALL_QUESTIONS.filter((_, i) => !state.used.has(i));
    if (unused.length === 0) {
      // Shouldn't happen if pool > 40, but handle gracefully
      state.used.clear();
      const idx = Math.floor(Math.random() * total);
      state.used.add(idx);
      return ALL_QUESTIONS[idx];
    }
    const pick = Math.floor(Math.random() * unused.length);
    const question = unused[pick];
    const originalIdx = ALL_QUESTIONS.indexOf(question);
    state.used.add(originalIdx);
    return question;
  } else {
    // After 40 uses: random from FULL pool (repeats allowed)
    const idx = Math.floor(Math.random() * total);
    return ALL_QUESTIONS[idx];
  }
}

// ─── Arabic helpers ────────────────────────────────────────────────────────

function isRTL(text) {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

// Basic Arabic reshaper isn't needed with canvas bidi — canvas handles it natively.
// We just reverse RTL lines for proper display if needed.
function prepareText(text) {
  if (!isRTL(text)) return text;
  // Canvas on Node handles Arabic correctly with proper Unicode — return as-is
  return text;
}

// ─── Image creation ────────────────────────────────────────────────────────

function toRgba(colorArr, alpha = 1) {
  const [r, g, b] = colorArr;
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawTextWithOutline(ctx, text, x, y, fillColor, outlineColor, outlineWidth) {
  if (outlineWidth > 0) {
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = outlineWidth * 2;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fillColor;
  ctx.fillText(text, x, y);
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = [];

  for (const word of words) {
    const test = [...current, word].join(' ');
    const { width } = ctx.measureText(test);
    if (width <= maxWidth) {
      current.push(word);
    } else {
      if (current.length) lines.push(current.join(' '));
      current = [word];
    }
  }
  if (current.length) lines.push(current.join(' '));
  return lines;
}

async function createImage(member, question) {
  const W = CONFIG.image_width;
  const H = CONFIG.image_height;
  const R = CONFIG.circle_radius;
  const cx = CONFIG.circle_center_x;
  const cy = CONFIG.circle_center_y;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── Background ──
  try {
    const bg = await loadImage(path.resolve(CONFIG.template_path));
    ctx.drawImage(bg, 0, 0, W, H);
  } catch {
    // Gradient fallback
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgb(20,30,70)');
    grad.addColorStop(1, 'rgb(30,50,120)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // ── Avatar ──
  try {
    const avatarUrl = member.displayAvatarURL({ size: 512, extension: 'png' });
    const avatarRes = await fetch(avatarUrl);
    const avatarBuf = Buffer.from(await avatarRes.arrayBuffer());
    const avatarImg = await loadImage(avatarBuf);

    // Circular clip
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImg, cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
  } catch (e) {
    console.warn('Could not load avatar:', e.message);
  }

  // ── Nickname ──
  const nickFontSize = CONFIG.nickname_font_size;
  ctx.font = `bold ${nickFontSize}px BotFont, Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const username = member.displayName;
  const nameX = W / 2;
  const nameY = cy + R + CONFIG.nickname_offset_y;

  drawTextWithOutline(
    ctx, username, nameX, nameY,
    toRgba(CONFIG.nickname_color),
    toRgba(CONFIG.nickname_outline_color),
    CONFIG.nickname_outline_width
  );

  // ── Question ──
  const qFontSize = CONFIG.question_font_size;
  const rtl = isRTL(question);

  ctx.font = `${qFontSize}px BotFont, Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  // Canvas handles RTL natively — enable bidi
  ctx.direction = rtl ? 'rtl' : 'ltr';

  const maxWidth = W - 100;
  const preparedQ = prepareText(question);
  const lines = wrapText(ctx, preparedQ, maxWidth);

  let qY = CONFIG.question_y;
  for (const line of lines) {
    drawTextWithOutline(
      ctx, line, W / 2, qY,
      toRgba(CONFIG.question_color),
      toRgba(CONFIG.question_outline_color),
      1
    );
    qY += CONFIG.question_line_spacing;
  }

  ctx.direction = 'ltr'; // reset
  return canvas.toBuffer('image/png');
}

// ─── Discord bot ────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once('ready', () => {
  console.log(`✅ ${client.user.tag} is online!`);
  console.log(`✅ Arabic text support: Enabled`);
  console.log(`✅ No-repeat logic: Active (first 40 questions won't repeat)`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/\s+/);
  const command = args[0].toLowerCase();

  // !ask @user
  if (command === 'ask') {
    const mentioned = message.mentions.members?.first();
    if (!mentioned) {
      return message.reply('Please mention a user! Usage: `!ask @user`');
    }

    try {
      const question = pickQuestion(message.guild.id);
      const imgBuffer = await createImage(mentioned, question);
      const attachment = new AttachmentBuilder(imgBuffer, { name: 'question.png' });
      await message.channel.send({
        content: `${message.author} just asked you a question ${mentioned}`,
        files: [attachment],
      });
    } catch (e) {
      console.error('Error in !ask:', e);
      message.reply('Something went wrong generating the image.');
    }
  }

  // !random
  if (command === 'random') {
    try {
      const members = (await message.guild.members.fetch())
        .filter(m => !m.user.bot)
        .toJSON();

      if (!members.length) return message.reply('No members found!');

      const member = members[Math.floor(Math.random() * members.length)];
      const question = pickQuestion(message.guild.id);
      const imgBuffer = await createImage(member, question);
      const attachment = new AttachmentBuilder(imgBuffer, { name: 'question.png' });
      await message.channel.send({
        content: `${message.author} just asked you a question ${member}`,
        files: [attachment],
      });
    } catch (e) {
      console.error('Error in !random:', e);
      message.reply('Something went wrong generating the image.');
    }
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────

const TOKEN = process.env.DISCORD_BOT_TOKEN || '';
if (!TOKEN) {
  console.error('❌ No token found. Set DISCORD_BOT_TOKEN environment variable.');
  process.exit(1);
}
client.login(TOKEN);
