export const GUILD_CHAT_CHANNEL = 2;
export const GUILD_CHAT_HISTORY_LIMIT = 100;

const MAX_TEXT_LENGTH = 500;
const MAX_SEEN_MESSAGES = 500;

function idText(value) {
  if (value && typeof value.low === 'number' && typeof value.high === 'number') {
    const id = (BigInt(value.high) << 32n) + BigInt(value.low >>> 0);
    return id > 0n && id <= (1n << 63n) - 1n ? id.toString() : null;
  }
  if (typeof value === 'bigint') return value > 0n && value <= (1n << 63n) - 1n ? value.toString() : null;
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= (1n << 63n) - 1n) return value;
  return null;
}

export function parseGuildRoleCommand(value) {
  if (typeof value !== 'string') return null;
  const command = value.trim().replace(/\s+/g, '');
  if (command === '上副盟' || command === '上副盟主') return 'promote';
  if (command === '下副盟' || command === '下副盟主') return 'demote';
  return null;
}

export function inGuildRoleWindow(timestampMs) {
  if (!Number.isFinite(timestampMs)) return false;
  const beijing = new Date(timestampMs + 8 * 60 * 60 * 1000);
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  return minutes >= 20 * 60 && minutes < 21 * 60;
}

export function normalizeGuildChatMessage(message) {
  const senderId = idText(message?.sender?.playerId);
  const nickname = typeof message?.sender?.nickname === 'string' ? message.sender.nickname.trim() : '';
  const text = typeof message?.content?.text === 'string' ? message.content.text.trim() : '';
  const timestamp = Number.isSafeInteger(message?.timestamp) && message.timestamp > 0 ? message.timestamp : null;
  if (!senderId || !nickname || !text || text.length > MAX_TEXT_LENGTH || timestamp === null) return null;
  const command = message.content?.type === 1 ? parseGuildRoleCommand(text) : null;
  return {
    senderId,
    nickname,
    text,
    timestamp,
    receivedAt: new Date(timestamp * 1000).toISOString(),
    contentType: message.content?.type ?? null,
    command,
    commandWindow: command ? inGuildRoleWindow(timestamp * 1000) : false,
  };
}

function messageKey(message) {
  return `${message.senderId}\u0000${message.timestamp}\u0000${message.contentType}\u0000${message.text}`;
}

function normalizeList(messages, limit) {
  const seen = new Set();
  const rows = [];
  for (const raw of messages) {
    const row = normalizeGuildChatMessage(raw);
    if (!row) continue;
    const key = messageKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows.slice(-limit);
}

export async function readGuildChat(client, { limit = GUILD_CHAT_HISTORY_LIMIT } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > GUILD_CHAT_HISTORY_LIMIT) {
    throw new Error(`联盟聊天条数请输入 1–${GUILD_CHAT_HISTORY_LIMIT} 之间的整数`);
  }
  const response = await client.request('ChatRecordRequest', { channel: GUILD_CHAT_CHANNEL }, 'ChatRecordResponse');
  if (!Array.isArray(response?.message)) throw new Error('服务器未返回完整的联盟聊天记录');
  return normalizeList(response.message, limit);
}

export function watchGuildChat(client, { onMessage, onError } = {}) {
  if (!client?.on || !client?.off) throw new Error('联盟聊天监听需要可订阅消息的游戏连接');
  const seen = new Map();
  const deliver = raw => {
    try {
      const row = normalizeGuildChatMessage(raw);
      if (!row) return;
      const key = messageKey(row);
      if (seen.has(key)) return;
      seen.set(key, true);
      while (seen.size > MAX_SEEN_MESSAGES) seen.delete(seen.keys().next().value);
      onMessage?.(row);
    } catch (error) {
      onError?.(error);
    }
  };
  const listener = ({ name, body }) => {
    if (name === 'SCChatReceive') {
      if (body?.channel === GUILD_CHAT_CHANNEL) deliver(body.message);
      return;
    }
    if (name === 'SCBatchChatReceive' && Array.isArray(body?.messages)) {
      for (const item of body.messages) if (item?.channel === GUILD_CHAT_CHANNEL) deliver(item.message);
    }
  };
  client.on('message', listener);
  return () => client.off('message', listener);
}
