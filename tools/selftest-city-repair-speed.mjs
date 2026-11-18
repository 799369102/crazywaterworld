// 只使用虚构账号、隔离账本与真实协议编解码，不连接游戏。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { warForgeFixture, warForgeSettings } from './fixtures/war-forge.mjs';
import { createUsageLedger, defaultSettings, validateSettings, saveAutomationSettings, loadAutomationSettings, exportAutomationSettings, importAutomationSettings } from '../src/automation-settings.mjs';
import { runCityRepairSpeed } from '../src/city-repair-speed.mjs';
import { runFleetMaintenance, watchFleetMaintenance } from '../src/fleet-maintenance.mjs';
import { runCityWar } from '../src/city-war.mjs';
import { settleFleetSnapshot, recordsInWorld } from '../src/fleet-settlement.mjs';
import { fleetRecordReason } from '../src/fleet-availability.mjs';
import { watchSiliconMining } from '../src/silicon-mining.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-city-repair-speed-'));
let count = 0, sequence = 0;
const ledger = (file = path.join(root, String(++sequence) + '.json'), extra = {}) => createUsageLedger('虚构城战加速', { file, ...extra });
const test = async (name, fn) => { await fn(); count++; console.log('通过：' + name); };
const nowOf = client => Math.floor((Date.now() + (client.serverClockOffsetMs || 0)) / 1000);
function fixture() {
  const f = warForgeFixture(), settings = warForgeSettings();
  settings.forge.enabled = false;
  Object.assign(settings.cityWar, { fleetIds: ['1远征船'], repairSpeedUp: true, maxRepairSpeedDiamondCost: 500, dailyRepairSpeedDiamondLimit: 1000 });
  Object.assign(settings.resources, { allowDiamonds: true, diamondDailyLimit: 1000, diamondThreshold: 0 });
  f.settings = settings;
  f.config.tables.SpeedUpRubyCfg = { data: [{ minute: 0, fleet: 10 }, { minute: 60, fleet: 20 }] };
  f.state.ruby = 1000;
  const read = f.client.request, send = f.client.sendWatch;
  f.client.request = async (...args) => {
    const response = await read(...args);
    if (args[0] === 'AllResourceRequest') return f.protocol.AllResourceResponse.decode(f.protocol.AllResourceResponse.encode({ list: [{ res: 4, amount: f.state.ruby }] }).finish());
    return response;
  };
  f.client.sendWatch = async (name, body, options) => {
    if (name !== 'SpeedUpRepairRequest') return send(name, body, options);
    f.protocol[name].decode(f.protocol[name].encode(body).finish());
    f.client.writes.push({ name, body: structuredClone(body) });
    await f.beforeSend?.(name, body);
    if (f.speedReject) throw Object.assign(Error('模拟加速明确拒绝'), { prompt: {}, request: name });
    if (f.speedNotSent) throw Object.assign(Error('模拟未发送'), { notSent: true, request: name });
    if (f.speedUnknown) return;
    f.state.ruby -= 40;
    if (f.speedPartial) f.state.fleets.find(row => row.buildingId === body.buildingId).repairing.endTs -= 30;
    else f.finishRepair(body.buildingId);
    if (f.publishMinutes) f.client.emit('message', { name: 'SCSpeedUp', body: { data: [{ type: 4, minutes: 2 }] } });
  };
  return f;
}
function beginRepair(f, l, id = '1远征船', kind = 'cityRepair', confirmed = true) {
  const now = nowOf(f.client), fleet = f.state.fleets.find(row => row.buildingId === id);
  Object.assign(fleet, { state: 4, durability: 1000, maxDura: 2000, curGridIdx: 0, repairing: { startTs: now - 30, endTs: now + 90 } });
  const ticket = l.reserve({ cityWarPetrol: 100 }, {}, {}, { uniqueKey: 'cityWar:1001001:' + id.replace('远征船', ''),
    details: { kind, buildingId: id, beforeDurability: 1000, sentAt: now - 30 } });
  if (confirmed) l.confirm(ticket);
  return fleet;
}
const run = (f, l, extra = {}) => runCityRepairSpeed(f.client, f.protocol, f.config, f.player, { getSettings: () => f.settings, ledger: l, ...extra });
const speeds = f => f.client.writes.filter(row => row.name === 'SpeedUpRepairRequest');

