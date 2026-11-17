import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../src/ui/activities.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

function fixture() {
  const nodes = new Map();
  const state = { calls: [], errors: [], confirmations: [], flushes: 0, respond: null, now: Date.now(), timers: new Map() };
  class Element {
    constructor(tagName = 'div', className = '', text = '') {
      this.tagName = tagName.toUpperCase();
      this.className = className ?? '';
      this.text = String(text ?? '');
      this.children = [];
      this.parentElement = null;
      this.dataset = {};
      this.attributes = new Map();
      this.hidden = false;
      this.disabled = false;
      this.classList = {
        contains: name => this.className.split(' ').includes(name),
        toggle: (name, force) => {
          const enabled = force ?? !this.classList.contains(name);
          const names = new Set(this.className.split(' ').filter(Boolean));
          if (enabled) names.add(name); else names.delete(name);
          this.className = [...names].join(' ');
          return enabled;
        },
      };
    }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) {
      this.text = String(value ?? '');
      for (const child of this.children) child.parentElement = null;
      this.children = [];
    }
    get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    append(...children) { for (const child of children) this.appendChild(child); }
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    matches(selector) {
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      const attribute = selector.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
      if (attribute) {
        const name = attribute[1];
        const value = name.startsWith('data-')
          ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]
          : this.getAttribute(name);
        return attribute[2] === undefined ? value != null : String(value) === attribute[2];
      }
      return this.tagName === selector.toUpperCase();
    }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    focus() { state.focused = this; }
    scrollIntoView() {}
  }
  const element = (tag, className, text) => new Element(tag, className, text);
  const node = id => {
    if (!nodes.has(id)) {
      const item = element('div');
      item.id = id;
      nodes.set(id, item);
    }
    return nodes.get(id);
  };
  const settings = (values = {}, revision = 1) => ({
    settings: { autoSubmit: false, allowDiamonds: false, autoFinal: true, ...values },
    revision, baseRevision: 'base-' + revision,
  });
  const saved = new Map([['merchant-a', settings()], ['merchant-b', settings({ autoFinal: false }, 3)]]);
  const heroSettings = (values = {}, revision = 1) => ({
    settings: { enabled: false, challenge: false, retryTimes: 10, orders: false, lottery: false, rewards: true, ...values },
    revision, baseRevision: 'base-' + revision,
  });
  const heroSaved = new Map([['merchant-a', heroSettings()], ['merchant-b', heroSettings({ rewards: false }, 3)]]);
  const now = Math.floor(state.now / 1000);
  const catalog = { activities: [], eventTasks: [], status: {}, serverNow: now, catalogOnly: true };
  const activities = {
    serverNow: now, vipLevel: 0, activities: [{ id: 'weekly:5:1001:1', name: '不差钱商人',
      kind: 'weekly', weekType: 5, startTime: now - 100, endTime: now + 3600, taskKeys: ['weekOrderSubmit', 'weekOrderFinal'] }],
    eventTasks: [{ key: 'weekOrderSubmit', label: '不差钱商人自动完成订单', enabled: false },
      { key: 'weekOrderFinal', label: '不差钱商人最终奖励', enabled: true }],
    status: {}, order: { orderKey: 'order-key', ready: true, materials: [
      { id: '木板', name: '木板', required: 3, owned: 3, missing: 0, price: 10 },
    ] },
  };
  const context = {
    current: 'merchant-a', snapshot: { paused: false, connected: true }, disconnected: new Set(), savingTasks: new Set(),
    loopSettingsRevision: 1,
    $: node, el: element,
    clear: item => { item.textContent = ''; return item; },
    component: name => element(name === 'ui-number' ? 'input' : 'button'),
    smallButton: text => element('button', '', text),
    setTaskSwitch: (input, enabled) => input.setAttribute('aria-checked', enabled),
    table: (headers, rows) => {
      const table = element('table'); table.headers = headers; table.rows = rows; return table;
    },
    document: {
      querySelectorAll(selector) {
        return [...nodes.values()].flatMap(item => item.querySelectorAll(selector));
      },
    },
    Date: class extends Date { static now() { return state.now; } },
    setInterval() {}, clearTimeout(id) { state.timers.delete(id); },
    setTimeout(work, delay) { const id = state.timers.size + 1; state.timers.set(id, { work, delay }); return id; },
    refreshProgression() {}, refreshLoop() {},
    async configFlush() { state.flushes++; return true; },
    async configLoad() {},
    reportError: (error, label) => state.errors.push({ message: error.message, label }),
    openConfirm: (title, details, accept) => state.confirmations.push({ title, details, accept }),
    async toggleAutoTask() { throw Error('商人设置不应调用通用活动开关'); },
    async call(route, options = {}) {
      const url = new URL(route, 'http://fixture.invalid');
      const account = url.searchParams.get('account') ?? context.current;
      const request = { route: url.pathname, account, method: options.method ?? 'GET',
        body: options.body ? JSON.parse(options.body) : undefined };
      state.calls.push(request);
      if (state.respond) {
        const result = await state.respond(request);
        if (result !== undefined) return clone(result);
      }
      if (request.route === '/api/week-order/settings') {
        if (request.method === 'POST') {
          const previous = saved.get(account), payload = request.body;
          assert.equal(payload.revision, previous.revision);
          assert.equal(payload.baseRevision, previous.baseRevision);
          assert.equal(payload.confirm, true);
          const next = clone(previous);
          next.settings[payload.key] = payload.enabled;
          next.revision++;
          next.baseRevision = 'base-' + next.revision;
          saved.set(account, next);
        }
        return clone(saved.get(account));
      }
      if (request.route === '/api/hero-raid/settings') {
        if (request.method === 'POST') {
          const previous = heroSaved.get(account), payload = request.body;
          assert.equal(payload.revision, previous.revision);
          assert.equal(payload.baseRevision, previous.baseRevision);
          assert.equal(payload.confirm, true);
          assert(payload.key.startsWith('heroRaid.'));
          const next = clone(previous);
          next.settings[payload.key.slice('heroRaid.'.length)] = payload.value;
          next.revision++;
          next.baseRevision = 'base-' + next.revision;
          heroSaved.set(account, next);
        }
        return clone(heroSaved.get(account));
      }
      if (request.route === '/api/activities') return clone(activities);
      if (request.route === '/api/activities/catalog') return clone(catalog);
      throw Error('未声明前端测试请求 ' + request.route);
    },
  };
  vm.createContext(context);
  const api = vm.runInContext(script + `\n({
    refresh: refreshActivities, readSettings: refreshMerchantSettings, save: saveMerchantSetting,
    render: renderActivityTabs, rows: activityRows, select: selectActivity, lifecycle: activityLifecycle,
    get settings() { return merchantSettingsData; },
    get owner() { return merchantSettingsOwner; },
    selectMerchant() { selectedActivity = activityRows().find(row => row.weekType === 5)?.id; renderActivityTabs(); },
    get heroSettings() { return heroRaidSettingsData; },
    get heroOwner() { return heroRaidSettingsOwner; },
    selectHero() { selectActivity(activityRows().find(isHeroRaidActivity)?.id); },
    readHeroSettings: refreshHeroRaidSettings, saveHero: saveHeroRaidSetting,
  })`, context);
  const controls = () => node('activities-list').querySelectorAll('[data-merchant-setting]');
  const heroControls = () => node('activities-list').querySelectorAll('[data-hero-raid-setting]');
  return { api, context, state, node, saved, settings, activities, catalog, controls, heroSaved, heroSettings, heroControls,
    input: key => controls().find(input => input.dataset.merchantSetting === key),
    heroInput: key => heroControls().find(input => input.dataset.heroRaidSetting === key),
    async clickHero(key) { const input = this.heroInput(key); assert(input && !input.disabled, key + ' 开关应可编辑'); await input.onclick(); },
    async setHeroRetries(value) { const input = this.heroInput('retryTimes'); input.value = value; await input.onchange(); },
    async click(key) { const input = this.input(key); assert(input && !input.disabled, key + ' 开关应可编辑'); await input.onclick(); },
  };
}

