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
    moderator_role_id TEXT
  )`);
});

const BALANCE_DEFAULT = 0;
const TIMELY_REWARD = 100;
const TIMELY_INTERVAL_HOURS = 6;

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

function getGuildModRole(guildId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT moderator_role_id FROM guild_settings WHERE guild_id = ?", [guildId], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.moderator_role_id : null);
    });
  });
}

function setGuildModRole(guildId, roleId) {
  return new Promise((resolve, reject) => {
    db.run("INSERT OR REPLACE INTO guild_settings(guild_id, moderator_role_id) VALUES (?, ?)", [guildId, roleId], function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Register slash commands
const commands = [
  new SlashCommandBuilder().setName("bal").setDescription("Show your balance"),
  new SlashCommandBuilder()
    .setName("award")
    .setDescription("Award coins to user(s)")
    .addIntegerOption((opt) => opt.setName("amount").setDescription("Amount to award").setRequired(true))
    .addUserOption((opt) => opt.setName("user").setDescription("User to award coins to (optional)"))
    .addStringOption((opt) => opt.setName("text").setDescription("Text containing multiple user mentions or IDs (optional)")),
  new SlashCommandBuilder().setName("timely").setDescription("Claim your timely reward every 6 hours"),
  new SlashCommandBuilder()
    .setName("mod-role")
    .setDescription("Set the moderator role for this server")
    .addRoleOption((opt) => opt.setName("role").setDescription("Role to set as moderator").setRequired(true))
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
  const guild = interaction.guild;

  // /bal
  if (interaction.commandName === "bal") {
    const balance = await getBalance(userId, guildId);
    await interaction.reply(`Your balance is ${balance} coins.`);
  }

  // /timely
  else if (interaction.commandName === "timely") {
    const now = DateTime.utc();
    let lastTimelyIso = await getLastTimely(userId, guildId);
    let canClaim = true;
    if (lastTimelyIso) {
      const lastTimely = DateTime.fromISO(lastTimelyIso, { zone: "utc" });
      const diff = now.diff(lastTimely, "hours").hours;
      if (diff < TIMELY_INTERVAL_HOURS) {
        canClaim = false;
        const next = lastTimely.plus({ hours: TIMELY_INTERVAL_HOURS });
        const wait = next.diff(now).toFormat("h 'hours,' m 'minutes'");
        return interaction.reply({ content: `You can claim again in ${wait}.`, ephemeral: true });
      }
    }
    if (canClaim) {
      const balance = await getBalance(userId, guildId);
      await setBalance(userId, guildId, balance + TIMELY_REWARD);
      await setLastTimely(userId, guildId, now.toISO());
      return interaction.reply(`You claimed ${TIMELY_REWARD} coins! Come back in 6 hours.`);
    }
  }

  // /award
  else if (interaction.commandName === "award") {
    const amount = interaction.options.getInteger("amount");
    const user = interaction.options.getUser("user");
    const text = interaction.options.getString("text");
    const senderMember = await guild.members.fetch(userId);

    // Permission check: must have mod role or admin permission
    const modRoleId = await getGuildModRole(guildId);
    const isAdmin = senderMember.permissions.has(PermissionsBitField.Flags.Administrator);
    const hasModRole = modRoleId && senderMember.roles.cache.has(modRoleId);

    if (!isAdmin && !hasModRole) {
      return interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
    }

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
    if (text) {
      recipients = parseUserIds(text).filter((id) => id !== userId);
      if (recipients.length === 0) return interaction.reply({ content: "No valid recipients found in text.", ephemeral: true });
    } else if (user && user.id !== userId) {
      recipients = [user.id];
    } else {
      return interaction.reply({ content: "Please specify a user or text containing users.", ephemeral: true });
    }

    for (const rid of recipients) {
      const bal = await getBalance(rid, guildId);
      await setBalance(rid, guildId, bal + amount);
    }

    await interaction.reply(`You awarded ${amount} coins to ${recipients.length} user(s)!`);
  }

  // /setmodrole
  else if (interaction.commandName === "setmodrole") {
    const senderMember = await guild.members.fetch(userId);
    if (!senderMember.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: "Only administrators can set the moderator role.", ephemeral: true });
    }
    const role = interaction.options.getRole("role");
    await setGuildModRole(guildId, role.id);
    await interaction.reply(`Moderator role has been set to **${role.name}**.`);
  }
});

client.login(process.env.BOT_TOKEN);