try {
  await test('配置默认关闭，保存重启与导入保留；旧配置补齐为关闭，非法预算拒绝', () => {
    const initial = defaultSettings(); assert.equal(initial.cityWar.repairSpeedUp, false); assert.equal(initial.cityWar.dailyRepairSpeedDiamondLimit, 0);
    const s = fixture().settings, file = path.join(root, 'settings.json');
    saveAutomationSettings('test', s, { file, revision: 0 }); assert.deepEqual(loadAutomationSettings('test', { file }).settings.cityWar, s.cityWar);
    assert.deepEqual(importAutomationSettings(exportAutomationSettings(s)).cityWar, s.cityWar);
    const old = exportAutomationSettings(s);
    for (const key of ['repairSpeedUp', 'maxRepairSpeedDiamondCost', 'dailyRepairSpeedDiamondLimit']) delete old.settings.cityWar[key];
    assert.equal(importAutomationSettings(old).cityWar.repairSpeedUp, false);
    assert.equal(validateSettings(old.settings, { partial: true }).cityWar.maxRepairSpeedDiamondCost, 0);
    for (const key of ['maxRepairSpeedDiamondCost', 'dailyRepairSpeedDiamondLimit']) {
      const invalid = structuredClone(s); invalid.cityWar[key] = -1; assert.throws(() => validateSettings(invalid));
    }
  });
  await test('普通维修确认后加速，完整修好释放锁，随后城战继续出征', async () => {
    const f = fixture(), l = ledger(); beginRepair(f, l);
    const view = await run(f, l); assert.equal(speeds(f).length, 1); assert.equal(view.results[0].status, 'confirmed');
    assert.equal(l.snapshot().counters.diamonds, 40); assert.equal(l.snapshot().counters.cityRepairSpeedDiamonds, 40); assert.equal(l.snapshot().uncertain, 0);
    assert.equal(fleetRecordReason(l.keyRecords(), '1远征船', '1001001'), '');
    await runCityWar(f.client, f.protocol, f.config, f.player, { getSettings: () => f.settings, ledger: l, mapLoader: f.mapLoader });
    assert(f.client.writes.some(row => row.name === 'MoveFleetsToCityRequest'));
  });
  await test('城战与战后维修入口均可先普通维修，再加速，不再占用已满耐久舰队', async () => {
    for (const entry of ['maintenance', 'city']) {
      const f = fixture(), l = ledger(); f.state.fleets[0].durability = 1000;
      const options = { getSettings: () => f.settings, ledger: l, protocol: f.protocol, config: f.config, mapLoader: f.mapLoader };
      if (entry === 'maintenance') {
        const plan = await runFleetMaintenance(f.client, f.player, options); assert.equal(plan.rows[0].state, 'full');
        assert.equal(watchFleetMaintenance(f.client).held().length, 0);
      } else await runCityWar(f.client, f.protocol, f.config, f.player, options);
      assert.deepEqual(f.client.writes.map(row => row.name), ['RepairFleetRequest', 'SpeedUpRepairRequest']);
      assert.equal(l.snapshot().uncertain, 0);
    }
  });
  await test('关闭开关、总开关、普通维修或全局花钻，以及零预算均不消费', async () => {
    for (const change of [s => s.cityWar.enabled = false, s => s.cityWar.autoRepair = false, s => s.cityWar.repairSpeedUp = false,
      s => s.resources.allowDiamonds = false, s => s.resources.diamondDailyLimit = 0,
      s => s.cityWar.maxRepairSpeedDiamondCost = 0, s => s.cityWar.dailyRepairSpeedDiamondLimit = 0]) {
      const f = fixture(), l = ledger(); beginRepair(f, l); change(f.settings); await run(f, l); assert.equal(speeds(f).length, 0);
    }
  });
  await test('单次、城战每日、全局每日、保留量与余额不足分别阻止加速', async () => {
    for (const change of [f => f.settings.cityWar.maxRepairSpeedDiamondCost = 39, f => f.settings.cityWar.dailyRepairSpeedDiamondLimit = 39,
      f => f.settings.resources.diamondDailyLimit = 39, f => f.settings.resources.diamondThreshold = 961, f => f.state.ruby = 39]) {
      const f = fixture(), l = ledger(); beginRepair(f, l); change(f); const result = await run(f, l);
      assert.equal(speeds(f).length, 0); assert(result.results.some(row => row.skipped)); assert.equal(l.snapshot().uncertain, 0);
    }
  });
  await test('仅本场城战时段内生效；不加速城战前维修、手动维修、其他任务或未确认维修', async () => {
    for (const mode of ['before', 'after', 'old', 'manual', 'treasure', 'unconfirmed', 'otherFleet']) {
      const f = fixture(), l = ledger(), fleet = beginRepair(f, l, '1远征船', mode === 'treasure' ? 'treasureRepair' : 'cityRepair', mode !== 'unconfirmed');
      const now = nowOf(f.client);
      if (mode === 'before') f.state.war.startTime = now + 100;
      if (mode === 'after') f.state.war.endTime = now;
      if (mode === 'old') f.state.war.startTime = now - 10;
      if (mode === 'manual') l.releaseCompletedKey('cityWar:1001001:1');
      if (mode === 'otherFleet') f.settings.cityWar.fleetIds = ['2远征船'];
      await run(f, l); assert.equal(speeds(f).length, 0, mode); assert.equal(fleet.state, 4);
    }
  });
  await test('价格表缺失不加速；累计分钟同步后按档位报价，发送前清除旧累计值', async () => {
    const f = fixture(), l = ledger(); beginRepair(f, l); delete f.config.tables.SpeedUpRubyCfg; await run(f, l); assert.equal(speeds(f).length, 0);
    const g = fixture(), m = ledger(); beginRepair(g, m); watchSiliconMining(g.client);
    g.client.emit('message', { name: 'SCSpeedUp', body: { data: [{ type: 4, minutes: 0 }] } });
    g.settings.cityWar.maxRepairSpeedDiamondCost = 20; await run(g, m);
    assert.equal(speeds(g).length, 1); assert.equal(m.snapshot().counters.diamonds, 20); assert.equal(watchSiliconMining(g.client).repairMinutes(), null);
  });
  await test('同轮多队遵守共用每日预算，即使库存读回滞后也不超花', async () => {
    const f = fixture(), l = ledger(); f.settings.cityWar.fleetIds = ['1远征船', '2远征船']; f.settings.cityWar.dailyRepairSpeedDiamondLimit = 60;
    beginRepair(f, l); beginRepair(f, l, '2远征船'); await run(f, l); assert.equal(speeds(f).length, 1); assert.equal(l.snapshot().counters.diamonds, 40);
    const g = fixture(), m = ledger(); g.settings.cityWar.fleetIds = ['1远征船', '2远征船']; g.state.ruby = 60;
    beginRepair(g, m); beginRepair(g, m, '2远征船'); g.beforeSend = () => { g.state.ruby += 40; };
    await run(g, m); assert.equal(speeds(g).length, 1);
  });
  await test('未知结果重启后不重发，后续缩短证据确认；部分加速同轮维修不重复', async () => {
    const f = fixture(), file = path.join(root, 'restart.json'), l = ledger(file); const fleet = beginRepair(f, l); f.speedUnknown = true;
    await run(f, l); assert.equal(l.snapshot().uncertain, 1); assert.match(fleetRecordReason(l.keyRecords(), '1远征船', '1001001'), /待确认|城战任务/);
    const reopened = ledger(file); await run(f, reopened); assert.equal(speeds(f).length, 1);
    fleet.repairing.endTs -= 10; await run(f, reopened); assert.equal(reopened.snapshot().uncertain, 0); assert.equal(speeds(f).length, 1);
    f.finishRepair('1远征船'); settleFleetSnapshot(reopened, { worldId: '1001001', fleets: f.state.fleets, now: nowOf(f.client) });
    assert.equal(fleetRecordReason(reopened.keyRecords(), '1远征船', '1001001'), '');
  });
  await test('未知加速自然完成只释放舰队，跨日后仍保留未知费用；新一轮维修独立去重', async () => {
    const f = fixture(), file = path.join(root, 'next-day.json'); let wall = Date.now(); const l = ledger(file, { now: () => wall }); beginRepair(f, l); f.speedUnknown = true;
    await run(f, l); f.client.serverClockOffsetMs = 86400000; wall += 86400000; f.finishRepair('1远征船');
    const reopened = ledger(file, { now: () => wall });
    settleFleetSnapshot(reopened, { worldId: '1001001', fleets: f.state.fleets, now: nowOf(f.client) });
    assert.equal(reopened.snapshot().uncertain, 1); assert.equal(reopened.pendingCounters().diamonds, 40);
    assert.equal(fleetRecordReason(reopened.keyRecords(), '1远征船', '1001001'), '');
    const now = nowOf(f.client); f.state.war.startTime = now - 60; f.state.war.endTime = now + 1000;
    beginRepair(f, reopened); f.speedUnknown = false; await run(f, reopened); assert.equal(speeds(f).length, 2);
    assert.equal(reopened.snapshot().uncertain, 1);
  });
  await test('明确拒绝或确定未发送会退回预算；拒绝后状态不变不反复请求', async () => {
    for (const key of ['speedReject', 'speedNotSent']) {
      const f = fixture(), l = ledger(); beginRepair(f, l); f[key] = true; await run(f, l); await run(f, l);
      assert.equal(speeds(f).length, 1); assert.equal(l.snapshot().counters.diamonds, 0); assert.equal(l.snapshot().uncertain, 0);
    }
  });
  await test('最后回读时暂停、改配置、换号或维修状态变化均取消发送', async () => {
    for (const mode of ['pause', 'settings', 'identity', 'repair', 'window', 'owner', 'price']) {
      const f = fixture(), l = ledger(); beginRepair(f, l); let reads = 0, enabled = true;
      if (mode === 'price') { watchSiliconMining(f.client); f.client.emit('message', { name: 'SCSpeedUp', body: { data: [{ type: 4, minutes: 0 }] } }); }
      f.beforeRead = name => {
        if (name !== 'MyFleetsRequest' || ++reads !== 2) return;
        if (mode === 'pause') enabled = false;
        if (mode === 'settings') f.settings = structuredClone(f.settings);
        if (mode === 'identity') f.player.worldId = '2001001';
        if (mode === 'repair') f.state.fleets[0].repairing.endTs += 1;
        if (mode === 'window') f.client.serverClockOffsetMs = 7200000;
        if (mode === 'owner') f.state.fleets[0].owner.playerId = '12345';
        if (mode === 'price') { watchSiliconMining(f.client); f.client.emit('message', { name: 'SCSpeedUp', body: { data: [{ type: 4, minutes: 60 }] } }); }
      };
      await run(f, l, { enabled: () => enabled }); assert.equal(speeds(f).length, 0, mode); assert.equal(l.snapshot().uncertain, 0);
    }
  });
  await test('合服匹配或执行期间不加速', async () => {
    for (const merge of [{ matchMaking: true, worldIds: [] }, { worldIds: [1001001], executeTs: Math.floor(Date.now() / 1000) + 600 }]) {
      const f = fixture(), l = ledger(); beginRepair(f, l); const request = f.client.request;
      f.client.request = async (...args) => args[0] === 'UniteWorldsPlanRequest' ? merge : request(...args);
      await run(f, l); assert.equal(speeds(f).length, 0);
    }
  });
  await test('并发调用只发送一次，其他区服的记录不参与舰队锁判断', async () => {
    const f = fixture(), l = ledger(); beginRepair(f, l); await Promise.all([run(f, l), run(f, l)]); assert.equal(speeds(f).length, 1);
    assert.deepEqual(recordsInWorld({ 'cityRepairSpeed:2001001:1:test': { details: { buildingId: '1远征船', kind: 'cityRepairSpeed' } } }, '1001001'), {});
  });
  console.log('城战维修加速专项 ' + count + '/' + count + ' 通过');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
