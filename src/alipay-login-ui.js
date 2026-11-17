// 支付宝网页扫码登录，二维码和待保存凭证由本机服务维护。
let alipayState = null;
let alipayBusy = false;
let alipayGeneration = 0;
let alipayTimer = null;
let alipayPollFailures = 0;
const alipayLoginPath = '/api/accounts/alipay-login';

function renderAlipayLogin() {
  const state = alipayState || { phase: 'idle' };
  const captured = state.phase === 'captured';
  const messages = {
    idle: '点击「生成二维码」，然后使用支付宝扫一扫。',
    starting: '正在打开支付宝登录页面并读取二维码…',
    waiting: '请使用支付宝扫码，并在手机上确认登录。',
    authorizing: '扫码已确认，正在进入游戏并读取登录信息…',
    captured: '已读取游戏登录信息，请保存账号。',
    expired: '本次登录已过期，请刷新二维码重新扫码。',
    error: '登录失败，请刷新二维码重试。',
    cancelled: '已取消本次登录。',
    saved: '账号已保存并切换。点击页面顶部的「连接」进入游戏。',
  };
  if (state.account?.status?.paused || state.account?.status?.loginBlocked) {
    messages.saved = '账号已保存并切换。点击页面顶部的「恢复托管」，连接后核对角色和区服。';
  } else if (state.account?.status?.connected) {
    messages.saved = '账号已保存并切换，游戏已连接。可在上方查看角色概况，随后前往「挂机」设置任务。';
  }
  const hint = $('alipay-hint');
  hint.textContent = state.error || messages[state.phase] || '正在读取登录状态…';
  hint.className = 'phone-feedback ' + (state.error || ['expired', 'error'].includes(state.phase) ? 'bad' : 'dim');
  const image = $('alipay-qr');
  const showQr = state.phase === 'waiting' && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(state.qrImage || '');
  image.hidden = !showQr;
  if (showQr) image.src = state.qrImage;
  else image.removeAttribute('src');
  $('alipay-start').textContent = state.id || ['expired', 'error'].includes(state.phase) ? '刷新二维码' : '生成二维码';
  $('alipay-start').disabled = alipayBusy;
  $('alipay-cancel').hidden = !state.id || ['cancelled', 'saved'].includes(state.phase);
  $('alipay-cancel').disabled = alipayBusy;
  $('alipay-save').hidden = !captured;
  $('alipay-save').disabled = alipayBusy || !captured || !state.account?.id || state.expiresAt <= Date.now();
  $('alipay-result').hidden = !captured && state.phase !== 'saved';
  $('alipay-result').textContent = state.account?.title || '';
  $('alipay-expiry').textContent = captured ? '请在本次登录结果过期前保存。' : '';
  $('alipay-flow').setAttribute('aria-busy', String(alipayBusy || state.phase === 'starting' || state.phase === 'authorizing'));
}

function scheduleAlipayPoll(generation) {
  clearTimeout(alipayTimer);
  if (generation !== alipayGeneration || !alipayState?.id) return;
  if (alipayState.phase === 'captured') {
    alipayTimer = setTimeout(() => {
      if (generation !== alipayGeneration || alipayState?.phase !== 'captured') return;
      alipayState = { ...alipayState, phase: 'expired', qrImage: null, error: null };
      renderAlipayLogin();
    }, Math.max(0, alipayState.expiresAt - Date.now()));
  } else if (['starting', 'waiting', 'authorizing'].includes(alipayState.phase)) {
    alipayTimer = setTimeout(() => pollAlipayLogin(generation), 1500);
  }
}

async function pollAlipayLogin(generation) {
  if (generation !== alipayGeneration || !alipayState?.id) return;
  const id = alipayState.id;
  try {
    const state = await call(alipayLoginPath + '/status?id=' + encodeURIComponent(id));
    if (generation !== alipayGeneration || alipayState?.id !== id) return;
    alipayPollFailures = 0;
    alipayState = state;
  } catch (error) {
    if (generation !== alipayGeneration || alipayState?.id !== id) return;
    alipayPollFailures++;
    alipayState = { ...alipayState, error: alipayPollFailures < 3
      ? '登录状态读取失败，正在重试…'
      : '登录状态连续读取失败，请刷新二维码重试。' };
    if (alipayPollFailures >= 3) alipayState.phase = 'error';
  }
  renderAlipayLogin();
  scheduleAlipayPoll(generation);
}

