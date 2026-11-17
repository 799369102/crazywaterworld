import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync(new URL('../src/alipay-login-ui.js', import.meta.url), 'utf8');
const prefix = '/api/accounts/alipay-login';
const fixedNow = 1_794_830_400_000;
const qrImage = 'data:image/png;base64,aGVsbG8=';
let passed = 0;

async function test(name, run) {
  await run();
  passed++;
  console.log('通过：' + name);
}

async function settle() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture() {
  let now = fixedNow;
  let nextTimer = 0;
  const timers = new Map();
  const nodes = new Map();
  const state = { id: 'scan-1', phase: 'waiting', qrImage, expiresAt: fixedNow + 300_000 };
  const env = {
    calls: [], selections: [], accounts: [{ id: 'old-account', title: '已有账号' }],
    disconnected: new Set(), allowed: true, mayChangeCalls: [], loadCalls: [], detailsAtSelection: [],
  };
  function node(id) {
    if (!nodes.has(id)) {
      const attributes = new Map();
      nodes.set(id, {
        hidden: false, disabled: false, textContent: '', className: '', src: '',
        setAttribute(key, value) { attributes.set(key, String(value)); },
        getAttribute(key) { return attributes.get(key); },
        removeAttribute(key) { attributes.delete(key); if (key === 'src') this.src = ''; },
      });
    }
    return nodes.get(id);
  }
  env.respond = async (route) => {
    if (route === prefix + '/start' || route.startsWith(prefix + '/status')) return { ...state };
    if (route === prefix + '/cancel') return { ok: true };
    if (route === prefix + '/save') return { ok: true, account: { id: 'alipay:account', title: '支付宝角色', status: { connected: false } } };
    assert.fail('未预期请求 ' + route);
  };
  env.call = async (route, options) => {
    const payload = options?.body ? JSON.parse(options.body) : null;
    env.calls.push({ route, payload });
    return env.respond(route, payload);
  };
  env.node = node;
  env.now = () => now;
  env.setTimer = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, at: now + delay });
    return id;
  };
  env.clearTimer = id => timers.delete(id);
  env.mayChange = async id => {
    env.mayChangeCalls.push(id);
    return env.onMayChange ? env.onMayChange() : env.allowed;
  };
  env.load = async reload => { env.loadCalls.push(reload); await env.onLoad?.(); };
  new Function('env', `
    'use strict';
    const $ = env.node, call = env.call;
    const Date = { now: env.now };
    const setTimeout = env.setTimer, clearTimeout = env.clearTimer;
    const accounts = env.accounts, disconnected = env.disconnected;
    const configMayChangeAccount = env.mayChange, loadAccounts = env.load;
    const renderAccounts = () => {};
    let accountDetailsOwner = 'old-account';
    function selectLoadedAccount(id) {
      env.detailsAtSelection.push(accountDetailsOwner);
      env.selections.push(id);
    }
    ${script}
  `)(env);
  return {
    env, node, state, timers,
    click(id) { return node(id).onclick(); },
    calls(suffix) { return env.calls.filter(entry => entry.route.startsWith(prefix + suffix)); },
    async captured() {
      Object.assign(state, { phase: 'captured', account: { id: 'alipay:account', title: '支付宝角色' }, expiresAt: now + 600_000 });
      await this.tick(1500);
    },
    async tick(milliseconds) {
      const end = now + milliseconds;
      let executions = 0;
      await settle();
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        assert(++executions < 1000);
        const [id, timer] = next;
        now = timer.at;
        timers.delete(id);
        timer.callback();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}

await test('页面加载不启动浏览器，点击后显示官方二维码', async () => {
  const f = fixture();
  assert.equal(f.env.calls.length, 0);
  assert.equal(f.node('alipay-qr').hidden, true);
  await f.click('alipay-start');
  assert.deepEqual(f.calls('/start')[0].payload, { confirm: true });
  assert.equal(f.node('alipay-qr').src, qrImage);
  assert.equal(f.node('alipay-qr').hidden, false);
  assert.match(f.node('alipay-hint').textContent, /支付宝扫码/);
  assert.equal(f.node('alipay-start').textContent, '刷新二维码');
});

await test('二维码只接受 PNG 数据地址', async () => {
  for (const value of ['https://example.com/qr.png', 'data:image/svg+xml,<svg/>', 'javascript:alert(1)']) {
    const f = fixture();
    f.state.qrImage = value;
    await f.click('alipay-start');
    assert.equal(f.node('alipay-qr').hidden, true);
    assert.equal(f.node('alipay-qr').src, '');
  }
});

await test('生成响应丢失后可重新获取后台等待中的二维码', async () => {
  const f = fixture();
  const respond = f.env.respond;
  let attempts = 0;
  f.env.respond = route => {
    if (route.endsWith('/start') && ++attempts === 1) throw new Error('生成响应丢失');
    return respond(route);
  };
  await f.click('alipay-start');
  assert.match(f.node('alipay-hint').textContent, /生成响应丢失/);
  assert.equal(f.node('alipay-start').disabled, false);
  await f.click('alipay-start');
  assert.equal(f.calls('/start').length, 2);
  assert.equal(f.calls('/cancel').length, 0);
  assert.equal(f.node('alipay-qr').src, qrImage);
  await f.captured();
  await f.click('alipay-save');
  assert.deepEqual(f.calls('/save')[0].payload, { confirm: true, id: 'scan-1' });
  assert.match(f.node('alipay-hint').textContent, /账号已保存并切换/);
});

await test('生成期间重复点击只发送一次请求，失败后可重试', async () => {
  const f = fixture();
  const start = deferred();
  const respond = f.env.respond;
  f.env.respond = route => route.endsWith('/start') ? start.promise : respond(route);
  const pending = f.click('alipay-start');
  await f.click('alipay-start');
  assert.equal(f.calls('/start').length, 1);
  assert.equal(f.node('alipay-start').disabled, true);
  start.reject(new Error('浏览器启动失败'));
  await pending;
  assert.match(f.node('alipay-hint').textContent, /浏览器启动失败/);
  assert.equal(f.node('alipay-start').disabled, false);
  f.env.respond = respond;
  await f.click('alipay-start');
  assert.equal(f.calls('/start').length, 2);
});

await test('轮询展示扫码确认和已捕获，成功后停止网络轮询', async () => {
  const f = fixture();
  await f.click('alipay-start');
  f.state.phase = 'authorizing';
  await f.tick(1500);
  assert.equal(f.node('alipay-qr').hidden, true);
  assert.match(f.node('alipay-hint').textContent, /进入游戏/);
  await f.captured();
  assert.equal(f.node('alipay-save').hidden, false);
  assert.equal(f.node('alipay-save').disabled, false);
  assert.equal(f.node('alipay-result').textContent, '支付宝角色');
  const polls = f.calls('/status').length;
  await f.tick(5000);
  assert.equal(f.calls('/status').length, polls);
});

await test('取消后迟到的轮询结果不能恢复二维码', async () => {
  const f = fixture();
  await f.click('alipay-start');
  const poll = deferred();
  const respond = f.env.respond;
  f.env.respond = route => route.includes('/status') ? poll.promise : respond(route);
  await f.tick(1500);
  await f.click('alipay-cancel');
  poll.resolve({ ...f.state });
  await settle();
  assert.match(f.node('alipay-hint').textContent, /已取消/);
  assert.equal(f.node('alipay-qr').src, '');
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.calls('/cancel')[0].payload, { id: 'scan-1' });
});