let passed = 0;
async function test(name, work) {
  await work(); passed++; console.log('通过：' + name);
}

await test('活动详情仅呈现一套商人设置，回读原账号保存值', async () => {
  const f = fixture();
  await f.api.refresh(); f.api.selectMerchant();
  assert.deepEqual(f.controls().map(input => input.dataset.merchantSetting), ['autoSubmit', 'allowDiamonds', 'autoFinal']);
  assert.equal(f.input('autoSubmit').getAttribute('aria-checked'), 'false');
  assert.equal(f.input('allowDiamonds').getAttribute('aria-checked'), 'false');
  assert.equal(f.input('allowDiamonds').disabled, true);
  assert.equal(f.input('autoFinal').getAttribute('aria-checked'), 'true');
  assert.equal(f.node('activities-list').querySelectorAll('[data-auto-task]').length, 0);
  assert(!f.node('activities-list').textContent.includes('游戏配置'));
});

await test('三个开关直接保存单字段并回读，关闭自动完成仍保留补料选择', async () => {
  const f = fixture();
  await f.api.refresh(); f.api.selectMerchant();
  await f.click('autoSubmit');
  assert.equal(f.input('autoSubmit').getAttribute('aria-checked'), 'true');
  assert.equal(f.input('allowDiamonds').disabled, false);
  await f.click('allowDiamonds');
  await f.click('autoFinal');
  assert.deepEqual(f.saved.get('merchant-a').settings, { autoSubmit: true, allowDiamonds: true, autoFinal: false });
  await f.click('autoSubmit');
  assert.equal(f.input('autoSubmit').getAttribute('aria-checked'), 'false');
  assert.equal(f.input('allowDiamonds').getAttribute('aria-checked'), 'true');
  assert.equal(f.input('allowDiamonds').disabled, true);
  assert.deepEqual(f.state.calls.filter(call => call.method === 'POST').map(call => call.body.key),
    ['autoSubmit', 'allowDiamonds', 'autoFinal', 'autoSubmit']);
  assert.equal(f.state.flushes, 4);
  assert.equal(f.state.errors.length, 0);
});