$('alipay-start').onclick = async () => {
  if (alipayBusy) return;
  const previous = alipayState;
  const generation = ++alipayGeneration;
  clearTimeout(alipayTimer);
  alipayBusy = true;
  alipayPollFailures = 0;
  alipayState = { phase: 'starting' };
  renderAlipayLogin();
  try {
    if (previous?.id) {
      await call(alipayLoginPath + '/cancel', { method: 'POST', body: JSON.stringify({ id: previous.id }) });
    }
    const state = await call(alipayLoginPath + '/start', { method: 'POST', body: JSON.stringify({ confirm: true }) });
    if (generation !== alipayGeneration) return;
    alipayState = state;
    scheduleAlipayPoll(generation);
  } catch (error) {
    if (generation !== alipayGeneration) return;
    alipayState = { id: previous?.id, phase: 'error', error: error.message || '二维码读取失败，请重试。' };
  } finally {
    if (generation === alipayGeneration) {
      alipayBusy = false;
      renderAlipayLogin();
    }
  }
};

$('alipay-cancel').onclick = async () => {
  if (alipayBusy || !alipayState?.id) return;
  const previous = alipayState;
  const generation = ++alipayGeneration;
  clearTimeout(alipayTimer);
  alipayBusy = true;
  alipayState = { ...previous, phase: 'cancelled', qrImage: null, error: null };
  renderAlipayLogin();
  try {
    await call(alipayLoginPath + '/cancel', { method: 'POST', body: JSON.stringify({ id: previous.id }) });
    if (generation === alipayGeneration) alipayState = { phase: 'cancelled' };
  } catch (error) {
    if (generation === alipayGeneration) {
      alipayState = { id: previous.id, phase: 'error', error: '取消登录失败，请重试取消。' };
    }
  } finally {
    if (generation === alipayGeneration) {
      alipayBusy = false;
      renderAlipayLogin();
    }
  }
};

$('alipay-save').onclick = async () => {
  if (alipayBusy || alipayState?.phase !== 'captured' || !alipayState.account?.id) return;
  if (alipayState.expiresAt <= Date.now()) {
    alipayState = { ...alipayState, phase: 'expired', error: null };
    renderAlipayLogin();
    return;
  }
  const pending = alipayState;
  alipayBusy = true;
  renderAlipayLogin();
  $('alipay-save').textContent = '正在保存…';
  try {
    if (!await configMayChangeAccount(pending.account.id)) {
      alipayState = { ...pending, error: '当前账号的配置尚未保存，请处理配置后再次保存此账号。' };
      return;
    }
    if (pending.expiresAt <= Date.now()) {
      alipayState = { ...pending, phase: 'expired', error: null };
      return;
    }
    const data = await call(alipayLoginPath + '/save', { method: 'POST', body: JSON.stringify({ confirm: true, id: pending.id }) });
    ++alipayGeneration;
    clearTimeout(alipayTimer);
    alipayState = { phase: 'saved', account: data.account };
    const index = accounts.findIndex(account => account.id === data.account.id);
    if (index < 0) accounts.push(data.account);
    else accounts[index] = { ...accounts[index], ...data.account };
    if (!data.account.status?.connected) disconnected.add(data.account.id);
    accountDetailsOwner = null;
    selectLoadedAccount(data.account.id);
    renderAccounts();
    try {
      await loadAccounts(false);
    } catch {
      alipayState.error = '账号已保存并切换，账号列表刷新失败，请刷新页面查看。';
    }
  } catch (error) {
    alipayState = { ...pending, error: error.message || '保存失败，请重试。' };
  } finally {
    alipayBusy = false;
    $('alipay-save').textContent = '保存并切换账号';
    renderAlipayLogin();
  }
};

renderAlipayLogin();
