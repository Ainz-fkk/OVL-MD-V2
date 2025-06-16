const {
    rankAndLevelUp, lecture_status, like_status, presence,
    dl_status, antidelete, antitag, antilink, antibot,
    getLid, mention, eval_exec, antimention,
} = require('./Message_upsert_events');

const { Bans } = require("../DataBase/ban");
const { Sudo } = require('../DataBase/sudo');
const { getMessage, addMessage } = require('../lib/store');
const { jidDecode, getContentType } = require("@whiskeysockets/baileys");

const evt = require("../lib/ovlcmd");
const config = require("../set");
const prefixe = config.PREFIXE || "";

const { get_stick_cmd } = require("../DataBase/stick_cmd");

async function message_upsert(m, ovl) {
try {
    if (m.type !== 'notify') return;
    const ms = m.messages?.[0];
    if (!ms?.message) return;
    addMessage(ms.key.id, ms);

    const decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            const d = jidDecode(jid) || {};
            return (d.user && d.server && `${d.user}@${d.server}`) || jid;
        }
        return jid;
    };

    async function JidToLid(j) {
        try {
            if (!j) return null;
            const lid = await getLid(j, ovl);
            return lid || j;
        } catch (e) {
            console.error("Erreur JID -> LID :", e.message);
            return j;
        }
    }

    const mtype = getContentType(ms.message);
    const texte = {
        conversation: ms.message.conversation,
        imageMessage: ms.message.imageMessage?.caption,
        videoMessage: ms.message.videoMessage?.caption,
        extendedTextMessage: ms.message.extendedTextMessage?.text,
        buttonsResponseMessage: ms.message.buttonsResponseMessage?.selectedButtonId,
        listResponseMessage: ms.message.listResponseMessage?.singleSelectReply?.selectedRowId,
        messageContextInfo: ms.message.buttonsResponseMessage?.selectedButtonId ||
            ms.message.listResponseMessage?.singleSelectReply?.selectedRowId || ms.text
    }[mtype] || "";

    const ms_org = ms.key.remoteJid;
    const jid_bot = decodeJid(ovl.user.id);
    const id_Bot = await JidToLid(jid_bot);
    const id_Bot_N = id_Bot.split('@')[0];

    const verif_Groupe = ms_org.endsWith("@g.us");
    const infos_Groupe = verif_Groupe ? await ovl.groupMetadata(ms_org) : {};
    const nom_Groupe = infos_Groupe.subject || "";
    const mbre_membre = verif_Groupe ? infos_Groupe.participants : [];
    const groupe_Admin = await Promise.all(mbre_membre.filter((p) => p.admin).map(async (p) => await JidToLid(p.id)));
    const verif_Ovl_Admin = verif_Groupe && groupe_Admin.includes(id_Bot);

    const msg_Repondu = ms.message.extendedTextMessage?.contextInfo?.quotedMessage;
    const auteur_Msg_Repondu = await JidToLid(decodeJid(ms.message.extendedTextMessage?.contextInfo?.participant));
    const mentionnes = ms.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const mention_JID = await Promise.all(mentionnes.map(jid => JidToLid(jid)));

    const auteur_Message = verif_Groupe
        ? await JidToLid(ms.key.participant)
        : await JidToLid(ms.key.fromMe ? id_Bot : ms.key.remoteJid);

    const nom_Auteur_Message = ms.pushName;
    const arg = texte.trim().split(/ +/).slice(1);
    const isCmd = texte.startsWith(prefixe);
    const cmdName = isCmd ? texte.slice(prefixe.length).trim().split(/ +/)[0].toLowerCase() : "";

    const Ainz = '22651463203';
    const Ainzbot = '22605463559';
    const devNumbers = [Ainz, Ainzbot];

    async function getSudoUsers() {
        try {
            const sudos = await Sudo.findAll({ attributes: ['id'] });
            return sudos.map(e => e.id.replace(/[^0-9]/g, ""));
        } catch (err) {
            console.error("Erreur récupération sudo:", err);
            return [];
        }
    }

    const sudoUsers = await getSudoUsers();
    const jidsToConvert = [Ainz, Ainzbot, jid_bot.split('@')[0], config.NUMERO_OWNER]
    .map(n => `${n.replace(/[^0-9]/g, "")}@s.whatsapp.net`);
    const convertedLIDs = await Promise.all(jidsToConvert.map(j => JidToLid(j)));
    const premiumUsers = [...convertedLIDs, ...sudoUsers];
    const prenium_id = premiumUsers.includes(auteur_Message);
    const dev_num = await Promise.all(devNumbers.map(n => JidToLid(`${n}@s.whatsapp.net`)));
    const dev_id = dev_num.includes(auteur_Message);
    const verif_Admin = verif_Groupe && (groupe_Admin.includes(auteur_Message) || prenium_id);

    const repondre = (msg) => ovl.sendMessage(ms_org, { text: msg }, { quoted: ms });

    const cmd_options = {
        verif_Groupe,
        mbre_membre,
        membre_Groupe: auteur_Message,
        verif_Admin,
        infos_Groupe,
        nom_Groupe,
        auteur_Message,
        nom_Auteur_Message,
        id_Bot,
        prenium_id,
        dev_id,
        dev_num,
        id_Bot_N,
        verif_Ovl_Admin,
        prefixe,
        arg,
        repondre,
        groupe_Admin: () => groupe_Admin,
        msg_Repondu,
        auteur_Msg_Repondu,
        ms,
        ms_org,
        JidToLid,
        texte
    };

    async function isBanned(type, id) {
        const ban = await Bans.findOne({ where: { id, type } });
        return !!ban;
    }

    // Commande texte
    if (isCmd) {
        const cd = evt.cmd.find(c => c.nom_cmd === cmdName || c.alias?.includes(cmdName));
        if (cd) {
            try {
                if (config.MODE !== 'public' && !prenium_id) return;
                if ((!dev_id && auteur_Message !== await JidToLid('221772430620@s.whatsapp.net')) && ms_org === "120363314687943170@g.us") return;
                if (!prenium_id && await isBanned('user', auteur_Message)) return;
                if (!prenium_id && verif_Groupe && await isBanned('group', ms_org)) return;

                await ovl.sendMessage(ms_org, { react: { text: cd.react || "🎐", key: ms.key } });
                await delay(500);
                cd.fonction(ms_org, ovl, cmd_options);
            } catch (e) {
                console.error("Erreur:", e);
                ovl.sendMessage(ms_org, { text: "Erreur: " + e }, { quoted: ms });
            }
        }
    }

    // Commande par sticker
    if (ms?.message?.stickerMessage) {
        try {
            const allStickCmds = await get_stick_cmd();
            const entry = allStickCmds.find(e => e.stick_url == ms.message.stickerMessage.url);
            if (entry)  {

            const cmd = entry.no_cmd;
            const cd = evt.cmd.find(z => z.nom_cmd === cmd || z.alias?.includes(cmd));
            if (cd) {
                if (config.MODE !== 'public' && !prenium_id) return;
                if ((!dev_id && auteur_Message !== await JidToLid('221772430620@s.whatsapp.net')) && ms_org === "120363314687943170@g.us") return;
                if (!prenium_id && await isBanned('user', auteur_Message)) return;
                if (!prenium_id && verif_Groupe && await isBanned('group', ms_org)) return;
                
                await ovl.sendMessage(ms_org, { react: { text: cd.react || "🎐", key: ms.key } });
                 cd.fonction(ms_org, ovl, cmd_options);
            }
        }
        } catch (e) {
            console.error("Erreur sticker command:", e);
        }
    }
    
    // Événements
    rankAndLevelUp(ovl, ms_org, texte, auteur_Message, nom_Auteur_Message, config);
    presence(ovl, ms_org);
    lecture_status(ovl, ms, ms_org);
    like_status(ovl, ms, ms_org, decodeJid(ovl.user.id));
    dl_status(ovl, ms_org, ms);
    eval_exec(ovl, { ...cmd_options });
    antidelete(ovl, ms, auteur_Message, mtype, getMessage);
    //antibug(ovl, ms_org, ms, texte, auteur_Message, verif_Groupe, prenium_id, verif_Ovl_Admin);
    antimention(ovl, ms_org, ms, verif_Groupe, verif_Admin, verif_Ovl_Admin, auteur_Message);
    antitag(ovl, ms, ms_org, mtype, verif_Groupe, verif_Ovl_Admin, verif_Admin, auteur_Message);
    mention(ovl, ms_org, ms, mtype, verif_Groupe, id_Bot, repondre);
    antilink(ovl, ms_org, ms, texte, verif_Groupe, verif_Admin, verif_Ovl_Admin, auteur_Message);
    antibot(ovl, ms_org, ms, verif_Groupe, verif_Admin, verif_Ovl_Admin, auteur_Message);
} catch (e) {
    console.error("❌ Erreur(message.upsert):", e);
}


}

module.exports = message_upsert;
