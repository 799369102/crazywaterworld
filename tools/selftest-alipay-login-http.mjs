import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporaryRoot = fs.realpathSync(os.tmpdir());
const directory = fs.mkdtempSync(path.join(temporaryRoot, 'cw-alipay-http-'));
process.env.CW_DATA_DIR = directory;
process.env.CW_CONFIG_PACK = path.join(directory, 'config.json');
process.env.CW_CA_DIR = path.join(directory, 'certificates');
fs.writeFileSync(process.env.CW_CONFIG_PACK, '[]');

const { createConsole } = await import('../src/server.mjs');
const { loadStore, saveStore, upsertAccount } = await import('../src/accounts.mjs');
const { GameClient } = await import('../src/client.mjs');
const originalConnect = GameClient.prototype.connect;
let connections = 0;
GameClient.prototype.connect = async function () {
  connections++;
  throw new Error('扫码 HTTP 自检禁止连接真实游戏');
};

function credential(openId = 'fixture-alipay-open-id', token = 'fixture-alipay-token') {
  return {
    source: 'alipay',
    capturedAt: new Date().toISOString(),
    url: 'wss://fixture.invalid/gateway',
    loginFrameHex: 'aabbccdd',
    login: {
      worldId: 3000000002,
      eworldParams: { openId, token, sign: 'fixture-alipay-sign', timestamp: '1234567890' },
      eworldClientInfo: { appId: 'fixture-alipay-app' },
    },
  };
}

function createController() {
  let current = null;
  const controller = {
    starts: 0,
    cancellations: 0,
    reads: 0,
    closes: 0,
    startError: null,
    cancelError: null,
    async start() {
      controller.starts++;
      if (controller.startError) throw controller.startError;
      current = {
        id: 'fixture-scan-' + controller.starts,
        phase: 'waiting',
        qrImage: 'data:image/png;base64,ZmFrZS1xci1pbWFnZQ==',
        expiresAt: Date.now() + 300_000,
        error: null,
      };
      return controller.status();
    },
    status(id) {
      if (id && current?.id !== id) throw new Error('扫码会话已失效，请重新扫码');
      if (!current) return { id: null, phase: 'idle', qrImage: null, expiresAt: null, error: null };
      if (current.expiresAt <= Date.now()) current.phase = 'expired';
      const { credential: capturedCredential, ...publicState } = current;
      return { ...publicState };
    },
    capture(capturedCredential = credential()) {
      assert.ok(current, '先启动扫码会话');
      current.phase = 'captured';
      current.credential = capturedCredential;
      current.qrImage = null;
    },
    expire() {
      assert.ok(current, '先启动扫码会话');
      current.expiresAt = Date.now() - 1;
    },
    takeCredential(id) {
      controller.reads++;
      const state = controller.status(id);
      if (state.phase !== 'captured') throw new Error('扫码结果尚未就绪或已过期，请重新扫码');
      return structuredClone(current.credential);
    },
    async cancel(id) {
      controller.cancellations++;
      if (controller.cancelError) throw controller.cancelError;
      if (!id || current?.id === id) current = null;
      return controller.status();
    },
    async close() {
      controller.closes++;
      current = null;
    },
  };
  return controller;
}

