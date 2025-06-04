const { Client, GatewayIntentBits } = require("discord.js");
const { DateTime } = require("luxon");
const db = require("./db.js");
require("dotenv").config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  // /bal
  if (interaction.commandName === "bal") {
    const balance = await db.getBalance(userId, guildId);
    await interaction.reply(`Your balance is ${balance} points.`);
  }

  // /timely
  else if (interaction.commandName === "timely") {
    const now = DateTime.utc();
    const timelyReward = (await db.getGuildSetting(guildId, "timely_reward")) || 100;
    const timelyIntervalHours = (await db.getGuildSetting(guildId, "timely_interval_hours")) || 24;

    let lastTimelyIso = await db.getLastTimely(interaction.user.id, guildId);
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
      const balance = await db.getBalance(interaction.user.id, guildId);
      await db.setBalance(interaction.user.id, guildId, balance + timelyReward);
      await db.setLastTimely(interaction.user.id, guildId, now.toISO());

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
      const bal = await db.getBalance(rid, guildId);
      await db.setBalance(rid, guildId, bal + amount);
    }

    await interaction.reply({ content: `You awarded ${amount} points to ${recipients.map((r) => `<@${r}>`).join(", ")}!` });
  } else if (interaction.commandName === "configure") {
    if (interaction.options.getSubcommand() === "timely-reward") {
      const amount = interaction.options.getInteger("amount");
      await db.setGuildSetting(guildId, "timely_reward", amount);
      return interaction.reply({ content: `Timely reward set to ${amount} points.`, ephemeral: true });
    } else if (interaction.options.getSubcommand() === "timely-interval") {
      const hours = interaction.options.getInteger("hours");
      await db.setGuildSetting(guildId, "timely_interval_hours", hours);
      return interaction.reply({ content: `Timely interval set to ${hours} hours.`, ephemeral: true });
    }
  }
});

client.login(process.env.BOT_TOKEN);
