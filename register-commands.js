const { REST, SlashCommandBuilder, PermissionsBitField, Routes } = require("discord.js");
require("dotenv").config();

const afterDarkGuildId = '606008765270982656';

const commands = [
  new SlashCommandBuilder()
    .setName("bal")
    .setDescription("Show your or another user's balance")
    .addUserOption((opt) => opt.setName("user").setDescription("The user whose balance you want to check").setRequired(false)),

  new SlashCommandBuilder().setName("timely").setDescription("Claim your timely reward every 6 hours"),

  new SlashCommandBuilder()
    .setName("award")
    .setDescription("Award points to user(s)")
    .addIntegerOption((opt) => opt.setName("amount").setDescription("Amount to award").setRequired(true))
    .addStringOption((opt) => opt.setName("users").setDescription("Text containing multiple user mentions or IDs").setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

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

const guildCommands = [
  new SlashCommandBuilder()
    .setName("moon")
    .setDescription("Claim your timely reward every 6 hours")
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, afterDarkGuildId), { body: guildCommands });
    console.log("Slash commands registered!");
  } catch (error) {
    console.error(error);
  }
})();
