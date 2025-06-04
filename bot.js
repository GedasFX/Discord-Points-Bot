const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const sqlite3 = require("sqlite3").verbose();
const { DateTime } = require("luxon");
require("dotenv").config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const db = new sqlite3.Database("./bot.db");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    guild_id TEXT,
    user_id TEXT,
    balance INTEGER DEFAULT 0,
    last_timely TEXT,
    PRIMARY KEY (guild_id, user_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    timely_reward INTEGER DEFAULT 100,
    timely_interval_hours INTEGER DEFAULT 6
  )`);
});

const BALANCE_DEFAULT = 0;

function getBalance(userId, guildId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT balance FROM users WHERE user_id = ? AND guild_id = ?", [userId, guildId], (err, row) => {
      if (err) return reject(err);
      if (row) resolve(row.balance);
      else {
        db.run("INSERT INTO users(user_id, guild_id, balance) VALUES (?, ?, ?)", [userId, guildId, BALANCE_DEFAULT], (err) => {
          if (err) return reject(err);
          resolve(BALANCE_DEFAULT);
        });
      }
    });
  });
}

function setBalance(userId, guildId, amount) {
  return new Promise((resolve, reject) => {
    db.run("INSERT OR IGNORE INTO users(user_id, guild_id, balance) VALUES (?, ?, ?)", [userId, guildId, amount]);
    db.run("UPDATE users SET balance = ? WHERE user_id = ? AND guild_id = ?", [amount, userId, guildId], function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getLastTimely(userId, guildId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT last_timely FROM users WHERE user_id = ? AND guild_id = ?", [userId, guildId], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.last_timely : null);
    });
  });
}

function setLastTimely(userId, guildId, isoTime) {
  return new Promise((resolve, reject) => {
    db.run("UPDATE users SET last_timely = ? WHERE user_id = ? AND guild_id = ?", [isoTime, userId, guildId], function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getGuildSetting(guildId, setting) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT ${setting} FROM guild_settings WHERE guild_id = ?`, [guildId], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row[setting] : null);
    });
  });
}

function setGuildSetting(guildId, setting, value) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO guild_settings (guild_id, ${setting}) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET ${setting} = ?`,
      [guildId, value, value],
      function (err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// Register slash commands
const commands = [
  new SlashCommandBuilder().setName("bal").setDescription("Show your balance"),
  new SlashCommandBuilder()
    .setName("award")
    .setDescription("Award points to user(s)")
    .addIntegerOption((opt) => opt.setName("amount").setDescription("Amount to award").setRequired(true))
    .addStringOption((opt) => opt.setName("users").setDescription("Text containing multiple user mentions or IDs").setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  new SlashCommandBuilder().setName("timely").setDescription("Claim your timely reward every 6 hours"),
  new SlashCommandBuilder()
    .setName("configure")
    .setDescription("Configure guild settings")
    .addSubcommand((sub) =>
      sub
        .setName("timely-reward")
        .setDescription("Set the timely reward amount")
        .addIntegerOption((opt) => opt.setName("amount").setDescription("Reward amount").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("timely-interval")
        .setDescription("Set the timely interval in hours")
        .addIntegerOption((opt) => opt.setName("hours").setDescription("Interval in hours").setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("Slash commands registered!");
  } catch (error) {
    console.error(error);
  }
})();

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  // /bal
  if (interaction.commandName === "bal") {
    const balance = await getBalance(userId, guildId);
    await interaction.reply(`Your balance is ${balance} points.`);
  }

  // /timely
  else if (interaction.commandName === "timely") {
    const now = DateTime.utc();
    const timelyReward = (await getGuildSetting(guildId, "timely_reward")) || 100;
    const timelyIntervalHours = (await getGuildSetting(guildId, "timely_interval_hours")) || 24;

    let lastTimelyIso = await getLastTimely(interaction.user.id, guildId);
    let canClaim = true;
    if (lastTimelyIso) {
      const lastTimely = DateTime.fromISO(lastTimelyIso, { zone: "utc" });
      const diff = now.diff(lastTimely, "hours").hours;
      if (diff < timelyIntervalHours) {
        canClaim = false;
        const next = lastTimely.plus({ hours: timelyIntervalHours });
        const wait = next.diff(now).toFormat("h 'hours,' m 'minutes'");

        return interaction.reply({ content: `You can claim again in ${wait}.`, ephemeral: true });
      }
    }
    if (canClaim) {
      const balance = await getBalance(interaction.user.id, guildId);
      await setBalance(interaction.user.id, guildId, balance + timelyReward);
      await setLastTimely(interaction.user.id, guildId, now.toISO());

      return interaction.reply(`You claimed ${timelyReward} points! Come back in ${timelyIntervalHours} hours.`);
    }
  }

  // /award
  else if (interaction.commandName === "award") {
    const amount = interaction.options.getInteger("amount");
    const users = interaction.options.getString("users");

    // Helper to get user IDs from text
    function parseUserIds(str) {
      const mentionRegex = /<@!?(\d+)>/g;
      const idRegex = /\b\d{17,19}\b/g;
      let ids = [];
      let match;
      while ((match = mentionRegex.exec(str))) ids.push(match[1]);
      while ((match = idRegex.exec(str))) if (!ids.includes(match[0])) ids.push(match[0]);
      return [...new Set(ids)];
    }

    let recipients = [];
    if (users) {
      recipients = parseUserIds(users);
      if (recipients.length === 0) return interaction.reply({ content: "No valid recipients found in text.", ephemeral: true });
    } else {
      return interaction.reply({ content: "Please specify a user or text containing users.", ephemeral: true });
    }

    for (const rid of recipients) {
      const bal = await getBalance(rid, guildId);
      await setBalance(rid, guildId, bal + amount);
    }

    await interaction.reply({ content: `You awarded ${amount} points to ${recipients.map(r => `<@${r}>`).join(', ')}!` });
  } else if (interaction.commandName === "configure") {
    if (interaction.options.getSubcommand() === "timely-reward") {
      const amount = interaction.options.getInteger("amount");
      await setGuildSetting(guildId, "timely_reward", amount);
      return interaction.reply({ content: `Timely reward set to ${amount} points.`, ephemeral: true });
    } else if (interaction.options.getSubcommand() === "timely-interval") {
      const hours = interaction.options.getInteger("hours");
      await setGuildSetting(guildId, "timely_interval_hours", hours);
      return interaction.reply({ content: `Timely interval set to ${hours} hours.`, ephemeral: true });
    }
  }
});

client.login(process.env.BOT_TOKEN);
