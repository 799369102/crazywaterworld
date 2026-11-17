import assert from 'node:assert/strict';
import { PAGE } from '../src/page.mjs';

const script = [...PAGE.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(value => value.includes('async function toggleLoopAutoStart('));
assert.ok(script);
function section(start, end) {
  const from = script.indexOf(start), to = script.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return script.slice(from, to);
}
const source = [
  section('function setTaskSwitch(', 'const pirateAdvanceErrors'),
  section('function renderLoop(', 'async function toggleAutoTask('),
  section('async function toggleLoopAutoStart(', "$('loop-start').onclick"),
].join('\n');
const settle = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fixture() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      const attributes = new Map(), thumb = { dataset: {} };
      nodes.set(id, {
        value: '', textContent: '', disabled: false, dataset: {},
        classList: { contains: () => false },
        setAttribute: (name, value) => attributes.set(name, String(value)),
        getAttribute: name => attributes.get(name),
        querySelector: () => thumb,
      });
    }
    return nodes.get(id);
  };
  const view = autoStart => ({ autoStart, running: false, rounds: 0, everyMs: 60000, completed: 0, controls: [] });
  const env = { node, calls: [], errors: [], states: { a: view(false), b: view(false) }, flushes: 0 };
  env.flush = async () => { env.flushes++; return env.onFlush ? env.onFlush() : true; };
  env.call = async (account, route, options) => {
    const payload = options?.body ? JSON.parse(options.body) : null;
    env.calls.push({ account, route, payload });
    if (!payload) {
      await env.onGet?.(account);
      return structuredClone(env.states[account]);
    }
    assert.equal(route, '/api/loop/auto-start');
    await env.onPost?.(account, payload);
    env.states[account].autoStart = payload.autoStart;
    if (payload.autoStart) env.states[account].running = true;
    return structuredClone(env.states[account]);
  };
  const api = new Function('env', `
    let current = 'a', loopAccount = null, loopVersion = 0, loopFieldDefaults = null, loopSettingsRevision = null;
    let overviewLoopOwner = null, overviewLoopData = null, overviewRenderKey = '';
    const savingTasks = new Set(), loopAutoStartSaves = new Map(), taskInputs = [], pirateFailureOptions = new Map();
    const $ = env.node, document = { hidden: false }, configFlush = env.flush;
    const call = (route, options) => env.call(current, route, options);
    const reportError = error => env.errors.push(error);
    const renderAutomationOverview = data => { overviewLoopOwner = current; overviewLoopData = data; };
    const renderPirateAdvance = () => {}, filterIdleControls = () => {}, clear = () => {};
    ${source}
    return {
      load: refreshLoop, render: renderLoop, toggle: toggleLoopAutoStart,
      change(account) { current = account; return refreshLoop(); },
      pending: () => loopAutoStartSaves.size,
    };
  `)(env);
  return { ...api, env, node, checked: () => node('loop-auto-start').getAttribute('aria-checked') === 'true',
    posts: () => env.calls.filter(row => row.payload) };
}

let passed = 0;
async function test(name, run) { await run(); passed++; console.log('通过：' + name); }

await test('挂机页显示按账号保存的自动开始开关和默认持续运行说明', () => {
  assert.equal([...PAGE.matchAll(/id="loop-auto-start"/g)].length, 1);
  assert.match(PAGE, /aria-describedby="loop-auto-start-help"/);
  assert.match(PAGE, /新账号默认持续挂机，开关按账号保存/);
  assert.match(PAGE, /暂停挂机会记住关闭状态/);
});

await test('挂机说明卡片及旧节点绑定已移除，挂机与挑战操作仍可使用', () => {
  for (const removed of ['idle-notes', 'idle-more', 'challenge-run-state', 'single-task-status',
    'single-go-pirate', 'single-go-stages', 'single-go-mutual', 'idle-go-settings', 'idle-go-overview', 'runtime-version']) {
    assert.equal(PAGE.includes(removed), false, removed + ' 应从页面和脚本中移除');
  }
  for (const id of ['loop-auto-start', 'loop-start', 'loop-stop', 'stage-start', 'trial-refresh', 'pirate-advance-start']) {
    assert.equal([...PAGE.matchAll(new RegExp('id="' + id + '"', 'g'))].length, 1, id);
  }
});

await test('读取保持保存值，开关先保存草稿再提交并渲染后台运行状态', async () => {
  const f = fixture();
  await f.load();
  assert.equal(f.checked(), false);
  assert.equal(f.posts().length, 0);
  await f.toggle(); await settle();
  assert.equal(f.env.flushes, 1);
  assert.deepEqual(f.posts()[0], { account: 'a', route: '/api/loop/auto-start', payload: { confirm: true, autoStart: true } });
  assert.equal(f.checked(), true);
  assert.equal(f.node('loop-start').disabled, true);
  assert.equal(f.node('loop-stop').disabled, false);
  await f.toggle(); await settle();
  assert.equal(f.checked(), false);
  assert.equal(f.env.states.a.running, true);
  assert.equal(f.node('loop-stop').disabled, false);
});

await test('保存中的重复点击和旧轮询不能覆盖待保存的开关', async () => {
  const f = fixture(), gate = deferred();
  await f.load();
  f.env.onPost = () => gate.promise;
  const saving = f.toggle(); await settle();
  await f.toggle();
  f.render(structuredClone(f.env.states.a));
  assert.equal(f.posts().length, 1);
  assert.equal(f.checked(), true);
  assert.equal(f.node('loop-auto-start').disabled, true);
  assert.equal(f.node('loop-start').disabled, true);
  gate.resolve(); await saving; await settle();
  assert.equal(f.pending(), 0);
  assert.equal(f.node('loop-auto-start').disabled, false);
});

await test('草稿保存期间切换账号会取消尚未提交的自动开始请求', async () => {
  const f = fixture(), gate = deferred();
  await f.load();
  f.env.onFlush = () => gate.promise;
  const saving = f.toggle();
  await f.change('b');
  gate.resolve(true); await saving;
  assert.equal(f.posts().length, 0);
  assert.equal(f.checked(), false);
  assert.equal(f.pending(), 0);
});

await test('旧账号的成功或失败响应均不会改写当前账号的开关', async () => {
  for (const fails of [false, true]) {
    const f = fixture(), gate = deferred();
    await f.load();
    f.env.onPost = () => gate.promise;
    const saving = f.toggle(); await settle();
    await f.change('b');
    if (fails) gate.reject(new Error('旧账号保存失败'));
    else gate.resolve();
    await saving; await settle();
    assert.equal(f.checked(), false);
    assert.equal(f.node('loop-auto-start').disabled, false);
    assert.equal(f.env.states.b.autoStart, false);
    assert.equal(f.env.errors.length, 0);
    assert.equal(f.pending(), 0);
  }
});

await test('保存失败且回读失败时恢复可操作状态并显示原开关值', async () => {
  const f = fixture();
  await f.load();
  f.env.onPost = async () => { throw new Error('保存失败'); };
  f.env.onGet = async () => { throw new Error('回读失败'); };
  await f.toggle(); await settle();
  assert.equal(f.checked(), false);
  assert.equal(f.node('loop-auto-start').disabled, false);
  assert.equal(f.node('loop-start').disabled, false);
  assert.equal(f.env.errors[0]?.message, '保存失败');
  assert.equal(f.pending(), 0);
});

console.log('自动开始挂机 UI 专项 ' + passed + '/' + passed + ' 通过');
