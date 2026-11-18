import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { createGuildRoleBot } from '../src/guild-role-bot.mjs';
import { createGuildRoleMonitor } from '../src/guild-role-monitor.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-guild-live-'));
let sequence = 0, passed = 0;
const time = text => Date.parse('2026-12-18T' + text + '+08:00');
async function fixture({ permanent = [], at = '20:00:10' } = {}) {
  const accountId = 'fixture-' + ++sequence;
  const members = new Map(Array.from({ length: 40 }, (_, n) => [String(n + 1), { name: '成员' + (n + 1), title: n < 4 ? 4 : n < 24 ? 3 : 2 }]));
  const original = [...members].map(([id, row]) => [id, row.title]);
  const f = { clock: time(at), ready: false, canManage: true, writes: [], members, original, failure: null };
  let settings = { enabled: true, allowedMemberIds: [...members.keys()], permanentViceMemberIds: permanent };
  const client = new EventEmitter(); client.connected = true; client.serverClockOffsetMs = 0;
  client.request = async name => {
    if (name === 'GuildInfoRequest') return { myTitle: f.canManage ? 5 : 2, guild: { guildId: '100' } };
    assert.equal(name, 'GuildMemberRequest');
    return { titleList: [2, 3, 4].map(guildTitle => ({ guildTitle, members: [...members].filter(([, row]) => row.title === guildTitle).map(([playerId, row]) => ({ playerId, nickname: row.name })) })) };
  };
  client.sendWatch = async (name, body) => {
    assert.equal(name, 'ChangeGuildMemberTitleRequest'); assert(f.canManage);
    if (f.failure) throw f.failure;
    f.writes.push({ ...body }); members.get(body.memberId).title = body.title;
    assert([...members.values()].filter(row => row.title === 4).length <= 4);
    assert([...members.values()].filter(row => row.title === 3).length <= 20);
    await f.onWrite?.(body);
  };
  const attach = () => f.bot.attach(client, { getPlayer: () => ({ guildId: '100' }), enabled: () => f.ready && f.canManage,
    accepting: () => f.canManage, schedule: work => work(), afterRestore: async pending => {
      assert.deepEqual([...members].map(([id, row]) => [id, row.title]), original, '必须严格恢复之后才转让');
      f.transfers = (f.transfers || 0) + 1; return { nickname: pending.targetId };
    } });
  const makeBot = () => createGuildRoleBot({ accountId, dataDir: directory, settings, now: () => f.clock, wait: async () => {}, timers: false, random: () => 0 });
  f.bot = makeBot(); attach(); await f.bot.flush();
  f.initialize = async () => { await f.bot.initializeLeadership(); f.ready = true; await f.bot.flush(); };
  f.configure = patch => { settings = { ...settings, ...patch }; f.bot.configure(settings); return f.bot.flush(); };
  f.message = (id, command = 'promote', timestamp = Math.floor(f.clock / 1000)) => ({ senderId: id, nickname: members.get(id).name, command, text: command === 'promote' ? '上副盟' : '下副盟', timestamp });
  f.send = async (id, command = 'promote') => { f.clock += 1000; const message = f.message(id, command); assert(f.bot.receive(client, message).accepted); await f.bot.flush(); return message; };
  f.saved = () => JSON.parse(fs.readFileSync(f.bot.stateFile, 'utf8'));
  f.restart = async () => { f.ready = false; f.bot.detach(); f.bot = makeBot(); attach(); await f.initialize(); };
  f.assertOriginal = () => assert.deepEqual([...members].map(([id, row]) => [id, row.title]), original);
  f.count = title => [...members.values()].filter(row => row.title === title).length;
  f.client = client;
  return f;
}
async function test(name, work) { await work(); console.log('ok - ' + name); passed++; }

