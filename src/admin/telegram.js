// admin/telegram.js — Telegram 通知配置管理 & 消息发送
// 功能：保存/读取 tg.json 配置，通过 Telegram Bot API 发送通知

/**
 * 保存 Telegram 配置到 KV
 * @param {object} env - Cloudflare env
 * @param {object} newConfig - { BotToken, ChatID, init? }
 */
export async function saveTgConfig(env, newConfig) {
  if (newConfig.init && newConfig.init === true) {
    await env.KV.put('tg.json', JSON.stringify({ BotToken: null, ChatID: null }, null, 2));
  } else {
    if (!newConfig.BotToken || !newConfig.ChatID) {
      throw new Error('配置不完整：需要 BotToken 和 ChatID');
    }
    await env.KV.put('tg.json', JSON.stringify(newConfig, null, 2));
  }
}

/**
 * 发送 Telegram 通知
 * @param {object} env - Cloudflare env
 * @param {string} message - 通知内容（支持 Markdown）
 * @returns {Promise<boolean>} 是否发送成功
 */
export async function sendTelegramNotification(env, message) {
  try {
    const tgRaw = await env.KV.get('tg.json');
    if (!tgRaw) return false;

    const tg = JSON.parse(tgRaw);
    if (!tg.BotToken || !tg.ChatID) return false;

    const apiUrl = `https://api.telegram.org/bot${tg.BotToken}/sendMessage`;
    const body = JSON.stringify({
      chat_id: tg.ChatID,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });

    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const result = await resp.json();
    return result.ok === true;
  } catch (_) {
    return false;
  }
}