await test('暂停、断开及首次未连接时可配置商人，游戏读取和消费入口保持关闭', async () => {
  for (const state of ['paused', 'disconnected', 'notConnected']) {
    const f = fixture();
    if (state === 'paused') f.context.snapshot.paused = true;
    else if (state === 'disconnected') f.context.disconnected.add('merchant-a');
    else f.context.snapshot.connected = false;
    await f.api.refresh(); f.api.selectMerchant();
    const merchant = f.api.rows().find(row => row.weekType === 5);
    assert.equal(merchant.settingsOnly, true);
    assert.equal(f.controls().length, 3);
    assert(!f.state.calls.some(call => call.route === '/api/activities'));
    assert.equal(f.node('activities-list').querySelectorAll('[data-activity-run]').length, 0);
    assert.equal(f.node('activities-order').querySelectorAll('button').length, 0);
    await f.click('autoSubmit');
    assert.equal(f.saved.get('merchant-a').settings.autoSubmit, true);
    assert(f.state.calls.every(call => ['/api/week-order/settings', '/api/hero-raid/settings', '/api/activities/catalog'].includes(call.route)));
  }
});

await test('读取商人配置期间暂停或断开后，不继续读取游戏活动', async () => {
  for (const change of [
    f => { f.context.snapshot.paused = true; },
    f => { f.context.disconnected.add('merchant-a'); },
    f => { f.context.snapshot.connected = false; },
  ]) {
    const f = fixture();
    f.state.respond = request => {
      if (request.route === '/api/week-order/settings') change(f);
    };
    await f.api.refresh(); f.api.selectMerchant();
    assert(!f.state.calls.some(call => call.route === '/api/activities'));
    assert.equal(f.controls().length, 3);
    assert.equal(f.api.rows().find(row => row.weekType === 5).settingsOnly, true);
  }
});