function holdQueue(session) {
  let release;
  let accepted;
  const entered = new Promise(resolve => { accepted = resolve; });
  let tail = new Promise(resolve => { release = resolve; });
  Object.defineProperty(session, 'queueTail', {
    configurable: true,
    get: () => tail,
    set(value) {
      tail = value;
      if (value) accepted();
    },
  });
  return {
    release,
    async wait(request) {
      let timeout;
      try {
        await Promise.race([
          entered,
          request.then(result => { throw new Error('保存未进入账号队列，HTTP ' + result.status); }),
          new Promise((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('等待账号保存队列超时')), 5000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    },
    restore() {
      Object.defineProperty(session, 'queueTail', { configurable: true, writable: true, value: null });
    },
  };
}

const controller = createController();
const app = createConsole({
  port: 0,
  protocol: {},
  alipayLoginController: controller,
  captureController: { inspectCaptureRecovery: () => ({ pending: false }) },
});
let closed = false;
try {
  const root = await app.listen();
  async function request(route, body) {
    const response = await fetch(root + '/api/accounts/alipay-login' + route, {
      method: body === undefined ? 'GET' : 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, data: await response.json() };
  }
  const start = () => request('/start', { confirm: true });
  const status = id => request('/status?id=' + encodeURIComponent(id));
  const save = id => request('/save', { confirm: true, id });

  assert.equal((await request('/status')).data.phase, 'idle');
  assert.equal(controller.starts, 0, '查询状态不启动浏览器');
  assert.equal((await request('/start', {})).status, 400);
  assert.equal(controller.starts, 0, '启动沿用写接口确认约定');
  controller.startError = new Error('模拟浏览器启动失败');
  const failedStart = await start();
  assert.equal(failedStart.status, 400);
  assert.match(failedStart.data.error, /模拟浏览器启动失败/);
  controller.startError = null;

  const waiting = await start();
  assert.equal(waiting.status, 200);
  assert.ok(waiting.data.id);
  assert.equal(waiting.data.phase, 'waiting');
  assert.match(waiting.data.qrImage, /^data:image\/png;base64,/);
  assert.equal((await save(waiting.data.id)).status, 400, '扫码完成前不能保存');
  assert.equal(loadStore().accounts.length, 0);
  assert.equal((await request('/cancel', { id: waiting.data.id })).status, 200);
  assert.equal((await save(waiting.data.id)).status, 400, '已取消的扫码结果不能保存');

  // 同名微信身份保留，支付宝凭证使用独立账号 ID。
  const legacyCredential = { ...credential(), source: 'mitm' };
  const initialStore = loadStore();
  upsertAccount(initialStore, legacyCredential, { label: '原微信账号' });
  saveStore(initialStore);
  const captured = await start();
  controller.capture();
  const preview = await status(captured.data.id);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.phase, 'captured');
  assert.equal(preview.data.account.id, 'alipay:fixture-alipay-open-id');
  assert.equal(typeof preview.data.account.title, 'string');
  assert.equal(loadStore().accounts.length, 1, '扫码完成只预览，保存按钮才落库');
  const publicPreview = JSON.stringify(preview.data);
  assert.equal(publicPreview.includes('fixture-alipay-token'), false);
  assert.equal(publicPreview.includes('fixture-alipay-sign'), false);
  assert.equal(publicPreview.includes('eworldParams'), false);
  assert.equal((await request('/save', { id: captured.data.id })).status, 400);
  const saved = await save(captured.data.id);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.account.id, 'alipay:fixture-alipay-open-id');
  assert.equal(saved.data.account.source, 'alipay');
  assert.equal(saved.data.account.active, true);
  const accountId = saved.data.account.id;
  let store = loadStore();
  assert.equal(store.accounts.length, 2);
  assert.equal(store.activeId, accountId);
  assert.equal(store.accounts.find(account => account.id === 'fixture-alipay-open-id').label, '原微信账号');
  assert.equal(store.accounts.find(account => account.id === accountId).login.eworldParams.token, 'fixture-alipay-token');
  assert.equal(connections, 0, '保存账号不自动连接或启动挂机');
  assert.equal((await save(captured.data.id)).status, 400, '已保存的会话已消费');

  // 更新已在线的支付宝账号时，停止旧连接与任务并标记生产同步。
  const session = app.sessions.get(accountId);
  assert.ok(session, '保存后建立账号会话');
  let clientStops = 0;
  let worldStops = 0;
  const activeClient = { connected: true, stop() { this.connected = false; clientStops++; } };
  session.client = activeClient;
  session.worldClient = { connected: true, stop() { this.connected = false; worldStops++; } };
  session.player = { playerId: 123, nickname: '旧角色', worldId: 3000000002 };
  session.loop.running = true;
  session.loop.controller = new AbortController();
  const previousGeneration = session.generation;
  store.accounts.find(account => account.id === accountId).label = '我的支付宝账号';
  saveStore(store);
  const refreshed = await start();
  controller.capture(credential(undefined, 'fixture-refreshed-token'));
  const updated = await save(refreshed.data.id);
  assert.equal(updated.status, 200);
  assert.equal(clientStops, 1);
  assert.equal(worldStops, 1);
  assert.equal(session.loop.controller.signal.aborted, true);
  assert.ok(session.generation > previousGeneration);
  assert.equal(session.productionSyncRequired, true);
  store = loadStore();
  const updatedAccount = store.accounts.find(account => account.id === accountId);
  assert.equal(updatedAccount.label, '我的支付宝账号');
  assert.equal(updatedAccount.login.eworldParams.token, 'fixture-refreshed-token');
  assert.equal(updatedAccount.automation.enabled, false);
  assert.equal(updatedAccount.automation.productionSyncRequired, true);
  assert.equal(connections, 0);

  // 暂停托管期间也能更新凭证，保存继续保留暂停状态。
  session.paused = true;
  updatedAccount.automation.paused = true;
  saveStore(store);
  const pausedPreview = await start();
  controller.capture(credential(undefined, 'fixture-paused-token'));
  const pausedSave = await save(pausedPreview.data.id);
  assert.equal(pausedSave.status, 200);
  assert.equal(session.paused, true);
  store = loadStore();
  const pausedAccount = store.accounts.find(account => account.id === accountId);
  assert.equal(pausedAccount.login.eworldParams.token, 'fixture-paused-token');
  assert.equal(pausedAccount.automation.paused, true);
  assert.equal(connections, 0);
  session.paused = false;
  pausedAccount.automation.paused = false;
  saveStore(store);

  const expired = await start();
  controller.capture(credential('expired-account'));
  controller.expire();
  assert.equal((await status(expired.data.id)).data.phase, 'expired');
  assert.equal((await save(expired.data.id)).status, 400);
  assert.equal(loadStore().accounts.length, 2, '过期扫码结果不落库');

  // 排队期间重复保存被拒绝，取消后继续排队的请求复查会话。
  const queued = await start();
  controller.capture(credential(undefined, 'cancelled-token'));
  const queue = holdQueue(session);
  let queuedSave;
  try {
    queuedSave = save(queued.data.id);
    await queue.wait(queuedSave);
    assert.equal((await save(queued.data.id)).status, 400, '同时保存同一会话只接受一次');
    assert.equal((await request('/cancel', { id: queued.data.id })).status, 200);
    queue.release();
    assert.equal((await queuedSave).status, 400);
    assert.equal(loadStore().accounts.find(account => account.id === accountId).login.eworldParams.token, 'fixture-paused-token');
  } finally {
    queue.release();
    await queuedSave?.catch(() => {});
    queue.restore();
  }

  const expiresInQueue = await start();
  controller.capture(credential(undefined, 'expired-queued-token'));
  const expiryQueue = holdQueue(session);
  let expiringSave;
  try {
    expiringSave = save(expiresInQueue.data.id);
    await expiryQueue.wait(expiringSave);
    controller.expire();
    expiryQueue.release();
    assert.equal((await expiringSave).status, 400);
    assert.equal(loadStore().accounts.find(account => account.id === accountId).login.eworldParams.token, 'fixture-paused-token');
  } finally {
    expiryQueue.release();
    await expiringSave?.catch(() => {});
    expiryQueue.restore();
  }

  // 凭证已保存时，浏览器清理失败仍返回已完成的保存结果。
  const cleanupFailure = await start();
  controller.capture(credential('cleanup-account', 'fixture-cleanup-token'));
  controller.cancelError = new Error('模拟浏览器关闭失败');
  const savedWithCleanupFailure = await save(cleanupFailure.data.id);
  assert.equal(savedWithCleanupFailure.status, 200);
  assert.equal(savedWithCleanupFailure.data.account.id, 'alipay:cleanup-account');
  assert.ok(loadStore().accounts.some(account => account.id === 'alipay:cleanup-account'));
  assert.equal(connections, 0);
  controller.cancelError = null;

  await app.close();
  closed = true;
  assert.equal(controller.closes, 1, '控制台关闭时释放扫码浏览器');
  console.log('selftest-alipay-login-http: ok');
} finally {
  GameClient.prototype.connect = originalConnect;
  if (!closed) await app.close();
  assert.equal(path.dirname(directory), temporaryRoot);
  fs.rmSync(directory, { recursive: true, force: true });
}
