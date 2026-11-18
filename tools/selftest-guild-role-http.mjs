import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-guild-role-http-'));
process.env.CW_DATA_DIR = directory;
process.env.CW_CONFIG_PACK = path.join(directory, 'config.json');
process.env.CW_PROTO_BUNDLE = path.join(directory, 'unused.js');
fs.writeFileSync(process.env.CW_CONFIG_PACK, '[]');
const { GameClient } = await import('../src/client.mjs');
const { saveStore } = await import('../src/accounts.mjs');
const { saveGuildRoleSettings, loadGuildRoleSettings } = await import('../src/guild-role-settings.mjs');
const { createConsole } = await import('../src/server.mjs');
const realNow = Date.now, nativeFetch = globalThis.fetch;
Date.now = () => Date.parse('2026-12-20T20:00:10+08:00');
let title = 2, writes = 0, reads = 0, allowManualTransfer = false;
let failRestoration = false, expectedRestored = null, restorationGate = null, restorationEntered = null;
const transferTargets = [];
const live = new Set(), members = new Map();
for (let i = 1; i <= 26; i++) members.set(String(i), { name: '成员' + i, title: i <= 4 ? 4 : i <= 24 ? 3 : 2 });
members.set('99', { name: '当前账号', title: 2 }); members.set('100', { name: '原盟主', title: 5 });
const original = () => [...members].map(([id, member]) => [id, member.title]).filter(([id]) => id !== '99');
Object.defineProperty(GameClient.prototype, 'connected', { get() { return live.has(this); } });
GameClient.prototype.connect = async function (login) {
  assert.equal(login.fixture, true); live.add(this);
  return { result: 0, playerInfo: { playerId: '99', guildId: '999', nickname: '离线测试', level: 25, worldId: 1000001 } };
};
GameClient.prototype.send = name => assert.equal(name, 'LoginFinishRequest');
GameClient.prototype.request = async function (name) {
  reads++;
  if (name === 'GuildInfoRequest') return { myTitle: title, guild: { guildId: '999', name: '离线联盟' } };
  if (name === 'GuildMemberRequest') return { total: members.size, titleList: [2, 3, 4, 5].map(guildTitle => ({ guildTitle,
    members: [...members].filter(([, row]) => row.title === guildTitle).map(([playerId, row]) => ({ playerId, nickname: row.name })) })) };
  // Other login recovery reads are harmless and entirely stubbed.
  return {};
};
GameClient.prototype.sendWatch = async function (name, body) {
  assert.equal(title, 5); assert.equal(name, 'ChangeGuildMemberTitleRequest');
  if (body.title === 5) {
    assert(allowManualTransfer, '本测试只允许显式手动转让');
    if (expectedRestored) assert.deepEqual(original(), expectedRestored, '必须先恢复全部原始职务，才发送转让请求');
    transferTargets.push(body.memberId);
    title = 2; members.get('99').title = 2;
  }
  if (body.title !== 5) {
    if (failRestoration) throw new Error('fixture restore failure');
    if (restorationGate) { const gate = restorationGate; restorationGate = null; restorationEntered(); await gate; }
  }
  writes++; members.get(body.memberId).title = body.title;
};
GameClient.prototype.stop = function () { live.delete(this); this.stopping = true; this.emit('close'); };
globalThis.fetch = (url, options) => { assert.equal(new URL(url).hostname, '127.0.0.1', '禁止连接真实服务'); return nativeFetch(url, options); };
saveStore({ activeId: 'fixture', accounts: [{ id: 'fixture', url: 'ws://invalid.invalid', login: { fixture: true }, automation: { enabled: false, autoStart: false } }] });
saveGuildRoleSettings('fixture', directory, { enabled: true, allowedMemberIds: ['25'], protectedMemberIds: ['100'], permanentViceMemberIds: ['25'], transferTargetId: '100' }, { revision: 0 });
const app = createConsole({ port: 0, protocol: {}, captureController: { inspectCaptureRecovery: () => ({ pending: false }) } });
try {
  const root = await app.listen();
  async function response(route, payload) {
    const res = await fetch(root + '/api/' + route + '?account=fixture', { ...(payload ? { method: 'POST', body: JSON.stringify({ confirm: true, ...payload }) } : {}), signal: AbortSignal.timeout(8000) });
    return { code: res.status, data: await res.json() };
  }
  async function api(route, payload) { const res = await response(route, payload); assert.equal(res.code, 200, JSON.stringify(res.data)); return res.data; }
  async function until(work) { for (let i = 0; i < 150; i++) { if (work()) return; await sleep(20); } assert.fail('后台同步超时'); }
  await api('connect', {});
  const session = app.sessions.get('fixture');
  await session.guildRoleMonitor.refresh(); assert.equal(session.guildRoleCanManage, false); assert.equal(writes, 0);
  // No page or members endpoint is used to trigger leadership initialization.
  title = 5; members.get('99').title = 5; members.get('100').title = 2;
  const baseline = original();
  session.client.emit('message', { name: 'SCGuildMemberTitleChange', body: { title: 5 } });
  await until(() => session.guildRoleReady && members.get('25').title === 4);
  const captured = JSON.parse(fs.readFileSync(session.guildRoleBot.stateFile, 'utf8')).baseline;
  const roster = await api('guild-role/members'); assert.equal(roster.members.find(row => row.id === '25').title, 4);
  assert(roster.status.canManage && roster.status.ready);
  for (let i = 0; i < 5; i++) session.client.emit('message', { name: 'SCGuildMemberTitleChange', body: { title: 5 } });
  await session.guildRoleMonitor.refresh();
  assert.deepEqual(JSON.parse(fs.readFileSync(session.guildRoleBot.stateFile, 'utf8')).baseline, captured);
  const config = await api('guild-role/config');
  const saved = await api('guild-role/permanent-vice', { revision: config.revision, memberIds: ['26'] });
  await session.guildRoleBot.flush(); await session.guildRoleMonitor.refresh();
  assert.equal(members.get('26').title, 4); assert.notEqual(members.get('25').title, 4);
  const persisted = loadGuildRoleSettings('fixture', directory);
  assert.deepEqual(persisted.settings.allowedMemberIds, ['25']); assert.deepEqual(persisted.settings.protectedMemberIds, ['100']); assert.equal(persisted.settings.transferTargetId, '100');
  assert.equal((await response('guild-role/permanent-vice', { revision: config.revision, memberIds: [] })).code, 400);
  assert.equal((await response('guild-role/permanent-vice', { revision: saved.revision, memberIds: ['1', '2', '3'] })).code, 400);
  assert.equal((await response('guild-role/config', { revision: saved.revision, settings: { ...saved.settings, protectedMemberIds: ['1'] } })).code, 400);
  const cachedReads = reads; await api('guild-role/roster'); await api('guild-role/status'); assert.equal(reads, cachedReads, '页面轮询只读取缓存');
  // Select B while the automatic configuration points to A; the explicit target must win.
  await api('guild-role/config', { revision: saved.revision, settings: { ...saved.settings, transferAfterRestore: true, transferTargetId: '100' } });
  const beforeInvalid = writes;
  const invalid = await response('guild-role/transfer-president', { targetId: '26', expectedNickname: 'wrong nickname' });
  assert.equal(invalid.code, 400); assert.equal(writes, beforeInvalid); assert(session.guildRoleBot.snapshot().baseline);
  assert.equal((await response('guild-role/transfer-president', { targetId: '99999', expectedNickname: 'missing' })).code, 400);
  assert.equal(writes, beforeInvalid, '无效目标不能先恢复职务');

  const timestamp = Math.floor(Date.now() / 1000);
  assert(session.guildRoleBot.receive(session.client, { senderId: '25', nickname: '成员25', command: 'promote', text: '上副盟', timestamp }).accepted);
  await session.guildRoleBot.flush(); assert.equal(session.guildRoleBot.snapshot().leases.length, 1);
  session.guildRoleReady = false;
  assert(session.guildRoleBot.receive(session.client, { senderId: '25', nickname: '成员25', command: 'demote', text: '下副盟', timestamp: timestamp + 1 }).accepted);
  assert.equal(session.guildRoleBot.snapshot().queue.length, 1);
  failRestoration = true; expectedRestored = baseline; allowManualTransfer = true;
  const failed = await response('guild-role/transfer-president', { targetId: '26', expectedNickname: '成员26' });
  assert.equal(failed.code, 400); assert.match(failed.data.error, /fixture restore failure/);
  assert(session.guildRoleBot.snapshot().baseline); assert(session.guildRoleBot.snapshot().restoring);
  assert.equal(transferTargets.length, 0, '恢复失败时不得转让');
  assert.equal(session.guildRoleTransferring, false, '失败后释放请求锁以便重试');

  failRestoration = false;
  let releaseRestoration, enterRestoration;
  restorationGate = new Promise(resolve => { releaseRestoration = resolve; });
  const entered = new Promise(resolve => { enterRestoration = resolve; }); restorationEntered = enterRestoration;
  const transferJob = response('guild-role/transfer-president', { targetId: '26', expectedNickname: '成员26' });
  await entered;
  assert.equal((await response('guild-role/transfer-president', { targetId: '26', expectedNickname: '成员26' })).code, 400);
  assert.equal(session.guildRoleBot.receive(session.client, { senderId: '25', nickname: '成员25', command: 'promote', text: '上副盟', timestamp: timestamp + 2 }).accepted, false);
  releaseRestoration();
  const transfer = await transferJob;
  assert.equal(transfer.code, 200, JSON.stringify(transfer.data)); assert(transfer.data.restored);
  assert.equal(title, 2); assert.deepEqual(transferTargets, ['26'], '不得先转给自动配置中的旧目标');
  assert.equal(session.guildRoleBot.snapshot().baseline, null); assert.equal(session.guildRoleBot.snapshot().leases.length, 0);
  assert.equal(session.guildRoleBot.snapshot().queue.length, 0); assert.equal(session.guildRoleBot.snapshot().pendingTransfer, null);
  assert.equal(loadGuildRoleSettings('fixture', directory).settings.enabled, false);
  expectedRestored = null;
  const beforeRetry = writes;
  const retry = await api('guild-role/transfer-president', { targetId: '26', expectedNickname: '成员26' });
  assert(retry.alreadyTransferred); assert.equal(writes, beforeRetry, '结果已确认后的重试不能重复发送');
  await api('disconnect', {}); const afterDisconnect = reads; await session.guildRoleMonitor.refresh(); assert.equal(reads, afterDisconnect);
  // A v5 activity from yesterday must be allowed to restore before permanent initialization.
  const oldState = JSON.parse(fs.readFileSync(session.guildRoleBot.stateFile, 'utf8'));
  oldState.version = 5; oldState.baseline = { ...captured, day: '2026-12-19' };
  for (const key of ['runtimeMembers', 'managedPermanentIds', 'pendingPermanentIds', 'permanentInitialized']) delete oldState[key];
  fs.writeFileSync(session.guildRoleBot.stateFile, JSON.stringify(oldState));
  for (const member of captured.members) members.get(member.memberId).title = member.title;
  title = 5; members.get('99').title = 5;
  saveStore({ activeId: 'fixture', accounts: [{ id: 'fixture', url: 'ws://invalid.invalid', login: { fixture: true }, automation: { enabled: false, autoStart: false } }] });
  const secondApp = createConsole({ port: 0, protocol: {}, captureController: { inspectCaptureRecovery: () => ({ pending: false }) } });
  try {
    const secondRoot = await secondApp.listen();
    const connection = await fetch(secondRoot + '/api/connect?account=fixture', { method: 'POST', body: '{}' });
    assert.equal(connection.status, 200);
    const recovered = secondApp.sessions.get('fixture'); await recovered.guildRoleMonitor.refresh();
    await until(() => JSON.parse(fs.readFileSync(recovered.guildRoleBot.stateFile, 'utf8')).restoredDays.includes('2026-12-19'));
    assert(recovered.guildRoleReady, '跨日快照不应因等待永久初始化而阻断补偿恢复');
  } finally { await secondApp.close(); }
  console.log('guild role HTTP ok: background ownership push, fresh roster, immutable snapshot, partial saves, conflicts and disconnect cleanup');
} finally {
  await app.close(); Date.now = realNow; globalThis.fetch = nativeFetch;
  fs.rmSync(directory, { recursive: true, force: true });
}