await test('活动未开放时仍有唯一配置入口，开放后使用当前活动实例', async () => {
  const f = fixture();
  const active = clone(f.activities.activities);
  f.activities.activities = [];
  await f.api.refresh(); f.api.selectMerchant();
  let merchants = f.api.rows().filter(row => row.weekType === 5);
  assert.equal(merchants.length, 1);
  assert.equal(merchants[0].settingsOnly, true);
  await f.click('autoSubmit');
  f.activities.activities = active;
  await f.api.refresh(); f.api.selectMerchant();
  merchants = f.api.rows().filter(row => row.weekType === 5);
  assert.equal(merchants.length, 1);
  assert.equal(merchants[0].id, active[0].id);
  assert(!merchants[0].settingsOnly);
  assert.equal(f.input('autoSubmit').getAttribute('aria-checked'), 'true');
});

await test('保存前刷新版本，仅修改所点开关并保留其他页面的最新值', async () => {
  const f = fixture();
  await f.api.refresh(); f.api.selectMerchant();
  f.saved.set('merchant-a', f.settings({ autoSubmit: true, allowDiamonds: true, autoFinal: true }, 8));
  await f.click('autoFinal');
  const write = f.state.calls.find(call => call.method === 'POST');
  assert.equal(write.body.revision, 8);
  assert.deepEqual(f.saved.get('merchant-a').settings, { autoSubmit: true, allowDiamonds: true, autoFinal: false });
  assert.deepEqual(clone(f.api.settings.settings), f.saved.get('merchant-a').settings);
});

await test('保存失败后回读服务器值，开关恢复并能继续编辑', async () => {
  const f = fixture();
  await f.api.refresh(); f.api.selectMerchant();
  f.state.respond = request => {
    if (request.method === 'POST') throw Error('配置保存失败');
  };
  await f.click('autoSubmit');
  assert.equal(f.input('autoSubmit').getAttribute('aria-checked'), 'false');
  assert.equal(f.input('autoSubmit').disabled, false);
  assert.equal(f.saved.get('merchant-a').settings.autoSubmit, false);
  assert(f.state.errors.some(error => /配置保存失败/.test(error.message)));
  f.state.respond = null;
  await f.click('autoSubmit');
  assert.equal(f.input('autoSubmit').getAttribute('aria-checked'), 'true');
});

await test('已保存后的旧读取回包不会覆盖新开关或版本', async () => {
  const f = fixture();
  await f.api.refresh(); f.api.selectMerchant();
  const readEntered = deferred(), oldRead = deferred();
  let delayed = false;
  f.state.respond = request => {
    if (!delayed && request.route === '/api/week-order/settings' && request.method === 'GET') {
      delayed = true; readEntered.resolve(); return oldRead.promise;
    }
  };
  const pendingRead = f.api.readSettings('merchant-a');
  await readEntered.promise;
  const previous = clone(f.saved.get('merchant-a'));
  await f.click('autoSubmit');
  assert.equal(f.api.settings.settings.autoSubmit, true);
  const revision = f.api.settings.revision;
  oldRead.resolve(previous); await pendingRead;
  assert.equal(f.api.settings.settings.autoSubmit, true);
  assert.equal(f.api.settings.revision, revision);
});

await test('账号切换期间迟到的保存回复不能修改新账号面板', async () => {
  const f = fixture();
  await f.api.refresh(); f.api.selectMerchant();
  const writeEntered = deferred(), releaseWrite = deferred();
  f.state.respond = request => {
    if (request.method === 'POST' && request.account === 'merchant-a') {
      writeEntered.resolve();
      return releaseWrite.promise;
    }
  };
  const pendingSave = f.click('autoSubmit');
  await writeEntered.promise;
  f.context.current = 'merchant-b';
  await f.api.refresh(); f.api.selectMerchant();
  assert.equal(f.api.owner, 'merchant-b');
  assert.equal(f.input('autoFinal').getAttribute('aria-checked'), 'false');
  releaseWrite.resolve(f.settings({ autoSubmit: true }, 2));
  await pendingSave;
  assert.equal(f.api.owner, 'merchant-b');
  assert.deepEqual(clone(f.api.settings), f.saved.get('merchant-b'));
  assert.equal(f.input('autoSubmit').getAttribute('aria-checked'), 'false');
  assert.equal(f.input('autoFinal').getAttribute('aria-checked'), 'false');
});

