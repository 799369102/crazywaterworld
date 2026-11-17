// 配置下线仅改变可见性和有效执行，不删除历史偏好；所有账号和连接均为离线夹具。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-activity-config-'));
const originalNow = Date.now;
const originalData = process.env.CW_DATA_DIR;
const originalPack = process.env.CW_CONFIG_PACK;
Date.now = () => Date.parse('2026-11-12T12:00:00+08:00');
process.env.CW_DATA_DIR = directory;
process.env.CW_CONFIG_PACK = path.join(directory, 'config.json');
fs.writeFileSync(process.env.CW_CONFIG_PACK, '[]');

const { saveStore } = await import('../src/accounts.mjs');
const { createConsole } = await import('../src/server.mjs');
const { activityAvailability } = await import('../src/activity-availability.mjs');
const { catalogEntry, rememberActivityCatalog } = await import('../src/activity-catalog.mjs');
const retiredKeys = activityAvailability().hiddenTasks;
const keepKeys = ['beautyVotes', 'beautyGift', 'merchantTrade', 'armsRaceRewards', 'newbieLogin', 'pirateRankRewards', 'warRankRewards', 'weekPass'];
saveStore({ activeId: 'event-a', accounts: ['event-a', 'event-b', 'merchant-default', 'merchant-legacy'].map(id => ({
  id, label: id, url: 'ws://invalid.invalid', login: {}, automation: { enabled: false,
    ...(id === 'merchant-legacy' ? { tasks: { weekOrderSubmit: true, weekOrderFinal: false } } : {}),
  },
})) });
const app = createConsole({ port: 0 });
const root = await app.listen();
let passed = 0;
const test = async (name, work) => { await work(); passed++; console.log('通过：' + name); };
async function api(route, body = null, account = 'event-a') {
  const response = await fetch(root + '/api/' + route + '?account=' + account, {
    ...(body === null ? {} : { method: 'POST', body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, data: await response.json() };
}
const ok = result => { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
const selected = settings => ({
  schedule: Object.fromEntries(retiredKeys.map(key => [key, settings.schedule[key]])),
  eventActions: settings.eventActions,
});

try {
  await test('无游戏连接时下线16项联动配置，保留其他活动且没有登录副作用', async () => {
    assert.equal(retiredKeys.length, 16);
    const settings = ok(await api('settings'));
    const loop = ok(await api('loop'));
    for (const key of retiredKeys) {
      assert(!settings.tasks.some(task => task.key === key), key);
      assert(settings.rules.hiddenFields.includes('schedule.' + key), key);
      assert(!loop.tasks.some(task => task.key === key), key);
      assert(!loop.controls.some(control => control.key === 'schedule.' + key), key);
      assert.equal(typeof settings.settings.schedule[key], 'boolean');
    }
    for (const key of keepKeys) assert(settings.tasks.some(task => task.key === key), key);
    for (const field of ['eventActions.compassThreshold', 'eventActions.compassDrawCount']) {
      assert(settings.rules.hiddenFields.includes(field));
    }
    assert.equal(app.sessions.get('event-a').client, null);
  });

  await test('保存其他配置不清零历史开关和罗盘参数，账号互相隔离', async () => {
    let before = ok(await api('settings'));
    const other = ok(await api('settings', null, 'event-b'));
    const settings = structuredClone(before.settings);
    retiredKeys.forEach((key, index) => { settings.schedule[key] = index % 2 === 0; });
    settings.eventActions.compassThreshold = 23;
    settings.eventActions.compassDrawCount = 5;
    const history = selected(settings);
    before = ok(await api('settings', { settings, revision: before.revision, baseRevision: before.baseRevision }));
    assert.deepEqual(selected(before.settings), history);
    before.settings.resources.keepAccelerators = 42;
    const saved = ok(await api('settings', { settings: before.settings, revision: before.revision, baseRevision: before.baseRevision }));
    assert.deepEqual(selected(saved.settings), history);
    assert.equal(saved.settings.resources.keepAccelerators, 42);
    assert.deepEqual(ok(await api('settings', null, 'event-b')).settings, other.settings);
  });

  await test('导入导出保留全部隐藏偏好与参数', async () => {
    const before = ok(await api('settings'));
    const document = ok(await api('settings/export'));
    assert.deepEqual(selected(document.settings), selected(before.settings));
    const validated = ok(await api('settings/validate', { document }));
    assert.deepEqual(selected(validated.settings), selected(before.settings));
  });

  await test('尚未开放的活动可以预配置，实际任务继续按开放状态隐藏', async () => {
    for (const [route, key] of [['loop/task', 'riverScore'], ['loop/control', 'schedule.compassSpin']]) {
      const before = ok(await api('settings'));
      ok(await api(route, { confirm: true, key, enabled: true, revision: before.revision }));
    }
    const configured = ok(await api('settings'));
    assert.equal(configured.settings.schedule.riverScore, true);
    assert.equal(configured.settings.schedule.compassSpin, true);
    assert(!configured.tasks.some(task => ['riverScore', 'compassSpin'].includes(task.key)));
    ok(await api('loop/task', { confirm: true, key: 'riverScore', enabled: false }));
    const current = ok(await api('settings'));
    ok(await api('loop/control', { confirm: true, key: 'schedule.compassSpin', enabled: false, revision: current.revision }));
    const after = ok(await api('settings'));
    assert.equal(after.settings.schedule.riverScore, false);
    assert.equal(after.settings.schedule.compassSpin, false);
  });

  await test('运行安排不再把历史已开下线任务列为当前启用', async () => {
    const { settings } = ok(await api('settings'));
    const preview = ok(await api('settings/preview', { settings, category: 'runtime' }));
    assert(!preview.notes.some(note => /走江|酆都|罗盘|驱邪|联动活动/.test(note)));
  });

  await test('复开只恢复当前开放子活动，不修改配置版本或其他账号', async () => {
    const before = ok(await api('settings'));
    const now = Math.floor(Date.now() / 1000);
    const client = new EventEmitter();
    Object.assign(client, { connected: false, serverClockOffsetMs: 0, stop() {},
      festivals: [{ activityId: 99001, type: '捞尸人联动活动', startTime: now - 60, endTime: now + 3600,
        subActivity: [{ subActivityType: 28, openTime: now - 60, closeTime: now + 600 }] }],
    });
    app.sessions.get('event-a').client = client;
    const reopened = ok(await api('settings'));
    assert.equal(reopened.revision, before.revision);
    assert.deepEqual(reopened.settings, before.settings);
    assert(reopened.tasks.some(task => task.key === 'compassSpin'));
    assert(!reopened.tasks.some(task => task.key === 'riverScore'));
    assert(!reopened.rules.hiddenFields.includes('eventActions.compassThreshold'));
    const loop = ok(await api('loop'));
    assert(loop.controls.some(control => control.key === 'schedule.compassSpin'));
    ok(await api('loop/control', { confirm: true, key: 'schedule.compassSpin', enabled: true, revision: reopened.revision }));
    assert(!ok(await api('settings', null, 'event-b')).tasks.some(task => task.key === 'compassSpin'));
    client.festivals[0].subActivity[0].closeTime = now;
    assert(!ok(await api('settings')).tasks.some(task => task.key === 'compassSpin'));
    assert.equal(ok(await api('settings')).settings.schedule.compassSpin, true);
  });

  await test('本地活动目录支持离线查看未来与历史，回显已保存开关且不连接游戏', async () => {
    const now = Math.floor(Date.now() / 1000), session = app.sessions.get('event-a');
    rememberActivityCatalog('event-a', [
      catalogEntry({ id: 'old-festival', name: '酆都诡事', kind: 'limited', taskKeys: ['compassSpin'], startTime: now - 200, endTime: now - 100 }, now),
      catalogEntry({ id: 'future-festival', name: '龙王罗盘', kind: 'limited', taskKeys: ['compassSpin'], startTime: now + 100, endTime: now + 200 }, now),
      catalogEntry({ id: 'limitTimePack:9950702', name: '限时礼包 9950702', kind: 'limited', taskKeys: [], endTime: now + 100 }, now),
      catalogEntry({ id: 'backLTPack:123', name: '返场限时礼包', kind: 'limited', taskKeys: [], endTime: now - 100 }, now),
      catalogEntry({ id: 'chainPack:456', name: '连锁礼包', kind: 'limited', taskKeys: [], endTime: now + 100 }, now),
      catalogEntry({ id: 'tierActivity', name: '阶梯任务礼包', kind: 'limited', taskKeys: [], startTime: now - 100, endTime: now + 100 }, now),
      catalogEntry({ id: 'merchant', name: '海商王', kind: 'limited', taskKeys: [] }, now),
    ], now);
    session.paused = true;
    const client = session.client;
    const view = ok(await api('activities/catalog'));
    assert.equal(view.catalogOnly, true);
    assert.deepEqual(view.activities.map(row => row.lifecycle), ['ended', 'upcoming']);
    assert(view.activities.every(row => row.observed === false));
    assert.equal(view.eventTasks.find(row => row.key === 'compassSpin').enabled, true);
    assert.equal(typeof view.compassSpinCount, 'number');
    assert.equal(session.client, client);
    assert.equal(session.connecting, null);
    assert.equal(session.loop.running, false);
    assert.equal(ok(await api('activities/catalog', null, 'event-b')).activities.length, 0);
    session.paused = false;
  });

  await test('商人活动配置在未连接时读取默认值和旧挂机选择', async () => {
    const defaults = ok(await api('week-order/settings', null, 'merchant-default'));
    assert.deepEqual(defaults.settings, { autoSubmit: false, allowDiamonds: false, autoFinal: true });
    assert.equal(defaults.revision, 0);
    assert.equal(typeof defaults.baseRevision, 'string');
    const legacy = ok(await api('week-order/settings', null, 'merchant-legacy'));
    assert.deepEqual(legacy.settings, { autoSubmit: true, allowDiamonds: false, autoFinal: false });
    for (const id of ['merchant-default', 'merchant-legacy']) {
      assert.equal(app.sessions.get(id).client, null);
      assert.equal(app.sessions.get(id).loop.running, false);
    }
  });

  await test('商人活动单项保存继承旧偏好，原设置与其他账号独立', async () => {
    const before = ok(await api('settings', null, 'merchant-legacy'));
    const other = ok(await api('settings', null, 'merchant-default'));
    let current = ok(await api('week-order/settings', null, 'merchant-legacy'));
    const expected = structuredClone(before.settings);
    for (const [key, enabled, group, field] of [
      ['allowDiamonds', true, 'weekOrder', 'allowDiamonds'],
      ['autoSubmit', false, 'schedule', 'weekOrderSubmit'],
      ['autoFinal', true, 'schedule', 'weekOrderFinal'],
    ]) {
      const next = ok(await api('week-order/settings', {
        key, enabled, revision: current.revision, baseRevision: current.baseRevision, confirm: true,
      }, 'merchant-legacy'));
      expected[group][field] = enabled;
      assert.equal(next.revision, current.revision + 1);
      assert.equal(next.settings[key], enabled);
      assert.deepEqual(ok(await api('week-order/settings', null, 'merchant-legacy')), next);
      assert.deepEqual(ok(await api('settings', null, 'merchant-legacy')).settings, expected);
      current = next;
    }
    assert.equal(current.settings.allowDiamonds, true, '关闭自动完成保留补料选择');
    assert.deepEqual(ok(await api('settings', null, 'merchant-default')), other);
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'automation-settings.json'), 'utf8'));
    assert.deepEqual(saved.accounts['merchant-legacy'].settings, expected);
    const session = app.sessions.get('merchant-legacy');
    assert.equal(session.preferences.weekOrder.allowDiamonds, true);
    assert.equal(session.loop.tasks.weekOrderSubmit, false);
    assert.equal(session.loop.tasks.weekOrderFinal, true);
    assert.equal(session.client, null);
    assert.equal(session.loop.running, false);
  });

  await test('商人活动版本冲突和首存挂机快照冲突均不覆盖当前值', async () => {
    const stale = ok(await api('week-order/settings', null, 'merchant-default'));
    ok(await api('loop/task', { key: 'weekOrderSubmit', enabled: true, confirm: true }, 'merchant-default'));
    const baseConflict = await api('week-order/settings', {
      key: 'allowDiamonds', enabled: true, revision: stale.revision, baseRevision: stale.baseRevision, confirm: true,
    }, 'merchant-default');
    assert.equal(baseConflict.status, 400);
    assert(baseConflict.data.fields.revision);
    let current = ok(await api('week-order/settings', null, 'merchant-default'));
    assert.equal(current.revision, 0);
    assert.equal(current.settings.autoSubmit, true);
    assert.equal(current.settings.allowDiamonds, false);
    const first = ok(await api('week-order/settings', {
      key: 'autoFinal', enabled: false, revision: current.revision, baseRevision: current.baseRevision, confirm: true,
    }, 'merchant-default'));
    const versionConflict = await api('week-order/settings', {
      key: 'allowDiamonds', enabled: true, revision: current.revision, baseRevision: current.baseRevision, confirm: true,
    }, 'merchant-default');
    assert.equal(versionConflict.status, 400);
    assert(versionConflict.data.fields.revision);
    assert.deepEqual(ok(await api('week-order/settings', null, 'merchant-default')), first);
    current = ok(await api('settings', null, 'merchant-default'));
    const imported = structuredClone(current.settings);
    imported.schedule.weekOrderSubmit = false;
    ok(await api('settings', { settings: imported, revision: current.revision, baseRevision: current.baseRevision }, 'merchant-default'));
    assert.equal(ok(await api('week-order/settings', null, 'merchant-default')).settings.autoSubmit, false);
  });

  await test('商人活动配置支持暂停与生产同步期间修改，保存不启动游戏', async () => {
    const session = app.sessions.get('merchant-default');
    session.paused = true;
    session.syncingProduction = true;
    try {
      const current = ok(await api('week-order/settings', null, 'merchant-default'));
      const saved = ok(await api('week-order/settings', {
        key: 'allowDiamonds', enabled: true, revision: current.revision, baseRevision: current.baseRevision, confirm: true,
      }, 'merchant-default'));
      assert.equal(saved.settings.allowDiamonds, true);
      assert.equal(session.paused, true);
      assert.equal(session.client, null);
      assert.equal(session.loop.running, false);
    } finally {
      session.syncingProduction = false;
      session.paused = false;
    }
  });

  await test('商人活动配置严格校验字段类型，旧游戏配置导入导出保存同一组值', async () => {
    const before = ok(await api('week-order/settings', null, 'merchant-legacy'));
    const payload = { key: 'allowDiamonds', enabled: false, revision: before.revision, baseRevision: before.baseRevision, confirm: true };
    for (const invalid of [null, [], { ...payload, key: 'unknown' }, { ...payload, key: '__proto__' },
      { ...payload, enabled: 1 }, { ...payload, enabled: 'true' }, { ...payload, revision: String(before.revision) },
      { ...payload, confirm: false }, { ...payload, autoSubmit: true }]) {
      // api(null) is a GET, so send literal null through fetch for this case.
      const result = invalid === null
        ? await fetch(root + '/api/week-order/settings?account=merchant-legacy', { method: 'POST', body: 'null' })
          .then(async response => ({ status: response.status, data: await response.json() }))
        : await api('week-order/settings', invalid, 'merchant-legacy');
      assert.equal(result.status, 400, JSON.stringify(invalid));
    }
    assert.deepEqual(ok(await api('week-order/settings', null, 'merchant-legacy')), before);
    const document = ok(await api('settings/export', null, 'merchant-legacy'));
    const imported = ok(await api('settings/validate', { document }, 'merchant-legacy'));
    assert.equal(imported.settings.schedule.weekOrderSubmit, before.settings.autoSubmit);
    assert.equal(imported.settings.weekOrder.allowDiamonds, before.settings.allowDiamonds);
    assert.equal(imported.settings.schedule.weekOrderFinal, before.settings.autoFinal);
    assert.equal(app.sessions.get('merchant-legacy').client, null);
  });
  console.log('活动下线HTTP专项 ' + passed + '/' + passed + ' 通过');
} finally {
  await app.close();
  Date.now = originalNow;
  if (originalData === undefined) delete process.env.CW_DATA_DIR; else process.env.CW_DATA_DIR = originalData;
  if (originalPack === undefined) delete process.env.CW_CONFIG_PACK; else process.env.CW_CONFIG_PACK = originalPack;
  fs.rmSync(directory, { recursive: true, force: true });
}
