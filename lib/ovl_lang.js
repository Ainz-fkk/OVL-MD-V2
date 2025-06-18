const { translate } = require('@vitalets/google-translate-api');

function ovl_lang(ovl, cmd_options, lang = 'en') {
    const trdfunc = { ...ovl };
    const opttrad = { ...cmd_options };

    trdfunc.sendMessage = async (jid, msg, opt) => {
        const m = { ...msg };

        if (m.text) {
            const t = await translate(m.text, { to: lang });
            m.text = t.text;
        }

        if (m.caption) {
            const t = await translate(m.caption, { to: lang });
            m.caption = t.text;
        }

        return ovl.sendMessage(jid, m, opt);
    };

    if (typeof cmd_options.repondre === 'function') {
        opttrad.repondre = async (txt, opt) => {
            const t = await translate(txt, { to: lang });
            return cmd_options.repondre(t.text, opt);
        };
    }

    return { ovl: trdfunc, cmd_options: opttrad };
}

module.exports = ovl_lang;