await test('游戏配置草稿保存失败时停止本次开关请求并恢复可编辑状态', async () => {
  const f = fixture();
  await f.api.refresh(); f.api.selectMerchant();
  f.context.configFlush = async () => false;
  await f.click('autoSubmit');
  assert(!f.state.calls.some(call => call.method === 'POST'));
  assert.equal(f.input('autoSubmit').getAttribute('aria-checked'), 'false');
  assert.equal(f.input('autoSubmit').disabled, false);
});

await test('保存期间整组禁用，活动刷新和重复点击不会并发写入', async () => {
  const f = fixture();
  await f.api.refresh(); f.api.selectMerchant();
  const entered = deferred(), release = deferred();
  f.state.respond = request => {
    if (request.method === 'POST') { entered.resolve(); return release.promise; }
  };
  const pending = f.click('autoSubmit');
  await entered.promise;
  assert(f.controls().every(input => input.disabled));
  await f.api.refresh(); f.api.selectMerchant();
  assert(f.controls().every(input => input.disabled));
  await f.api.save('autoFinal', false);
  assert.equal(f.state.calls.filter(call => call.method === 'POST').length, 1);
  const saved = f.settings({ autoSubmit: true }, 2);
  f.saved.set('merchant-a', saved); release.resolve(saved);
  await pending;
  assert.equal(f.input('autoSubmit').getAttribute('aria-checked'), 'true');
  assert(f.controls().every(input => !input.disabled));
});

await test('保存回复丢失时用回读值确认已保存状态，不误恢复旧开关', async () => {
  const f = fixture();
  await f.api.refresh(); f.api.selectMerchant();
  f.state.respond = request => {
    if (request.method === 'POST') {
      f.saved.set('merchant-a', f.settings({ autoSubmit: true }, 2));
      throw Error('保存回复暂时不可读');
    }
  };
  await f.click('autoSubmit');
  assert.equal(f.input('autoSubmit').getAttribute('aria-checked'), 'true');
  assert.equal(f.api.settings.revision, 2);
  assert.equal(f.input('autoSubmit').disabled, false);
});

await test('待开放与已结束活动默认收起，展开后显示完整起止时间', async () => {
  const f = fixture(), now = f.activities.serverNow;
  f.activities.activities.push(
    { id: 'future', name: '未来活动', kind: 'limited', startTime: now + 60, endTime: now + 120, taskKeys: [] },
    { id: 'past', name: '酆都诡事', kind: 'limited', startTime: now - 120, endTime: now - 60, taskKeys: [] },
  );
  await f.api.refresh();
  const tabs = f.node('activity-tabs');
  for (const state of ['upcoming', 'ended']) {
    assert.equal(tabs.querySelector('[data-activity-group=' + state + ']').getAttribute('aria-expanded'), 'false');
    assert.equal(tabs.querySelector('#activity-group-' + state).hidden, true);
  }
  tabs.querySelector('[data-activity-group=ended]').onclick();
  tabs.querySelector('[data-activity=past]').onclick();
  assert.equal(f.node('activity-title').textContent, '酆都诡事');
  assert.match(f.node('activity-end').textContent, /开始 .* · 结束 .*北京时间/);
  assert.match(f.node('activities-list').textContent, /本期活动已结束/);
  tabs.querySelector('[data-activity-group=ended]').onclick();
  assert.equal(tabs.querySelector('#activity-group-ended').hidden, true);
  assert.notEqual(tabs.querySelector('[aria-selected=true]').dataset.activity, 'past');
});