try {
  await test('expiry leaves a vacancy; displaced original vice may submit a fresh command', async () => {
    const f = await fixture(); await f.initialize(); const baseline = f.saved().baseline;
    const message = await f.send('25');
    assert.equal(f.bot.receive(f.client, message).reason, 'duplicate');
    const displaced = [...f.members].find(([id, row]) => Number(id) <= 4 && row.title !== 4)[0];
    f.clock += 120001; await f.bot.flush(); assert.equal(f.count(4), 3);
    const writes = f.writes.length; await f.restart(); assert.equal(f.count(4), 3); assert.equal(f.writes.length, writes);
    assert.deepEqual(f.saved().baseline, baseline);
    await f.send(displaced); assert.equal(f.members.get(displaced).title, 4);
    await f.send(displaced, 'demote'); assert.equal(f.count(4), 3);
    await f.bot.restoreNow(); f.assertOriginal();
  });
  await test('temporary to permanent cancels old expiry; removing permanent demotes without a lease', async () => {
    const f = await fixture(); await f.initialize(); const baseline = f.saved().baseline;
    await f.send('25'); const expiry = f.bot.snapshot().leases[0].expiresAt;
    const writes = f.writes.length;
    await f.configure({ permanentViceMemberIds: ['25'] });
    assert.equal(f.bot.snapshot().leases.length, 0); assert.equal(f.writes.length, writes);
    f.clock = expiry + 1; await f.bot.flush(); assert.equal(f.members.get('25').title, 4);
    await f.configure({ permanentViceMemberIds: ['26', '27'] });
    assert.notEqual(f.members.get('25').title, 4);
    assert.equal(f.members.get('26').title, 4); assert.equal(f.members.get('27').title, 4);
    await f.restart(); assert.deepEqual(f.saved().baseline, baseline);
    await f.send('26', 'demote'); assert.equal(f.members.get('26').title, 4, '聊天不能撤销永久身份');
    await f.configure({ permanentViceMemberIds: [] }); assert.equal(f.count(4), 2);
    assert.equal(f.bot.snapshot().leases.length, 0);
    await f.bot.restoreNow(); f.assertOriginal();
  });
  await test('full live leases wait; permanent applicants take newly released slots before normal queue', async () => {
    const f = await fixture(); await f.initialize();
    for (const id of ['25', '26', '27', '28']) await f.send(id);
    const firstExpiry = f.bot.snapshot().leases[0].expiresAt;
    await f.configure({ permanentViceMemberIds: ['29'] });
    assert.deepEqual(f.bot.snapshot().permanentVice.pendingIds, ['29']);
    await f.send('30'); assert.equal(f.bot.snapshot().queue.length, 1); assert.equal(f.members.get('30').title, 2);
    await f.restart(); assert.deepEqual(f.bot.snapshot().permanentVice.pendingIds, ['29']);
    f.clock = firstExpiry + 1; await f.bot.flush();
    assert.equal(f.members.get('29').title, 4); assert.equal(f.members.get('30').title, 2);
    assert.equal(f.bot.snapshot().queue.length, 1);
    f.clock += 1000; await f.bot.flush(); assert.equal(f.members.get('30').title, 4);
    assert.equal(f.bot.snapshot().queue.length, 0);
  });
  await test('outside-window edits remain saved; cutoff restores exact baseline then transfers once', async () => {
    const f = await fixture({ permanent: ['25'], at: '19:50:00' }); await f.initialize();
    assert.equal(f.members.get('25').title, 4, '首次盟主接管允许提前初始化');
    const baseline = f.saved().baseline;
    f.clock = time('21:01:00'); await f.configure({ permanentViceMemberIds: ['26'], transferTargetId: '30', transferAfterRestore: true });
    assert.equal(f.members.get('25').title, 4); assert.equal(f.members.get('26').title, 2);
    assert.equal(f.bot.snapshot().permanentVice.status, 'saved');
    f.clock = time('21:05:00'); await f.bot.flush(); f.assertOriginal(); assert.equal(f.transfers, 1);
    await f.initialize(); await f.restart(); assert.equal(f.transfers, 1); assert.equal(f.bot.snapshot().baseline, null);
    assert(baseline.members.length);
  });
  await test('initialization accepts commands before ready, preserves order and checks both clocks', async () => {
    const f = await fixture({ permanent: ['25', '26'] });
    const later = f.message('28', 'promote', Math.floor(f.clock / 1000));
    const earlier = f.message('27', 'promote', later.timestamp - 1);
    assert(f.bot.receive(f.client, later).accepted); assert(f.bot.receive(f.client, earlier).accepted);
    await f.bot.flush(); assert.equal(f.writes.length, 0);
    await f.initialize();
    const grants = f.writes.filter(row => row.title === 4).map(row => row.memberId);
    assert(grants.indexOf('25') < grants.indexOf('27')); assert(grants.indexOf('27') < grants.indexOf('28'));
    f.client.serverClockOffsetMs = 3600000;
    assert.equal(f.bot.receive(f.client, f.message('30')).accepted, false);
  });
  await test('loss of leadership interrupts writes; failed restore survives restart before handover', async () => {
    const f = await fixture({ permanent: ['25'] }); await f.initialize();
    const baseline = f.saved().baseline; await f.configure({ transferTargetId: '30', transferAfterRestore: true });
    f.failure = new Error('fixture write failure');
    await assert.rejects(f.bot.restoreNow(), /fixture/);
    assert(f.saved().restoring); assert.equal(f.transfers, undefined);
    f.failure = null; await f.restart(); f.assertOriginal(); await f.bot.flush(); assert.equal(f.transfers, 1);
    assert.equal(f.saved().baseline, null); assert(baseline.members.length);
    const g = await fixture(); await g.initialize();
    g.onWrite = () => { g.canManage = false; };
    await g.send('25'); assert.equal(g.writes.length, 1, '失去盟主后立即停止后续写操作');
  });
  await test('elite priority uses a newly freed slot before non-priority demoted vice', async () => {
    const f = await fixture(); await f.configure({ protectedMemberIds: ['30'] }); await f.initialize();
    await f.send('5'); assert.equal(f.members.get('30').title, 3);
    const donor = [...f.members].find(([id, row]) => Number(id) <= 4 && row.title !== 4);
    assert.equal(donor[1].title, 2); assert.equal(f.count(3), 20);
  });
  await test('a newer permanent list interrupts stale operations and wins without changing baseline', async () => {
    const f = await fixture(); await f.initialize(); const baseline = f.saved().baseline;
    let update;
    f.onWrite = () => { f.onWrite = null; update = f.configure({ permanentViceMemberIds: ['26'] }); };
    await f.configure({ permanentViceMemberIds: ['25'] }); await update; await f.bot.flush();
    assert.equal(f.members.get('26').title, 4); assert.notEqual(f.members.get('25').title, 4);
    assert.deepEqual(f.saved().baseline, baseline);
  });
  await test('queued commands recheck whitelist and the clock after a slow roster read', async () => {
    const f = await fixture(); await f.initialize();
    f.ready = false; assert(f.bot.receive(f.client, f.message('25')).accepted);
    await f.configure({ allowedMemberIds: [] }); f.ready = true; await f.bot.flush();
    assert.equal(f.bot.snapshot().queue.length, 0); assert.equal(f.writes.length, 0);
    await f.configure({ allowedMemberIds: ['25'] });
    f.clock = time('20:59:58');
    const request = f.client.request;
    f.client.request = async name => { const result = await request(name); f.clock = time('21:00:01'); return result; };
    await f.send('25'); assert.equal(f.writes.length, 0, '等待成员查询时跨出时段也不得晋升');
  });
  await test('manual handover restore bypasses the bot switch and suppresses another automatic target', async () => {
    const f = await fixture({ permanent: ['25'] }); await f.initialize(); await f.send('26');
    await f.configure({ transferAfterRestore: false, transferTargetId: '30', enabled: false });
    const result = await f.bot.restoreForTransfer({ enabled: () => true });
    assert(result.restored); f.assertOriginal(); assert.equal(f.bot.snapshot().baseline, null);
    assert.equal(f.transfers, undefined); assert.equal(f.bot.snapshot().pendingTransfer, null);
    await f.configure({ enabled: true, transferAfterRestore: true }); f.clock = time('21:05:00'); await f.bot.flush();
    assert.equal(f.transfers, undefined, '手动目标不能被原配置的自动目标抢先转让');
  });
  await test('failed manual handover restore survives restart without transferring the old configured target', async () => {
    const f = await fixture({ permanent: ['25'] }); await f.initialize();
    await f.configure({ transferAfterRestore: true, transferTargetId: '30' });
    const baseline = f.saved().baseline;
    f.failure = new Error('fixture manual restore failure');
    await assert.rejects(f.bot.restoreForTransfer({ enabled: () => true }), /fixture manual restore failure/);
    assert.deepEqual(f.saved().baseline, baseline); assert.equal(f.transfers, undefined);
    f.failure = null; await f.restart(); await f.bot.flush(); f.assertOriginal();
    f.clock = time('21:05:00'); await f.bot.flush(); assert.equal(f.transfers, undefined);
  });
  await test('handover restoration stops if the account is paused while writing', async () => {
    const f = await fixture({ permanent: ['25'] }); await f.initialize();
    let enabled = true; f.onWrite = () => { enabled = false; };
    await assert.rejects(f.bot.restoreForTransfer({ enabled: () => enabled }), /执行条件已变化/);
    assert(f.bot.snapshot().baseline); assert(f.bot.snapshot().restoring); assert.equal(f.transfers, undefined);
  });
  await test('monitor detects leadership without a page, coalesces checks, revokes on push and cleans listeners', async () => {
    const client = new EventEmitter(); client.connected = true;
    let title = 2, canManage = false, reads = 0, initializations = 0, checks = 0;
    const monitor = createGuildRoleMonitor({ client, timers: false, debounceMs: 0, isCurrent: () => true,
      readRoster: async () => { reads++; return { canManage: title === 5, members: [] }; },
      onRoster: roster => { canManage = roster.canManage; }, initialize: async () => { initializations++; },
      revoke: () => { canManage = false; }, afterCheck: () => { checks++; } });
    await monitor.refresh(); assert.equal(canManage, false);
    title = 5; client.emit('message', { name: 'SCGuildMemberTitleChange', body: { title: 5 } });
    await Promise.all([monitor.refresh(), monitor.refresh(), monitor.refresh()]);
    assert(canManage); assert(initializations >= 1); assert(reads <= 5, '合并同一轮重复刷新');
    title = 2; client.emit('message', { name: 'SCGuildMemberTitleChange', body: { title: 2 } });
    assert.equal(canManage, false); await monitor.refresh(); assert.equal(canManage, false); assert(checks);
    monitor.stop(); assert.equal(client.listenerCount('message'), 0); assert.equal(client.listenerCount('close'), 0);
    const count = reads; await monitor.refresh(); assert.equal(reads, count);
  });
  await test('background periodic checks recover a missing ownership push', async () => {
    const client = new EventEmitter(); client.connected = true;
    let leader = false, initialized = false;
    const monitor = createGuildRoleMonitor({ client, pollMs: 20, debounceMs: 1, isCurrent: () => true,
      readRoster: async () => ({ canManage: leader, members: [] }), onRoster: () => {}, revoke: () => {},
      initialize: async () => { initialized = true; } });
    try {
      await monitor.refresh(); leader = true;
      for (let i = 0; i < 50 && !initialized; i++) await sleep(10);
      assert(initialized, '没有推送、没有页面也能通过后台核对接管');
    } finally { monitor.stop(); }
  });
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
console.log('guild role live ok: ' + passed + ' scenarios');
