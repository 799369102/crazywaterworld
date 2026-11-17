import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  GUILD_CHAT_CHANNEL,
  inGuildRoleWindow,
  normalizeGuildChatMessage,
  parseGuildRoleCommand,
  readGuildChat,
  watchGuildChat,
} from '../src/guild-chat.mjs';

const raw = (text, { id = '9007199254740993', nickname = '测试盟友', timestamp = 1797580800, type = 1 } = {}) => ({
  sender: { playerId: id, nickname },
  content: { type, text },
  timestamp,
});

assert.equal(parseGuildRoleCommand(' 上副盟 '), 'promote');
assert.equal(parseGuildRoleCommand('上 副盟主'), 'promote');
assert.equal(parseGuildRoleCommand('下副盟'), 'demote');
assert.equal(parseGuildRoleCommand('请帮我上副盟'), null);
assert.equal(inGuildRoleWindow(Date.parse('2026-12-18T20:00:00+08:00')), true);
assert.equal(inGuildRoleWindow(Date.parse('2026-12-18T20:59:59+08:00')), true);
assert.equal(inGuildRoleWindow(Date.parse('2026-12-18T21:00:00+08:00')), false);

const normalized = normalizeGuildChatMessage(raw('上副盟'));
assert.equal(normalized.senderId, '9007199254740993');
assert.equal(normalized.command, 'promote');
assert.equal(normalizeGuildChatMessage(raw('上副盟', { type: 2 }))?.command, null);
assert.equal(normalizeGuildChatMessage(raw('', {})), null);

const client = new EventEmitter();
client.request = async (name, body, responseName) => {
  assert.equal(name, 'ChatRecordRequest');
  assert.deepEqual(body, { channel: GUILD_CHAT_CHANNEL });
  assert.equal(responseName, 'ChatRecordResponse');
  return { message: [raw('普通聊天'), raw('普通聊天'), raw('下副盟')] };
};
const history = await readGuildChat(client);
assert.equal(history.length, 2);
assert.equal(history[1].command, 'demote');

const pushed = [];
const stop = watchGuildChat(client, { onMessage: message => pushed.push(message) });
client.emit('message', { name: 'SCChatReceive', body: { channel: 1, message: raw('世界聊天') } });
client.emit('message', { name: 'SCChatReceive', body: { channel: 2, message: raw('上副盟') } });
client.emit('message', { name: 'SCChatReceive', body: { channel: 2, message: raw('上副盟') } });
client.emit('message', { name: 'SCBatchChatReceive', body: { messages: [
  { channel: 2, message: raw('下副盟', { timestamp: 1797580801 }) },
  { channel: 1, message: raw('世界消息', { timestamp: 1797580802 }) },
] } });
assert.deepEqual(pushed.map(message => message.command), ['promote', 'demote']);
stop();
client.emit('message', { name: 'SCChatReceive', body: { channel: 2, message: raw('普通聊天', { timestamp: 1797580803 }) } });
assert.equal(pushed.length, 2);

console.log('guild chat ok: history, guild-only pushes, exact member ids, dedupe and command parsing');