await test('未来及结束期次保留自动偏好，单次执行按钮禁用', async () => {
  const f = fixture(), now = f.activities.serverNow;
  f.activities.eventTasks.push({ key: 'edict', label: '酆都法旨', enabled: true });
  for (const [id, startTime, endTime] of [['future', now + 30, now + 90], ['past', now - 90, now - 30]]) {
    f.activities.activities.push({ id, name: '酆都法旨', kind: 'limited', startTime, endTime, taskKeys: ['edict'] });
  }
  await f.api.refresh();
  for (const id of ['future', 'past']) {
    f.api.select(id);
    const button = f.node('activities-list').querySelector('[data-activity-run=edict]');
    assert.equal(button.disabled, true);
    assert.equal(f.node('activities-list').querySelector('[data-auto-task=edict]').getAttribute('aria-checked'), 'true');
    await button.onclick();
  }
  assert(!f.state.calls.some(call => call.route === '/api/activities/run'));
});

await test('开放与结束边界自动重新分组，开始边界也安排刷新', async () => {
  const f = fixture(), now = f.activities.serverNow;
  f.activities.activities.push({ id: 'timed', name: '定时活动', kind: 'limited', startTime: now + 30,
    endTime: now + 60, taskKeys: [] });
  await f.api.refresh();
  assert.equal(f.api.lifecycle(f.api.rows().find(row => row.id === 'timed')), 'upcoming');
  assert([...f.state.timers.values()].some(timer => timer.delay > 0 && timer.delay <= 30000));
  f.state.now += 30000;
  f.api.render();
  assert.equal(f.api.lifecycle(f.api.rows().find(row => row.id === 'timed')), 'active');
  f.api.select('timed');
  f.state.now += 30000;
  f.api.render();
  assert.equal(f.api.lifecycle(f.api.rows().find(row => row.id === 'timed')), 'ended');
  assert.equal(f.node('activity-tabs').querySelector('#activity-group-ended').hidden, true);
  assert.notEqual(f.node('activity-tabs').querySelector('[aria-selected=true]').dataset.activity, 'timed');
});

await test('离线读取账号活动留档，过期条目收起且不调用游戏接口', async () => {
  const f = fixture(), now = f.activities.serverNow;
  f.context.snapshot.connected = false;
  f.catalog.activities = [{ id: 'archive:merchant', name: '不差钱商人', kind: 'weekly', weekType: 5,
    startTime: now - 100, endTime: now - 1, observed: false, taskKeys: ['weekOrderSubmit', 'weekOrderFinal'] }];
  await f.api.refresh();
  assert.equal(f.node('activity-tabs').querySelector('#activity-group-ended').hidden, true);
  f.api.select('archive:merchant');
  assert.equal(f.controls().length, 3);
  await f.click('autoSubmit');
  assert.equal(f.saved.get('merchant-a').settings.autoSubmit, true);
  assert(!f.state.calls.some(call => call.route === '/api/activities'));
  assert.equal(f.node('activities-order').querySelectorAll('button').length, 0);
});

await test('旧目录缺少本期实时确认时展示待同步并禁用单次执行', async () => {
  const f = fixture(), now = f.activities.serverNow;
  f.activities.activities.push({ id: 'unconfirmed', name: '酆都法旨', kind: 'limited', observed: false,
    startTime: now - 100, endTime: now + 100, taskKeys: ['edict'] });
  f.activities.eventTasks.push({ key: 'edict', label: '酆都法旨', enabled: true });
  await f.api.refresh();
  assert.equal(f.node('activity-tabs').querySelector('#activity-group-unknown').hidden, true);
  f.api.select('unconfirmed');
  assert.match(f.node('activities-list').textContent, /活动开放状态待同步/);
  assert.equal(f.node('activities-list').querySelector('[data-activity-run=edict]').disabled, true);
});

