const sqlite3 = require("sqlite3").verbose();
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

module.exports = {
  getBalance(userId, guildId) {
    return new Promise((resolve, reject) => {
      db.get("SELECT balance FROM users WHERE user_id = ? AND guild_id = ?", [userId, guildId], (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.balance : 0);
      });
    });
  },
  setBalance(userId, guildId, amount) {
    return new Promise((resolve, reject) => {
      db.run("UPDATE users SET balance = ? WHERE user_id = ? AND guild_id = ?", [amount, userId, guildId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },

  getLastTimely(userId, guildId) {
    return new Promise((resolve, reject) => {
      db.get("SELECT last_timely FROM users WHERE user_id = ? AND guild_id = ?", [userId, guildId], (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.last_timely : null);
      });
    });
  },
  setLastTimely(userId, guildId, isoTime) {
    return new Promise((resolve, reject) => {
      db.run("UPDATE users SET last_timely = ? WHERE user_id = ? AND guild_id = ?", [isoTime, userId, guildId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },

  getGuildSetting(guildId, setting) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT ${setting} FROM guild_settings WHERE guild_id = ?`, [guildId], (err, row) => {
        if (err) return reject(err);
        resolve(row ? row[setting] : null);
      });
    });
  },
  setGuildSetting(guildId, setting, value) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO guild_settings (guild_id, ${setting}) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET ${setting} = ?`,
        [guildId, value, value],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  },
};
