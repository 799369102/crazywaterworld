import assert from 'node:assert/strict';
import { PAGE } from '../src/page.mjs';

const pageScript = [...PAGE.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(script => script.includes('function connectionStatus('));
assert.ok(pageScript, '控制台应包含实际账号状态脚本');
const start = pageScript.indexOf('let snapshot =');
const end = pageScript.indexOf('// ---- 总览', start);
const pollingStart = pageScript.indexOf('setInterval(refreshOverview, 20000);');
assert.ok(start >= 0 && end > start && pollingStart > end);
const accountScript = pageScript.slice(start, end);
const pollingScript = pageScript.slice(pollingStart);
const overviewStart = pageScript.indexOf('let overviewPending =');
const overviewEnd = pageScript.indexOf('// ---- 挂机', overviewStart);
assert.ok(overviewStart > end && overviewEnd > overviewStart);
const overviewScript = pageScript.slice(overviewStart, overviewEnd);
const fixedNow = 1_794_830_400_000;
let passed = 0;

async function test(name, run) {
  await run();
  passed++;
  console.log('通过：' + name);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function settle() {
  for (let index = 0; index < 30; index++) await Promise.resolve();
}

function makeNode() {
  const listeners = new Map();
  let text = '';
  return {
    options: [], value: '', title: '', disabled: false, dataset: {}, writes: 0, replacements: 0,
    classList: { contains: () => false },
    get textContent() { return text; },
    set textContent(value) { text = String(value ?? ''); this.writes++; },
    replaceChildren(...children) { this.options = children; this.replacements++; },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    fire(type, event = {}) { return (listeners.get(type) || []).map(listener => listener(event)); },
  };
}

function fixture(rows = [
  { id: 'account-a', title: '甲角色 · 海港1服', status: { connected: false } },
  { id: 'account-b', title: '乙角色 · 海港2服', status: { connected: false } },
], selected = rows[0]?.id ?? null, { overview = false } = {}) {
  const nodes = new Map();
  const document = makeNode();
  document.hidden = false;
  const env = { now: fixedNow, calls: [], effects: [], errors: [], intervals: [], overviews: [], document, allowed: true };
  env.node = id => {
    if (!nodes.has(id)) nodes.set(id, makeNode());
    return nodes.get(id);
  };
  env.serverAccounts = structuredClone(rows);
  env.respond = async route => {
    if (route === '/api/accounts') return { accounts: structuredClone(env.serverAccounts), activeId: selected };
    return { ok: true };
  };
  env.call = async (route, options) => {
    const record = { route, owner: env.api.current(), payload: options?.body ? JSON.parse(options.body) : null };
    env.calls.push(record);
    return env.respond(route, record);
  };
  env.Option = function Option(text, value) {
    this.text = text;
    this.value = value;
  };
  new Function('env', `
    'use strict';
    const $ = env.node, document = env.document, call = env.call, Option = env.Option;
    const Date = { now: () => env.now };
    const clear = node => { node.textContent = ''; return node; };
    const setInterval = (callback, delay) => { env.intervals.push({ callback, delay }); };
    const reportError = error => env.errors.push(error);
    const configMayChangeAccount = async () => env.allowed;
    const refreshProgression = () => env.effects.push('progression');
    const refreshManualWorld = () => env.effects.push('world');
    const refreshActivities = () => env.effects.push('activities');
    const refreshStages = () => env.effects.push('stages');
    const refreshLoop = () => env.effects.push('loop');
    const renderOverview = data => env.overviews.push(structuredClone(data));
    const refreshActivityRanks = () => env.effects.push('rankings');
    const refreshActivityStatistics = () => env.effects.push('statistics');
    const maybeRefreshWorldMap = () => env.effects.push('world-map');
    ${overview ? overviewScript : "const refreshOverview = () => env.effects.push('overview');"}
    const subscribe = () => env.effects.push('subscribe');
    const configAccountChanged = () => env.effects.push('config');
    const giftAccountChanged = () => env.effects.push('gift');
    const loginSettingsAccountChanged = () => env.effects.push('login-settings');
    const appointmentsAccountChanged = () => {};
    const renderAccounts = () => env.effects.push('account-cards');
    const resetActivityStatistics = () => env.effects.push('clear-statistics');
    const resetWorldMap = () => env.effects.push('clear-map');
    const resetProductionPlan = () => env.effects.push('clear-production');
    let accounts = [], current = null, dailyAccount = null, dailyVersion = 0;
    let activityStatsOwner = null, worldMapOwner = null, productionPlanOwner = null;
    let productionPlanBusy = false, loopReads = 0;
    ${accountScript}
    ${pollingScript}
    env.api = {
      connectionStatus, renderAccountOptions, paintConnection, setBusy,
      setAccountStatus, refreshAccountStatuses, loadAccounts, selectLoadedAccount, refreshOverview,
      current: () => current, rows: () => accounts, snapshot: () => snapshot,
      disconnected, connectingAccounts,
      initialize(rows, selected) {
        accounts = structuredClone(rows);
        current = selected;
        snapshot = accounts.find(account => account.id === current)?.status ?? {};
        accountDetailsOwner = current;
        dailyAccount = current;
        renderAccountSelect();
      },
    };
  `)(env);
  env.api.initialize(rows, selected);
  env.effects.length = 0;
  env.row = id => env.api.rows().find(row => row.id === id);
  env.option = id => env.node('account').options.find(option => option.value === id);
  env.select = id => {
    env.api.selectLoadedAccount(id);
    env.effects.length = 0;
  };
  return env;
}

await test('连接状态优先级、重连倒计时及旧数据缺省值', async () => {
  const env = fixture();
  const status = env.api.connectionStatus;
  assert.equal(status({ syncingProduction: true, paused: true, connected: true }), '正在同步生产状态');
  assert.equal(status({ paused: true, reconnecting: true, connected: true }), '已暂停 · 可自行上号');
  assert.equal(status({ reconnecting: true, loginRecovery: { status: 'connecting' }, connected: true }), '异地登录 · 正在自动重连');
  assert.equal(status({ reconnecting: true, loginRecovery: { nextAttemptAt: fixedNow + 2500 } }), '异地登录 · 3 秒后重试');
  assert.equal(status({ reconnecting: true, loginRecovery: { nextAttemptAt: fixedNow - 1000 } }), '异地登录 · 0 秒后重试');
  assert.equal(status({ reconnecting: true }), '异地登录 · 等待重连');
  assert.equal(status({ reconnecting: true, loginRecovery: { nextAttemptAt: NaN } }), '异地登录 · 等待重连');
  assert.equal(status({ loginBlocked: true, connected: true }), '异地登录 · 等待恢复托管');
  assert.equal(status({ connected: true, state: 'CONNECTING' }), '已连接');
  assert.equal(status({ state: 'CONNECTING' }), '连接中…');
  for (const missing of [undefined, null, {}]) assert.equal(status(missing), '未连接');
});

await test('每项显示自己的状态，空列表和旧账号都可渲染', async () => {
  const env = fixture([
    { id: 'account-a', title: '甲角色 · 海港1服', status: { connected: true } },
    { id: 'account-b', title: '乙角色 · 海港2服', status: { paused: true } },
    { id: 'legacy', title: '旧账号' },
    { id: 'null-status', title: '<角色名称>', status: null },
  ]);
  assert.equal(env.option('account-a').text, '[已连接] 甲角色 · 海港1服');
  assert.equal(env.option('account-b').text, '[已暂停 · 可自行上号] 乙角色 · 海港2服');
  assert.equal(env.option('legacy').text, '[未连接] 旧账号');
  assert.equal(env.option('null-status').text, '[未连接] <角色名称>');
  assert.equal(env.node('busy').textContent, '已连接');
  assert.equal(env.node('account').title, env.option('account-a').text);
  const empty = fixture([]);
  assert.equal(empty.node('account').options.length, 1);
  assert.equal(empty.node('account').options[0].text, '没有账号');
  assert.equal(empty.node('account').disabled, true);
  assert.equal(empty.node('busy').textContent, '没有账号');
  await empty.api.refreshAccountStatuses();
  assert.equal(empty.calls.length, 0);
  assert.match(PAGE, /id="busy"[^>]*class="sr-only"[^>]*role="status"/);
});

await test('状态变化原位更新选项，当前选择和同值播报保持稳定', async () => {
  const env = fixture();
  env.select('account-b');
  const options = [...env.node('account').options];
  const replacements = env.node('account').replacements;
  env.api.setAccountStatus('account-a', { connected: true });
  env.api.setAccountStatus('account-b', { paused: true });
  assert.equal(env.api.current(), 'account-b');
  assert.equal(env.node('account').value, 'account-b');
  assert.equal(env.node('account').replacements, replacements);
  for (const [index, option] of options.entries()) assert.equal(env.node('account').options[index], option);
  const writes = env.node('busy').writes;
  env.api.paintConnection();
  env.api.paintConnection();
  assert.equal(env.node('busy').writes, writes, '同状态不重复触发读屏播报');
});

await test('全账号刷新只合并已有状态，保留账号选择和名称且不读取游戏', async () => {
  const env = fixture();
  env.serverAccounts = [
    { id: 'account-a', title: '旧快照名称', status: { connected: true } },
    { id: 'account-b', title: '旧快照名称', status: { paused: true } },
    { id: 'other-account', title: '其他页面刚添加', status: { connected: true } },
  ];
  env.respond = async () => ({ accounts: env.serverAccounts, activeId: 'other-account' });
  await env.api.refreshAccountStatuses();
  assert.equal(env.api.current(), 'account-a');
  assert.equal(env.api.rows().length, 2);
  assert.equal(env.row('account-a').title, '甲角色 · 海港1服');
  assert.equal(env.api.snapshot().connected, true);
  assert.match(env.option('account-b').text, /已暂停/);
  assert.deepEqual(env.calls.map(call => call.route), ['/api/accounts']);
  assert.deepEqual(env.effects, [], '纯状态读取不切换账号或重载详情');
});

await test('展开下拉及定时刷新共享进行中的请求', async () => {
  const env = fixture();
  const gate = deferred();
  env.respond = () => gate.promise;
  const first = env.api.refreshAccountStatuses();
  const second = env.api.refreshAccountStatuses();
  assert.equal(first, second);
  env.node('account').fire('focus');
  env.node('account').fire('pointerdown');
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ', 'F4']) env.node('account').fire('keydown', { key });
  for (const timer of env.intervals.filter(timer => timer.delay === 3000)) timer.callback();
  assert.equal(env.calls.length, 1);
  gate.resolve({ accounts: env.serverAccounts });
  await first;
  env.respond = async () => ({ accounts: env.serverAccounts });
  env.node('account').fire('keydown', { key: 'Tab' });
  assert.equal(env.calls.length, 1);
  env.node('account').fire('pointerdown');
  await settle();
  assert.equal(env.calls.length, 2);
});

await test('隐藏页面暂停状态轮询，恢复可见自动刷新后台账号', async () => {
  const env = fixture();
  env.document.hidden = true;
  for (const timer of env.intervals.filter(timer => timer.delay === 3000)) timer.callback();
  env.document.fire('visibilitychange');
  assert.equal(env.calls.length, 0);
  env.serverAccounts[1].status = { connected: true };
  env.document.hidden = false;
  env.document.fire('visibilitychange');
  await settle();
  assert.deepEqual(env.calls.map(call => call.route), ['/api/accounts']);
  assert.match(env.option('account-b').text, /已连接/);
});

await test('后台账号重连倒计时逐秒刷新，当前账号状态保持', async () => {
  const env = fixture([
    { id: 'account-a', title: '甲', status: { connected: true } },
    { id: 'account-b', title: '乙', status: { reconnecting: true, loginRecovery: { nextAttemptAt: fixedNow + 5000 } } },
  ]);
  const timer = env.intervals.find(timer => timer.delay === 1000);
  assert.match(env.option('account-b').text, /5 秒后重试/);
  env.now += 1000;
  timer.callback();
  assert.match(env.option('account-b').text, /4 秒后重试/);
  assert.equal(env.node('busy').textContent, '已连接');
  assert.equal(env.calls.length, 0);
  env.document.hidden = true;
  env.now += 1000;
  timer.callback();
  assert.match(env.option('account-b').text, /4 秒后重试/);
});

await test('旧状态响应不覆盖手动更新，请求失败后继续刷新', async () => {
  const env = fixture();
  const gate = deferred();
  env.respond = () => gate.promise;
  const refreshing = env.api.refreshAccountStatuses();
  env.api.setAccountStatus('account-a', { connected: true });
  env.api.setAccountStatus('account-b', { paused: true });
  gate.resolve({ accounts: env.serverAccounts });
  await refreshing;
  assert.equal(env.row('account-a').status.connected, true);
  assert.equal(env.row('account-b').status.paused, true);
  env.respond = async () => { throw new Error('模拟暂时离线'); };
  await env.api.refreshAccountStatuses();
  assert.equal(env.row('account-a').status.connected, true);
  env.respond = async () => ({ accounts: [
    { id: 'account-a', status: { paused: true } }, { id: 'account-b' },
  ] });
  await env.api.refreshAccountStatuses();
  assert.equal(env.row('account-a').status.paused, true);
  assert.equal(env.option('account-b').text, '[未连接] 乙角色 · 海港2服');
});

await test('旧总览响应保留较新的异地登录状态，同时继续展示角色与资源', async () => {
  const env = fixture([
    { id: 'account-a', title: '甲角色', status: { connected: true } },
  ], 'account-a', { overview: true });
  const gate = deferred();
  env.respond = route => route === '/api/overview' ? gate.promise
    : Promise.resolve({ accounts: env.serverAccounts, activeId: 'account-a' });
  const overview = env.api.refreshOverview();
  assert.equal(env.calls[0].route, '/api/overview');
  env.serverAccounts[0].status = {
    connected: false, loginBlocked: true, reconnecting: true,
    loginRecovery: { status: 'waiting', nextAttemptAt: fixedNow + 5000 },
  };
  await env.api.refreshAccountStatuses();
  assert.match(env.option('account-a').text, /异地登录.*5 秒后重试/);
  gate.resolve({
    status: { connected: true, loginBlocked: false, reconnecting: false },
    player: { nickname: '服务器最新角色名', level: 50 },
    resources: [{ name: '金币', amount: 321 }],
  });
  await overview;
  assert.equal(env.api.snapshot().connected, false);
  assert.equal(env.api.snapshot().loginBlocked, true);
  assert.equal(env.row('account-a').status.reconnecting, true);
  assert.match(env.option('account-a').text, /异地登录.*5 秒后重试/);
  assert.equal(env.overviews.length, 1, '较新的轮询不会丢弃总览资源结果');
  assert.deepEqual(env.overviews[0].status, env.api.snapshot(), '角色概况使用较新的连接状态');
  assert.equal(env.overviews[0].player.nickname, '服务器最新角色名');
  assert.equal(env.overviews[0].resources[0].amount, 321);
});

await test('账号列表重叠读取只采用最新响应并阻止同时状态轮询', async () => {
  const env = fixture();
  const older = deferred();
  const newer = deferred();
  let requests = 0;
  env.respond = () => (++requests === 1 ? older.promise : newer.promise);
  const first = env.api.loadAccounts(false);
  const second = env.api.loadAccounts(false);
  env.api.refreshAccountStatuses();
  assert.equal(env.calls.length, 2);
  newer.resolve({ accounts: [{ id: 'account-a', title: '最新角色', status: { connected: true } }], activeId: 'account-a' });
  await second;
  older.resolve({ accounts: [{ id: 'obsolete', title: '过期列表', status: {} }], activeId: 'obsolete' });
  await first;
  assert.equal(env.api.current(), 'account-a');
  assert.equal(env.api.rows().length, 1);
  assert.equal(env.row('account-a').title, '最新角色');
  assert.match(env.option('account-a').text, /已连接/);
});

await test('延迟账号列表采用新名称并保留读取期间更新的状态', async () => {
  const env = fixture();
  const gate = deferred();
  env.respond = () => gate.promise;
  const loading = env.api.loadAccounts(false);
  env.api.setAccountStatus('account-b', { paused: true });
  gate.resolve({ accounts: [
    { id: 'account-a', title: '甲的新备注', status: {} },
    { id: 'account-b', title: '乙的新备注', status: { paused: false } },
  ], activeId: 'account-a' });
  await loading;
  assert.equal(env.row('account-b').status.paused, true);
  assert.equal(env.row('account-b').title, '乙的新备注');
  assert.equal(env.api.current(), 'account-a');
});

await test('连接期间切号，进行中及完成状态仅更新请求所属账号', async () => {
  const env = fixture();
  const connecting = deferred();
  env.respond = route => route === '/api/connect' ? connecting.promise : Promise.resolve({ accounts: env.serverAccounts });
  const request = env.node('connect').onclick();
  assert.match(env.option('account-a').text, /连接中/);
  assert.equal(env.node('connect').disabled, true);
  await env.node('connect').onclick();
  assert.equal(env.calls.filter(call => call.route === '/api/connect').length, 1);
  env.select('account-b');
  assert.match(env.option('account-a').text, /连接中/);
  assert.match(env.option('account-b').text, /未连接/);
  env.serverAccounts[0].status = { connected: true };
  connecting.resolve({ ok: true });
  await request;
  await settle();
  assert.equal(env.calls.find(call => call.route === '/api/connect').owner, 'account-a');
  assert.equal(env.api.current(), 'account-b');
  assert.equal(env.row('account-a').status.connected, true);
  assert.equal(env.row('account-b').status.connected, false);
  assert.equal(env.api.snapshot().connected, false);
  assert.equal(env.api.connectingAccounts.size, 0);
  assert.deepEqual(env.effects, [], '后台连接完成不重载当前账号详情');
});

await test('连接失败清除进行中状态并允许下一次连接', async () => {
  const env = fixture();
  env.respond = async route => {
    if (route === '/api/connect') throw new Error('模拟连接失败');
    return { accounts: env.serverAccounts };
  };
  await env.node('connect').onclick();
  await settle();
  assert.equal(env.api.connectingAccounts.size, 0);
  assert.equal(env.node('connect').disabled, false);
  assert.match(env.option('account-a').text, /未连接/);
  assert.equal(env.errors.length, 1);
  await env.node('connect').onclick();
  assert.equal(env.calls.filter(call => call.route === '/api/connect').length, 2);
});

await test('断开和暂停在切号后仍更新原账号，不影响新账号状态', async () => {
  for (const action of ['disconnect', 'account-pause']) {
    const env = fixture([
      { id: 'account-a', title: '甲', status: { connected: true } },
      { id: 'account-b', title: '乙', status: { connected: true } },
    ]);
    const gate = deferred();
    env.respond = () => gate.promise;
    const request = env.node(action).onclick();
    env.select('account-b');
    gate.resolve(action === 'disconnect' ? {} : { paused: true, connected: false });
    await request;
    assert.equal(env.calls[0].owner, 'account-a');
    assert.equal(env.row('account-a').status.connected, false);
    assert.equal(env.row('account-b').status.connected, true);
    assert.equal(env.api.snapshot().connected, true);
    assert.equal(env.api.current(), 'account-b');
    assert.deepEqual(env.effects, []);
    assert.match(env.option('account-a').text, action === 'disconnect' ? /未连接/ : /已暂停/);
  }
});

console.log(`账号下拉状态自检通过 ${passed} 项`);