await test('刷新先取消旧会话，旧响应不能覆盖新二维码', async () => {
  const f = fixture();
  await f.click('alipay-start');
  const poll = deferred();
  const respond = f.env.respond;
  f.env.respond = route => route.includes('/status') ? poll.promise : respond(route);
  await f.tick(1500);
  Object.assign(f.state, { id: 'scan-2', qrImage: 'data:image/png;base64,bmV3' });
  await f.click('alipay-start');
  assert.deepEqual(f.env.calls.slice(-2).map(call => call.route), [prefix + '/cancel', prefix + '/start']);
  poll.resolve({ id: 'scan-1', phase: 'captured', account: { id: 'wrong' }, expiresAt: fixedNow + 600_000 });
  await settle();
  assert.equal(f.node('alipay-qr').src, f.state.qrImage);
  assert.equal(f.node('alipay-save').hidden, true);
});

await test('取消失败保留重试入口，刷新不能跳过失败的取消', async () => {
  const f = fixture();
  await f.click('alipay-start');
  const respond = f.env.respond;
  f.env.respond = route => {
    if (route.endsWith('/cancel')) throw new Error('请求失败');
    return respond(route);
  };
  await f.click('alipay-cancel');
  assert.equal(f.node('alipay-cancel').hidden, false);
  assert.match(f.node('alipay-hint').textContent, /取消登录失败/);
  await f.click('alipay-start');
  assert.equal(f.calls('/start').length, 1);
  f.env.respond = respond;
  await f.click('alipay-start');
  assert.equal(f.calls('/start').length, 2);
});

await test('轮询临时失败会恢复，连续三次失败停止轮询', async () => {
  const f = fixture();
  await f.click('alipay-start');
  const respond = f.env.respond;
  f.env.respond = route => {
    if (route.includes('/status')) throw new Error('断网');
    return respond(route);
  };
  await f.tick(1500);
  assert.match(f.node('alipay-hint').textContent, /正在重试/);
  f.env.respond = respond;
  await f.tick(1500);
  assert.match(f.node('alipay-hint').textContent, /支付宝扫码/);
  f.env.respond = route => {
    if (route.includes('/status')) throw new Error('断网');
    return respond(route);
  };
  await f.tick(4500);
  assert.match(f.node('alipay-hint').textContent, /连续读取失败/);
  const polls = f.calls('/status').length;
  await f.tick(10_000);
  assert.equal(f.calls('/status').length, polls);
  assert.equal(f.node('alipay-qr').hidden, true);
  assert.equal(f.node('alipay-start').disabled, false);
});

