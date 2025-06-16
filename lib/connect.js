const fs = require('fs');
const path = require('path');
const { delay, DisconnectReason, Browsers, makeCacheableSignalKeyStore, fetchLatestBaileysVersion, useMultiFileAuthState, default: makeWASocket } = require("@whiskeysockets/baileys");
const pino = require("pino");
const { getMessage } = require('./store');
const NodeCache = require('node-cache');
const msgRetryCounterCache = new NodeCache();
const { exec } = require("child_process");
const { saveSession, getSession, getAllSessions } = require("../DataBase/connect");
const { message_upsert, group_participants_update, connection_update, dl_save_media_ms, recup_msg } = require('../Ovl_events');


async function conn(numero, ovl, ms_org, ms, disconnect = false) {
  const tmpSessionPath = path.join(__dirname, '../session');
 
  if (!disconnect) {
    const existing = await getSession(numero);
    if (existing) {
      return ovl.sendMessage(ms_org, { text: `⚠️ Ce numéro est déjà connecté.` }, { quoted: ms });
    }
  }
 
  if (!disconnect && fs.existsSync(tmpSessionPath)) {
    fs.rmSync(tmpSessionPath, { recursive: true, force: true });
    fs.mkdirSync(tmpSessionPath, { recursive: true });
  }
  const { state, saveCreds } = await useMultiFileAuthState(tmpSessionPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
    },
    logger: pino({ level: "silent" }),
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: true,
    msgRetryCounterCache
  });
    

  sock.ev.on("creds.update", saveCreds);

  const isFirstLogin = !sock.authState.creds.registered;

  if (isFirstLogin && !disconnect) {
    await delay(1500);
    try {
      const code = await sock.requestPairingCode(numero);

      const sendCode = await ovl.sendMessage(ms_org, {
        text: `${code}`
      }, { quoted: ms });

      await ovl.sendMessage(ms_org, {
        text: "🔗 Voici votre code de parrainage. Suivez les instructions pour terminer la connexion."
      }, { quoted: sendCode });

    } catch (e) {
      await ovl.sendMessage(ms_org, { text: `❌ Erreur : ${e.message}` }, { quoted: ms });
      if (fs.existsSync(tmpSessionPath)) fs.rmSync(tmpSessionPath, { recursive: true, force: true });
      return;
    }
  }

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      await delay(5000);
      try {
        const credsData = fs.readFileSync(path.join(tmpSessionPath, 'creds.json'), 'utf-8');
        const parsedCreds = JSON.parse(credsData);
        await saveSession(numero, parsedCreds);

        await ovl.sendMessage(ms_org, {
          text: `✅ Connexion réussie !\nSession stockée en base de données.`
        }, { quoted: ms });

        sock.end();
        fs.rmSync(tmpSessionPath, { recursive: true, force: true });
 
        const { exec } = require("child_process");
        exec('pm2 restart all', (err) => {
          if (err) {
            ovl.sendMessage(ms_org, { text: `⚠️ Erreur lors du redémarrage :\n${err.message}` }, { quoted: ms });
          }
        });

      } catch (err) {
        await ovl.sendMessage(ms_org, { text: "❌ Erreur lors de la sauvegarde de session." }, { quoted: ms });
      }

    } else if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      reconnect(reason, numero, ovl, ms_org, ms);
    }
  });
    }

function reconnect(reason, numero, ovl, ms_org, ms) {
  if ([DisconnectReason.connectionLost, DisconnectReason.connectionClosed, DisconnectReason.restartRequired].includes(reason)) {
    console.log("🔁 Reconnexion en cours...");
    conn(numero, ovl, ms_org, ms, true);
  } else {
    console.log(`❌ Déconnecté - Raison: ${reason}`);
    const tmpSessionPath = path.join(__dirname, '../session');
    if (fs.existsSync(tmpSessionPath)) fs.rmSync(tmpSessionPath, { recursive: true, force: true });
  }
}

let pendingSessions = [];

async function startNextPendingSession() {
  if (pendingSessions.length === 0) return;

  const id = pendingSessions.shift(); // retire le premier
  const dir = path.join(__dirname, "../auth", id);

  if (!fs.existsSync(dir)) {
    const creds = await getSession(id);
    if (!creds) return startNextPendingSession(); // skip et continue
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "creds.json"), JSON.stringify(creds, null, 2), "utf8");
  }

  await startSingleSession(dir, id);
}

async function startSingleSession(sessionDir, sessionId) {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const ovl = makeWASocket({
  version,
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
  },
  logger: pino({ level: "silent" }),
  keepAliveIntervalMs: 10000,
  browser: Browsers.ubuntu("Chrome"),
  msgRetryCounterCache,
  syncFullHistory: false,
  markOnlineOnConnect: true,
  getMessage: async (key) => {
  const msg = getMessage(key.id);
  return msg?.message || undefined;
  }
});

    ovl.ev.on("messages.upsert", async (m) => message_upsert(m, ovl));
    ovl.ev.on("group-participants.update", async (data) => group_participants_update(data, ovl));
    ovl.ev.on("connection.update", async (con) => {
      connection_update(con, ovl, () => startSingleSession(sessionDir, sessionId), startNextPendingSession);
    });
    ovl.ev.on("creds.update", saveCreds);
 
    ovl.dl_save_media_ms = (msg, filename = '', attachExt = true, dir = './downloads') =>
      dl_save_media_ms(ovl, msg, filename, attachExt, dir);

    ovl.recup_msg = (params = {}) =>
      recup_msg({ ovl, ...params });

    console.log(`✅ Session secondaire lancée : ${sessionId}`);
  } catch (err) {
    console.error(`❌ Erreur avec la session ${sessionId} :`, err.message);
  }
}

async function startSecondarySessions() {
  const sessions = await getAllSessions();
  pendingSessions = sessions; // global partagé
  if(sessions) {
  await startNextPendingSession(); // lance la première
  }
}

module.exports = {
  conn,
  startSecondarySessions
};
