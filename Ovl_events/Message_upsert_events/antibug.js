const antibug = async (ovl, ms_org, ms, texte, auteur_Message, verif_Groupe, prenium_id, verif_Ovl_Admin) => {
  const isBuggy = (txt) => {
    const invisibles = /[\u200E\u200F\u200D\u200C\u2060\uFEFF]/g;
    const controlChars = /[\x00-\x1F\x7F]/g;
    const repeatedChars = /(.)\1{20,}/g;
    const jsonLike = txt.match(/{"key":/g)?.length || 0;
    const base64Like = /(?:[A-Za-z0-9+/]{4}){10,}/g;
    const htmlLike = /<[^>]{1,200}>/g;
    const emojiExplosion = txt.match(/[\p{Extended_Pictographic}]{10,}/gu);
    const zeroWidth = txt.match(/(\u200B|\u200C|\u200D|\u2060|\uFEFF)/g)?.length || 0;
    const hasRTL = /[\u202E\u202D]/g.test(txt);
    const lineCount = txt.split('\n').length;

    return (
      txt.length > 8000 ||
      controlChars.test(txt) ||
      zeroWidth > 20 ||
      repeatedChars.test(txt) ||
      base64Like.test(txt) ||
      jsonLike > 30 ||
      (htmlLike.test(txt) && txt.length > 1000) ||
      emojiExplosion?.length ||
      hasRTL ||
      lineCount > 300 ||
      (invisibles.test(txt) && txt.length > 300) ||
      (txt.length > 100 && txt.match(/[^\x00-\x7F]/g)?.length > 80)
    );
  };

  if (isBuggy(texte)) {
    try {
      await ovl.sendMessage(ms.key.remoteJid, {
        delete: {
          remoteJid: ms_org,
          fromMe: false,
          id: ms.key.id,
          participant: auteur_Message
        }
      });

      const mention = [auteur_Message];

      if (!verif_Groupe && !prenium_id) {
        const isBlocked = await ovl.fetchBlocklist().then(list => list.includes(auteur_Message));
        if (!isBlocked) {
          await ovl.updateBlockStatus(auteur_Message, "block");
          await ovl.sendMessage(ms_org, {
            text: `🛡️ *Message dangereux détecté !*\n@${auteur_Message.split('@')[0]} a été *bloqué* pour sécurité.`,
            mentions: mention
          });
        }
      }

      if (verif_Groupe && !prenium_id) {
        if (verif_Ovl_Admin) {
          const groupData = await ovl.groupMetadata(ms_org);
          const isStillInGroup = groupData.participants.some(p => p.id === auteur_Message);

          if (isStillInGroup) {
            await ovl.groupParticipantsUpdate(ms_org, [auteur_Message], "remove");
            await ovl.sendMessage(ms_org, {
              text: `🛡️ *Message dangereux détecté !*\n@${auteur_Message.split('@')[0]} a été *supprimé du groupe*.`,
              mentions: mention
            });
          }
        } else {
          await ovl.sendMessage(ms_org, {
            text: `🛡️ *Message dangereux détecté !*\nMais je ne suis pas admin donc je ne peux pas retirer @${auteur_Message.split('@')[0]}.`,
            mentions: mention
          });
        }
      }

      console.log(`Message suspect supprimé de ${ms.pushName || auteur_Message}`);
    } catch (e) {
      console.error("Erreur AntiBug :", e);
    }
  }
};

module.exports = antibug;