await test('键盘导航跳过收起条目，账号间独立保存展开状态', async () => {
  const f = fixture(), now = f.activities.serverNow;
  f.activities.activities.push({ id: 'future', name: '未来活动', kind: 'limited', startTime: now + 30, endTime: now + 60, taskKeys: [] });
  await f.api.refresh();
  const tabs = f.node('activity-tabs');
  tabs.querySelector('[aria-selected=true]').onkeydown({ key: 'End', preventDefault() {} });
  assert.notEqual(tabs.querySelector('[aria-selected=true]').dataset.activity, 'future');
  tabs.querySelector('[data-activity-group=upcoming]').onclick();
  f.context.current = 'merchant-b';
  await f.api.refresh();
  assert.equal(tabs.querySelector('#activity-group-upcoming').hidden, true);
  f.context.current = 'merchant-a';
  await f.api.refresh();
  assert.equal(tabs.querySelector('#activity-group-upcoming').hidden, false);
});

await test('超凡英雄提供截图五项设置及达标奖励，默认重试十次且保存单字段', async () => {
  const f = fixture();
  await f.api.refresh(); f.api.selectHero();
  assert.deepEqual(f.heroControls().map(input => input.dataset.heroRaidSetting),
    ['enabled', 'challenge', 'retryTimes', 'orders', 'lottery', 'rewards']);
  assert.equal(f.heroInput('retryTimes').valueAsNumber, 10);
  assert.equal(f.heroInput('retryTimes').min, 0);
  assert.equal(f.heroInput('retryTimes').max, 100);
  assert.equal(f.heroInput('lottery').getAttribute('aria-checked'), 'false');
  assert.match(f.node('activities-list').textContent, /英雄副本抽卡券/);
  await f.clickHero('challenge');
  await f.clickHero('orders');
  await f.clickHero('lottery');
  await f.setHeroRetries(0);
  await f.clickHero('enabled');
  await f.clickHero('enabled');
  assert.deepEqual(f.heroSaved.get('merchant-a').settings,
    { enabled: false, challenge: true, retryTimes: 0, orders: true, lottery: true, rewards: true });
  assert(f.state.calls.filter(call => call.method === 'POST').every(call => call.route === '/api/hero-raid/settings'));
  assert.equal(f.state.flushes, 6);
  assert.equal(f.state.errors.length, 0);
});

await test('超凡英雄未连接、暂停及未开放时均可预先配置，已有真实期次替换占位入口', async () => {
  for (const state of ['connected', 'paused', 'notConnected']) {
    const f = fixture();
    if (state === 'paused') f.context.snapshot.paused = true;
    if (state === 'notConnected') f.context.snapshot.connected = false;
    await f.api.refresh(); f.api.selectHero();
    assert.equal(f.heroControls().length, 6);
    assert(f.heroControls().every(input => !input.disabled));
    await f.clickHero('orders');
    assert.equal(f.heroSaved.get('merchant-a').settings.orders, true);
    assert(!f.state.calls.some(call => call.route === '/api/activities/run'));
  }
  const f = fixture(), now = f.activities.serverNow;
  f.activities.activities.push({ id: 'hero-raid:1001', name: '超凡英雄活动', kind: 'limited',
    startTime: now - 100, endTime: now + 100, taskKeys: [] });
  await f.api.refresh(); f.api.selectHero();
  assert.equal(f.api.rows().filter(row => row.id.startsWith('hero-raid')).length, 1);
  assert.equal(f.heroControls().length, 6);
  assert(!f.node('activities-list').textContent.includes('暂未接入'));
});

await test('历史超凡英雄期次从sourceId识别，离线展开后仍可编辑', async () => {
  const f = fixture(), now = f.activities.serverNow;
  f.context.snapshot.connected = false;
  f.catalog.activities.push({ id: 'archive:hero-1001', sourceId: 'hero-raid:1001', name: '超凡英雄活动', kind: 'limited',
    startTime: now - 100, endTime: now - 1, observed: false, taskKeys: [] });
  await f.api.refresh(); f.api.selectHero();
  assert.equal(f.heroControls().length, 6);
  assert(!f.api.rows().some(row => row.id === 'hero-raid'));
  await f.clickHero('rewards');
  assert.equal(f.heroSaved.get('merchant-a').settings.rewards, false);
  assert(!f.state.calls.some(call => call.route === '/api/activities'));
});

