const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");
const sqlite3 = require("sqlite3").verbose();
const { DateTime } = require("luxon");
require("dotenv").config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const db = new sqlite3.Database("./bot.db");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    balance INTEGER DEFAULT 0,
    last_timely TEXT
  )`);
});

const BALANCE_DEFAULT = 0;
const TIMELY_REWARD = 100;
const TIMELY_INTERVAL_HOURS = 6;

function getBalance(userId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT balance FROM users WHERE user_id = ?", [userId], (err, row) => {
      if (err) return reject(err);
      if (row) resolve(row.balance);
      else {
        db.run("INSERT INTO users(user_id, balance) VALUES (?, ?)", [userId, BALANCE_DEFAULT], (err) => {
          if (err) return reject(err);
          resolve(BALANCE_DEFAULT);
        });
      }
    });
  });
}

function setBalance(userId, amount) {
  return new Promise((resolve, reject) => {
    db.run("INSERT OR IGNORE INTO users(user_id, balance) VALUES (?, ?)", [userId, amount]);
    db.run("UPDATE users SET balance = ? WHERE user_id = ?", [amount, userId], function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getLastTimely(userId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT last_timely FROM users WHERE user_id = ?", [userId], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.last_timely : null);
    });
  });
}

function setLastTimely(userId, isoTime) {
  return new Promise((resolve, reject) => {
    db.run("UPDATE users SET last_timely = ? WHERE user_id = ?", [isoTime, userId], function (err) {
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

  if (interaction.commandName === "bal") {
    const balance = await getBalance(userId);
    await interaction.reply(`Your balance is ${balance} coins.`);
  } else if (interaction.commandName === "award") {
    const amount = interaction.options.getInteger("amount");
    const user = interaction.options.getUser("user");
    const text = interaction.options.getString("text");
    const senderId = interaction.user.id;

    if (amount <= 0) return interaction.reply({ content: "Amount must be positive.", ephemeral: true });

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
      recipients = parseUserIds(text).filter((id) => id !== senderId);
      if (recipients.length === 0) return interaction.reply({ content: "No valid recipients found in text.", ephemeral: true });
    } else if (user && user.id !== senderId) {
      recipients = [user.id];
    } else {
      return interaction.reply({ content: "Please specify a user or text containing users.", ephemeral: true });
    }

    const senderBal = await getBalance(senderId);
    const totalAmount = amount * recipients.length;
    if (senderBal < totalAmount) return interaction.reply({ content: `You need ${totalAmount} coins to give ${amount} each.`, ephemeral: true });

    for (const rid of recipients) {
      const bal = await getBalance(rid);
      await setBalance(rid, bal + amount);
    }
    await setBalance(senderId, senderBal - totalAmount);

    await interaction.reply(`You gave ${amount} coins to ${recipients.length} user(s)!`);
  } else if (interaction.commandName === "timely") {
    const now = DateTime.utc();
    let lastTimelyIso = await getLastTimely(userId);
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
      const balance = await getBalance(userId);
      await setBalance(userId, balance + TIMELY_REWARD);
      await setLastTimely(userId, now.toISO());
      return interaction.reply(`You claimed ${TIMELY_REWARD} coins! Come back in 6 hours.`);
    }
  }
});

client.login(process.env.BOT_TOKEN);