await test('服务端过期和本地凭证过期均禁用保存', async () => {
  const f = fixture();
  await f.click('alipay-start');
  f.state.phase = 'expired';
  await f.tick(1500);
  assert.match(f.node('alipay-hint').textContent, /过期/);
  assert.equal(f.node('alipay-qr').hidden, true);
  f.state.phase = 'waiting';
  await f.click('alipay-start');
  await f.captured();
  await f.tick(600_000);
  assert.equal(f.node('alipay-save').disabled, true);
  await f.click('alipay-save');
  assert.equal(f.calls('/save').length, 0);
});

await test('保存前尊重未保存配置，允许后保存并切换账户', async () => {
  const f = fixture();
  await f.click('alipay-start');
  await f.captured();
  f.env.allowed = false;
  await f.click('alipay-save');
  assert.equal(f.calls('/save').length, 0);
  assert.equal(f.node('alipay-save').disabled, false);
  assert.match(f.node('alipay-hint').textContent, /配置尚未保存/);
  f.env.allowed = true;
  await f.click('alipay-save');
  assert.deepEqual(f.calls('/save')[0].payload, { confirm: true, id: 'scan-1' });
  assert.deepEqual(f.env.selections, ['alipay:account']);
  assert.deepEqual(f.env.detailsAtSelection, [null]);
  assert.ok(f.env.disconnected.has('alipay:account'));
  assert.deepEqual(f.env.loadCalls, [false]);
  assert.equal(f.env.accounts.length, 2);
  assert.equal(f.node('alipay-save').hidden, true);
  assert.match(f.node('alipay-hint').textContent, /账号已保存并切换/);
  assert.equal(f.timers.size, 0);
});

await test('配置确认等待中到期，不发送保存请求', async () => {
  const f = fixture();
  await f.click('alipay-start');
  await f.captured();
  const confirm = deferred();
  f.env.onMayChange = () => confirm.promise;
  const saving = f.click('alipay-save');
  await f.tick(600_000);
  confirm.resolve(true);
  await saving;
  assert.equal(f.calls('/save').length, 0);
  assert.match(f.node('alipay-hint').textContent, /过期/);
});

await test('保存暂停或异地登录阻止的账号后提示恢复托管', async () => {
  for (const status of [{ paused: true, connected: false }, { loginBlocked: true, connected: false }]) {
    const f = fixture();
    await f.click('alipay-start');
    await f.captured();
    const respond = f.env.respond;
    f.env.respond = async route => {
      const data = await respond(route);
      if (route.endsWith('/save')) data.account.status = status;
      return data;
    };
    await f.click('alipay-save');
    assert.match(f.node('alipay-hint').textContent, /账号已保存并切换.*恢复托管/);
    assert.deepEqual(f.env.accounts.find(account => account.id === 'alipay:account').status, status);
    assert.deepEqual(f.env.selections, ['alipay:account']);
  }
});

await test('保存已连接账号后展示连接状态', async () => {
  const f = fixture();
  await f.click('alipay-start');
  await f.captured();
  const respond = f.env.respond;
  f.env.respond = async route => {
    const data = await respond(route);
    if (route.endsWith('/save')) data.account.status = { connected: true };
    return data;
  };
  await f.click('alipay-save');
  assert.match(f.node('alipay-hint').textContent, /游戏已连接/);
  assert.equal(f.env.disconnected.has('alipay:account'), false);
});

await test('保存期间抑制重复请求，失败后可重试', async () => {
  const f = fixture();
  await f.click('alipay-start');
  await f.captured();
  const save = deferred();
  const respond = f.env.respond;
  f.env.respond = route => route.endsWith('/save') ? save.promise : respond(route);
  const pending = f.click('alipay-save');
  await settle();
  await f.click('alipay-save');
  await f.click('alipay-start');
  await f.click('alipay-cancel');
  assert.equal(f.calls('/save').length, 1);
  assert.equal(f.calls('/start').length, 1);
  assert.equal(f.calls('/cancel').length, 0);
  save.reject(new Error('保存失败'));
  await pending;
  assert.equal(f.node('alipay-save').disabled, false);
  f.env.respond = respond;
  await f.click('alipay-save');
  assert.equal(f.calls('/save').length, 2);
});

await test('保存成功后列表刷新失败仍展示已保存结果', async () => {
  const f = fixture();
  await f.click('alipay-start');
  await f.captured();
  f.env.onLoad = async () => { throw new Error('列表断网'); };
  await f.click('alipay-save');
  assert.match(f.node('alipay-hint').textContent, /账号已保存并切换.*列表刷新失败/);
  assert.equal(f.node('alipay-save').hidden, true);
  assert.deepEqual(f.env.selections, ['alipay:account']);
});

await test('页面模板与独立脚本接线完整', async () => {
  const page = fs.readFileSync(new URL('../src/page.mjs', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../src/ui/pages.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes('${alipayLoginScript}'));
  assert.ok(page.includes("new URL('./alipay-login-ui.js', import.meta.url)"));
  for (const id of ['flow', 'start', 'cancel', 'save', 'hint', 'qr', 'result', 'expiry']) {
    assert.ok(template.includes('id="alipay-' + id + '"'), id);
  }
});

console.log(`selftest-alipay-login-ui: ${passed} cases ok`);