await test('重试次数拒绝空值、小数与越界值，失败后保留已保存值', async () => {
  const f = fixture();
  await f.api.refresh(); f.api.selectHero();
  for (const value of ['', -1, 1.5, 101, 'abc']) {
    await f.setHeroRetries(value);
    assert.equal(f.heroInput('retryTimes').valueAsNumber, 10);
  }
  assert.equal(f.state.calls.filter(call => call.method === 'POST').length, 0);
  assert.equal(f.state.errors.length, 5);
  await f.setHeroRetries(100);
  assert.equal(f.heroSaved.get('merchant-a').settings.retryTimes, 100);
});

await test('超凡英雄保存失败回读原值，刷新版本后继续保存并保留其他项', async () => {
  const f = fixture();
  await f.api.refresh(); f.api.selectHero();
  f.state.respond = request => { if (request.method === 'POST') throw Error('配置版本已变化'); };
  await f.clickHero('enabled');
  assert.equal(f.heroInput('enabled').getAttribute('aria-checked'), 'false');
  assert(f.heroControls().every(input => !input.disabled));
  f.state.respond = null;
  f.heroSaved.set('merchant-a', f.heroSettings({ lottery: true, retryTimes: 23 }, 9));
  await f.clickHero('enabled');
  assert.deepEqual(f.heroSaved.get('merchant-a').settings,
    { enabled: true, challenge: false, retryTimes: 23, orders: false, lottery: true, rewards: true });
  assert.equal(f.state.calls.filter(call => call.method === 'POST').at(-1).body.revision, 9);
});

await test('超凡英雄保存期间锁定控件，重复保存被合并且迟到回包不影响新账号', async () => {
  const f = fixture();
  await f.api.refresh(); f.api.selectHero();
  const entered = deferred(), release = deferred();
  f.state.respond = request => {
    if (request.route === '/api/hero-raid/settings' && request.method === 'POST') {
      entered.resolve(); return release.promise;
    }
  };
  const pending = f.clickHero('enabled');
  await entered.promise;
  assert(f.heroControls().every(input => input.disabled));
  await f.api.saveHero('orders', true);
  assert.equal(f.state.calls.filter(call => call.method === 'POST').length, 1);
  f.context.current = 'merchant-b';
  await f.api.refresh(); f.api.selectHero();
  release.resolve(f.heroSettings({ enabled: true }, 2));
  await pending;
  assert.equal(f.api.heroOwner, 'merchant-b');
  assert.deepEqual(clone(f.api.heroSettings), f.heroSaved.get('merchant-b'));
  assert.equal(f.heroInput('enabled').getAttribute('aria-checked'), 'false');
  assert.equal(f.heroInput('rewards').getAttribute('aria-checked'), 'false');
});

await test('超凡英雄旧读取与配置草稿失败均不能覆盖新值', async () => {
  const f = fixture();
  await f.api.refresh(); f.api.selectHero();
  const entered = deferred(), release = deferred();
  let delayed = false;
  f.state.respond = request => {
    if (!delayed && request.route === '/api/hero-raid/settings' && request.method === 'GET') {
      delayed = true; entered.resolve(); return release.promise;
    }
  };
  const reading = f.api.readHeroSettings('merchant-a');
  await entered.promise;
  const previous = clone(f.heroSaved.get('merchant-a'));
  await f.clickHero('enabled');
  release.resolve(previous); await reading;
  assert.equal(f.api.heroSettings.settings.enabled, true);
  f.context.configFlush = async () => false;
  await f.clickHero('orders');
  assert.equal(f.heroInput('orders').getAttribute('aria-checked'), 'false');
  assert.equal(f.state.calls.filter(call => call.method === 'POST').length, 1);
});

console.log('活动分组、商人与超凡英雄配置专项 ' + passed + '/' + passed + ' 通过');
