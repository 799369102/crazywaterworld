export const GUILD_ROLE_PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>联盟职位管理</title>
  <script>if(new URLSearchParams(location.search).get('embedded')==='1')document.documentElement.classList.add('embedded')</script>
  <style>
    :root{--ink:#172026;--muted:#66747d;--line:#d8e0e4;--paper:#fff;--wash:#f4f7f6;--green:#13795b;--green-2:#e5f3ed;--amber:#9a6700;--red:#bd2c2c;--red-2:#fff0f0;--blue:#1769aa;--radius:6px}
    *{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;letter-spacing:0}button,input,select{font:inherit;letter-spacing:0}button,select,input{min-height:38px;border:1px solid #bcc8ce;border-radius:var(--radius);background:#fff;color:var(--ink)}button{padding:0 14px;cursor:pointer;font-weight:650}button:hover{border-color:#7d919b}button:disabled{cursor:not-allowed;opacity:.5}.primary{background:var(--green);border-color:var(--green);color:#fff}.danger{border-color:#e0a3a3;background:var(--red-2);color:var(--red)}.icon{width:38px;padding:0;font-size:20px}.shell{max-width:1180px;margin:auto;background:var(--paper);min-height:100vh;border-inline:1px solid var(--line)}header{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.96);border-bottom:1px solid var(--line);padding:12px 20px;display:flex;align-items:center;gap:14px}.title{min-width:190px}.title h1{font-size:18px;margin:0}.title a{font-size:12px;color:var(--blue);text-decoration:none}.account{margin-left:auto;display:flex;gap:8px;align-items:center}.account select{max-width:260px;padding:0 34px 0 10px}.status-strip{padding:10px 20px;display:flex;gap:18px;flex-wrap:wrap;background:#eef3f1;border-bottom:1px solid var(--line)}.metric{display:flex;gap:6px;align-items:baseline}.metric b{font-size:15px}.dot{width:8px;height:8px;border-radius:50%;background:#8b969c}.dot.on{background:var(--green)}main section{padding:22px 20px;border-bottom:1px solid var(--line)}.section-head{display:flex;align-items:center;gap:12px;margin-bottom:16px}.section-head h2{font-size:16px;margin:0}.section-head .actions{margin-left:auto;display:flex;gap:8px}.settings{display:grid;grid-template-columns:minmax(170px,1.2fr) repeat(4,minmax(110px,.7fr));gap:12px;align-items:end}.field{display:grid;gap:5px}.field label{font-size:12px;color:var(--muted);font-weight:650}.field input,.field select{width:100%;padding:0 10px}.switch-row{height:38px;display:flex;align-items:center;gap:9px}.switch-row input{width:18px;height:18px;min-height:auto;accent-color:var(--green)}.permission-grid{display:grid;grid-template-columns:repeat(3,minmax(190px,1fr)) minmax(210px,.8fr);gap:14px;align-items:start}.picker{position:relative}.picker summary{list-style:none;min-height:64px;border:1px solid #bcc8ce;border-radius:var(--radius);padding:9px 34px 9px 11px;cursor:pointer;display:grid;gap:3px;position:relative}.picker summary::-webkit-details-marker{display:none}.picker summary::after{content:"⌄";position:absolute;right:12px;top:20px;color:var(--muted)}.picker summary span{font-size:12px;color:var(--muted)}.picker summary strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.picker[open] summary{border-color:var(--green)}.picker-menu{position:absolute;z-index:15;top:calc(100% + 6px);left:0;right:0;border:1px solid var(--line);border-radius:var(--radius);background:#fff;box-shadow:0 12px 32px #17202622;padding:9px}.picker-toolbar{display:flex;gap:7px;margin-bottom:7px}.picker-toolbar input{width:100%;padding:0 9px}.picker-toolbar button{flex:none}.picker-options{max-height:260px;overflow:auto}.picker-option{display:grid;grid-template-columns:20px minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 5px;border-bottom:1px solid #edf0f2;cursor:pointer}.picker-option:last-child{border-bottom:0}.picker-option input{width:16px;height:16px;min-height:auto;accent-color:var(--green)}.picker-option small{color:var(--muted)}.transfer-config{display:grid;gap:10px}.transfer-config select{width:100%;padding:0 10px}.transfer-config .switch-row{height:auto;min-height:38px}.member-count{color:var(--muted);font-size:12px}.queue{display:grid;gap:8px}.queue-row{display:grid;grid-template-columns:100px minmax(130px,1fr) 160px 160px;gap:10px;padding:10px 0;border-bottom:1px solid #e8edef}.queue-row:last-child{border-bottom:0}.tag{display:inline-flex;width:max-content;padding:2px 7px;border-radius:4px;background:var(--green-2);color:var(--green);font-weight:700}.empty{padding:20px 0;color:var(--muted)}.notice{display:none;margin:0 20px;padding:10px 12px;border:1px solid #e8c96f;background:#fff9df;color:#765500;border-radius:var(--radius)}.notice.error{display:block;border-color:#e2aaaa;background:var(--red-2);color:var(--red)}.notice.ok{display:block;border-color:#a6d7c4;background:var(--green-2);color:#0c6348}.footer-actions{display:flex;gap:10px;flex-wrap:wrap}.footer-actions .danger{margin-left:auto}dialog{border:1px solid var(--line);border-radius:8px;padding:0;box-shadow:0 18px 70px #17202633;width:min(460px,calc(100vw - 28px))}dialog::backdrop{background:#17202666}.dialog-body{padding:20px}.dialog-body h2{font-size:17px;margin:0 0 8px}.dialog-body p{color:var(--muted)}.dialog-body input{padding:0 10px;width:100%}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--line);background:#f7f9f9}.embedded body{background:#fff}.embedded .shell{max-width:none;border:0;min-height:0}.embedded header{display:none}.embedded .notice{margin-inline:0}@media(max-width:980px){.permission-grid{grid-template-columns:1fr 1fr}}@media(max-width:780px){.shell{border:0}header{padding:10px 12px;flex-wrap:wrap}.title{min-width:0}.account{width:100%;margin:0}.account select{flex:1;max-width:none}.status-strip,main section{padding-inline:12px}.settings{grid-template-columns:1fr 1fr}.settings .wide{grid-column:1/-1}.permission-grid{grid-template-columns:1fr}.picker-menu{position:static;margin-top:6px}.queue-row{grid-template-columns:86px 1fr}.queue-row time{font-size:12px}.footer-actions .danger{margin-left:0}.section-head{align-items:flex-start}.section-head .actions{flex-wrap:wrap;justify-content:flex-end}}
  </style>
</head>
<body>
<div class="shell">
  <header>
    <div class="title"><h1>联盟职位管理</h1><a href="/">返回控制台</a></div>
    <div class="account"><label for="account">托管账号</label><select id="account"></select><button class="icon" id="refresh" title="刷新" aria-label="刷新">↻</button></div>
  </header>
  <div class="status-strip">
    <span class="metric"><i class="dot" id="botDot"></i><span>机器人</span><b id="botState">--</b></span>
    <span class="metric"><span>指令时段</span><b id="windowState">--</b></span>
    <span class="metric"><span>排队</span><b id="queueCount">0</b></span>
    <span class="metric"><span>临时副盟</span><b id="leaseCount">0</b></span>
    <span class="metric"><span>永久副盟</span><b id="permanentViceCount">0</b></span>
    <span class="metric"><span>原始快照</span><b id="baselineState">无</b></span>
  </div>
  <p class="notice" id="notice"></p>
  <main>
    <section>
      <div class="section-head"><h2>运行配置</h2><div class="actions"><button class="primary" id="save">保存配置</button></div></div>
      <div class="settings">
        <div class="field wide"><label>运行方式</label><div class="switch-row"><input id="enabled" type="checkbox" disabled><span id="enabledLabel">等待检测盟主身份</span></div></div>
        <div class="field"><label for="start">指令开始</label><input id="start" type="time" step="60"></div>
        <div class="field"><label for="end">指令结束</label><input id="end" type="time" step="60"></div>
        <div class="field"><label for="lease">副盟持续（秒）</label><input id="lease" type="number" min="10" max="600" step="1"></div>
        <div class="field"><label for="restore">统一恢复</label><input id="restore" type="time" step="60"></div>
      </div>
    </section>
    <section>
      <div class="section-head"><h2>成员权限</h2><div class="actions"><span class="member-count" id="memberCount">--</span><button id="refreshMembers" type="button">刷新成员职务</button></div></div>
      <div class="permission-grid">
        <details class="picker" id="allowedPicker"><summary><span>允许发指令</span><strong id="allowedSummary">未选择</strong></summary><div class="picker-menu"><div class="picker-toolbar"><input id="allowedSearch" type="search" placeholder="搜索成员"><button id="allowedClear" type="button">清空</button></div><div class="picker-options" id="allowedOptions"></div></div></details>
        <details class="picker" id="protectedPicker"><summary><span>精英优先</span><strong id="protectedSummary">未选择</strong></summary><div class="picker-menu"><div class="picker-toolbar"><input id="protectedSearch" type="search" placeholder="搜索成员"><button id="protectedClear" type="button">清空</button></div><div class="picker-options" id="protectedOptions"></div></div></details>
        <details class="picker" id="permanentVicePicker"><summary><span>永久副盟（最多 2 人）</span><strong id="permanentViceSummary">未选择</strong></summary><div class="picker-menu"><div class="picker-toolbar"><input id="permanentViceSearch" type="search" placeholder="搜索成员"><button id="permanentViceClear" type="button">清空</button></div><div class="picker-options" id="permanentViceOptions"></div></div></details>
        <div class="transfer-config"><div class="field"><label for="transferTarget">盟主转让目标</label><select id="transferTarget"><option value="">不设置</option></select></div><label class="switch-row"><input id="transferAfterRestore" type="checkbox"><span>统一恢复后自动转让</span></label></div>
      </div>
    </section>
    <section>
      <div class="section-head"><h2>实时队列</h2><div class="actions"><button id="refreshStatus">刷新状态</button></div></div>
      <div class="queue" id="queue"><div class="empty">当前没有排队指令</div></div>
    </section>
    <section>
      <div class="section-head"><h2>联盟操作</h2></div>
      <div class="footer-actions"><button id="restoreNow">立即恢复全部职位</button><button class="danger" id="transfer">转让盟主</button></div>
    </section>
  </main>
</div>
<dialog id="transferDialog">
  <div class="dialog-body"><h2>确认转让盟主</h2><p id="transferText"></p><input id="confirmName" autocomplete="off" placeholder="输入目标成员昵称"></div>
  <div class="dialog-actions"><button id="cancelTransfer">取消</button><button class="danger" id="confirmTransfer">确认转让</button></div>
</dialog>
<script>
(() => {
  const $ = id => document.getElementById(id);
  const state = { account: '', revision: 0, settings: null, members: [], status: null, canManage: false };
  let permissionSaveTimer = null;
  let permissionSaveTail = Promise.resolve();
  let permissionEditVersion = 0;
  let permissionDirty = false;
  const roles = { 2: 'R2 普通', 3: 'R3 精英', 4: 'R4 副盟主', 5: 'R5 盟主' };
  const query = () => '?account=' + encodeURIComponent(state.account);
  const permissionDraftKey = account => 'crazywaterworld:guild-role-permissions:' + account;
  function writePermissionDraft() {
    try { localStorage.setItem(permissionDraftKey(state.account), JSON.stringify({
      revision: state.revision,
      allowedMemberIds: state.settings.allowedMemberIds,
      protectedMemberIds: state.settings.protectedMemberIds,
      permanentViceMemberIds: state.settings.permanentViceMemberIds,
    })); } catch {}
  }
  function restorePermissionDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(permissionDraftKey(state.account)) || 'null');
      if (!draft || draft.revision !== state.revision || !Array.isArray(draft.allowedMemberIds) || !Array.isArray(draft.protectedMemberIds)) return false;
      state.settings.allowedMemberIds = draft.allowedMemberIds.map(String);
      state.settings.protectedMemberIds = draft.protectedMemberIds.map(String);
      if (Array.isArray(draft.permanentViceMemberIds)) state.settings.permanentViceMemberIds = draft.permanentViceMemberIds.map(String);
      permissionEditVersion += 1; permissionDirty = true;
      return true;
    } catch { return false; }
  }
  function clearPermissionDraft(account = state.account) {
    try { localStorage.removeItem(permissionDraftKey(account)); } catch {}
  }
  async function api(path, options) {
    const response = await fetch(path + (path.includes('?') ? '&' : '?') + 'account=' + encodeURIComponent(state.account), {
      headers: { 'content-type': 'application/json' }, ...options,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || '请求失败');
    return value;
  }
  function notify(message, type = 'ok') { const el = $('notice'); el.textContent = message; el.className = 'notice ' + type; clearTimeout(notify.timer); notify.timer = setTimeout(() => { el.className = 'notice'; }, 5000); }
  function busy(button, promise) { button.disabled = true; return promise.finally(() => { button.disabled = false; }); }
  function settingsPayload(fromForm = true) {
    if (!fromForm) return {
      ...state.settings,
      enabled: true,
      allowedMemberIds: [...state.settings.allowedMemberIds],
      protectedMemberIds: [...state.settings.protectedMemberIds],
      permanentViceMemberIds: [...state.settings.permanentViceMemberIds],
    };
    return {
      enabled: true, commandStart: $('start').value, commandEnd: $('end').value, leaseSeconds: Number($('lease').value), restoreAt: $('restore').value,
      allowedMemberIds: [...state.settings.allowedMemberIds], protectedMemberIds: [...state.settings.protectedMemberIds], permanentViceMemberIds: [...state.settings.permanentViceMemberIds],
      transferTargetId: $('transferTarget').value || null, transferAfterRestore: $('transferAfterRestore').checked,
    };
  }
  function saveSettings({ fromForm = true, message = '联盟职位配置已保存' } = {}) {
    clearTimeout(permissionSaveTimer); permissionSaveTimer = null;
    const account = state.account;
    const version = permissionEditVersion;
    const settings = settingsPayload(fromForm);
    permissionSaveTail = permissionSaveTail.catch(() => {}).then(async () => {
      if (state.account !== account) return null;
      const data = await api('/api/guild-role/config', { method: 'POST', keepalive: true, body: JSON.stringify({ confirm: true, revision: state.revision, settings }) });
      if (state.account !== account) return data;
      state.revision = data.revision; state.status = data.status; renderStatus();
      if (permissionEditVersion === version) {
        state.settings = data.settings; permissionDirty = false; clearPermissionDraft(account); fillSettings(); renderMembers();
      }
      notify(message);
      return data;
    });
    return permissionSaveTail;
  }
  function schedulePermissionSave() {
    permissionEditVersion += 1; permissionDirty = true; writePermissionDraft();
    clearTimeout(permissionSaveTimer);
    permissionSaveTimer = setTimeout(() => {
      permissionSaveTimer = null;
      saveSettings({ fromForm: false, message: '成员权限已自动保存' }).catch(error => notify(error.message, 'error'));
    }, 600);
  }
  function fillSettings() {
    const s = state.settings; if (!s) return;
    $('enabled').checked = s.enabled; $('enabledLabel').textContent = state.canManage ? '随托管自动运行' : '等待成为盟主';
    $('start').value = s.commandStart; $('end').value = s.commandEnd; $('lease').value = s.leaseSeconds; $('restore').value = s.restoreAt;
    $('transferAfterRestore').checked = s.transferAfterRestore;
  }
  function renderStatus() {
    const s = state.status || {}; $('botState').textContent = s.active ? '运行中' : s.enabled ? '等待托管/盟主' : '未启动'; $('botDot').classList.toggle('on', !!s.active);
    $('windowState').textContent = s.commandWindow || '--'; $('queueCount').textContent = (s.queue || []).length; $('leaseCount').textContent = (s.leases || []).length;
    $('permanentViceCount').textContent = s.permanentViceMemberCount || 0;
    $('baselineState').textContent = s.baseline ? s.baseline.day + ' · ' + s.baseline.memberCount + ' 人' : '无';
    const host = $('queue'); host.replaceChildren();
    if (!(s.queue || []).length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '当前没有排队指令'; host.append(empty); return; }
    for (const row of s.queue) {
      const line = document.createElement('div'); line.className = 'queue-row';
      const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = row.command === 'promote' ? '上副盟' : '下副盟';
      const who = document.createElement('strong'); who.textContent = row.nickname;
      const game = document.createElement('time'); game.textContent = '游戏 ' + new Date(row.gameTimestamp * 1000).toLocaleTimeString('zh-CN', { hour12: false });
      const local = document.createElement('time'); local.textContent = '本地 ' + new Date(row.localReceivedAt).toLocaleTimeString('zh-CN', { hour12: false });
      line.append(tag, who, game, local); host.append(line);
    }
  }
  function pickerSummary(field, target) {
    const ids = new Set(state.settings?.[field] || []);
    const names = state.members.filter(member => ids.has(member.id)).map(member => member.name);
    $(target).textContent = names.length ? names.join('、') : '未选择';
    $(target).title = names.join('、');
  }
  function renderPicker(field, hostId, searchId, summaryId, eligible, maxSelections = Infinity) {
    const selected = new Set(state.settings?.[field] || []), text = $(searchId).value.trim().toLowerCase();
    const host = $(hostId); host.replaceChildren();
    const rows = state.members.filter(member => eligible(member) && (!text || member.name.toLowerCase().includes(text) || member.id.includes(text)));
    if (!rows.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '没有匹配成员'; host.append(empty); }
    for (const member of rows) {
      const label = document.createElement('label'); label.className = 'picker-option';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(member.id);
      const name = document.createElement('strong'); name.textContent = member.name;
      const meta = document.createElement('small'); meta.textContent = (roles[member.title] || ('R' + member.title)) + (member.online ? ' · 在线' : '');
      input.addEventListener('change', () => {
        const ids = new Set(state.settings[field]);
        if (input.checked && ids.size >= maxSelections) { input.checked = false; notify('永久副盟最多选择 2 人', 'error'); return; }
        input.checked ? ids.add(member.id) : ids.delete(member.id); state.settings[field] = [...ids]; pickerSummary(field, summaryId); schedulePermissionSave();
      });
      label.append(input, name, meta); host.append(label);
    }
    pickerSummary(field, summaryId);
  }
  function renderTransferTargets() {
    const select = $('transferTarget'), selected = state.settings?.transferTargetId || '';
    select.replaceChildren(); const none = document.createElement('option'); none.value = ''; none.textContent = '不设置'; select.append(none);
    for (const member of state.members) {
      const option = document.createElement('option'); option.value = member.id; option.textContent = member.name + ' · ' + (roles[member.title] || ('R' + member.title)); select.append(option);
    }
    select.value = selected;
    if (select.value !== selected) state.settings.transferTargetId = null;
  }
  function renderMembers() {
    renderPicker('allowedMemberIds', 'allowedOptions', 'allowedSearch', 'allowedSummary', () => true);
    renderPicker('protectedMemberIds', 'protectedOptions', 'protectedSearch', 'protectedSummary', () => true);
    renderPicker('permanentViceMemberIds', 'permanentViceOptions', 'permanentViceSearch', 'permanentViceSummary', () => true, 2);
    renderTransferTargets();
    $('memberCount').textContent = state.members.length + ' 名成员';
  }
  async function loadAccounts() {
    const response = await fetch('/api/accounts'); const data = await response.json(); if (!response.ok) throw new Error(data.error || '账号读取失败');
    const select = $('account'); select.replaceChildren();
    for (const account of data.accounts) { const option = document.createElement('option'); option.value = account.id; option.textContent = account.title; select.append(option); }
    state.account = new URLSearchParams(location.search).get('account') || data.activeId || data.accounts[0]?.id || '';
    if (!state.account) throw new Error('还没有可管理的账号'); select.value = state.account;
  }
  async function loadConfig() { const data = await api('/api/guild-role/config'); state.revision = data.revision; state.settings = data.settings; state.status = data.status; restorePermissionDraft(); fillSettings(); renderStatus(); }
  async function loadMembers() {
    const data = await api('/api/guild-role/members'); state.members = data.members; state.canManage = data.canManage;
    if (data.settings) { state.revision = data.revision; state.settings = data.settings; state.status = data.status; renderStatus(); }
    $('memberCount').textContent = data.total + ' 名成员'; $('restoreNow').disabled = !data.canManage; $('transfer').disabled = !data.canManage; fillSettings(); renderMembers();
    if (!data.canManage) notify('当前账号尚未成为盟主：配置可以提前保存，职位操作将在成为盟主后生效');
  }
  async function loadAll() { await loadConfig(); await loadMembers(); if (permissionDirty) await saveSettings({ fromForm: false, message: '已恢复并保存上次的成员权限' }); }
  async function reloadStatus() { state.status = await api('/api/guild-role/status'); renderStatus(); }
  $('allowedSearch').addEventListener('input', () => renderPicker('allowedMemberIds', 'allowedOptions', 'allowedSearch', 'allowedSummary', () => true));
  $('protectedSearch').addEventListener('input', () => renderPicker('protectedMemberIds', 'protectedOptions', 'protectedSearch', 'protectedSummary', () => true));
  $('permanentViceSearch').addEventListener('input', () => renderPicker('permanentViceMemberIds', 'permanentViceOptions', 'permanentViceSearch', 'permanentViceSummary', () => true, 2));
  $('account').addEventListener('change', async event => {
    const previous = state.account, next = event.target.value;
    try {
      if (permissionDirty) await saveSettings({ fromForm: false, message: '成员权限已自动保存' });
      state.account = next; permissionEditVersion += 1; permissionDirty = false;
      const params = new URLSearchParams(location.search); params.set('account', state.account); history.replaceState(null, '', '/guild-role?' + params.toString());
      await loadAll();
    } catch (error) { state.account = previous; event.target.value = previous; notify(error.message, 'error'); }
  });
  $('refresh').addEventListener('click', () => busy($('refresh'), loadAll()).catch(error => notify(error.message, 'error')));
  $('refreshMembers').addEventListener('click', () => busy($('refreshMembers'), loadMembers().then(() => notify('成员当前职务已刷新'))).catch(error => notify(error.message, 'error')));
  $('refreshStatus').addEventListener('click', () => busy($('refreshStatus'), reloadStatus()).catch(error => notify(error.message, 'error')));
  $('allowedClear').addEventListener('click', () => { state.settings.allowedMemberIds = []; renderPicker('allowedMemberIds', 'allowedOptions', 'allowedSearch', 'allowedSummary', () => true); schedulePermissionSave(); });
  $('protectedClear').addEventListener('click', () => { state.settings.protectedMemberIds = []; renderPicker('protectedMemberIds', 'protectedOptions', 'protectedSearch', 'protectedSummary', () => true); schedulePermissionSave(); });
  $('permanentViceClear').addEventListener('click', () => { state.settings.permanentViceMemberIds = []; renderPicker('permanentViceMemberIds', 'permanentViceOptions', 'permanentViceSearch', 'permanentViceSummary', () => true, 2); schedulePermissionSave(); });
  $('save').addEventListener('click', () => busy($('save'), saveSettings()).catch(error => notify(error.message, 'error')));
  $('restoreNow').addEventListener('click', () => { if (!confirm('立即按原始快照恢复全部成员职位？')) return; busy($('restoreNow'), api('/api/guild-role/restore', { method: 'POST', body: JSON.stringify({ confirm: true }) }).then(data => { state.status = data.status; renderStatus(); notify(data.restored ? '全部职位已恢复' : '当前没有需要恢复的职位'); })).catch(error => notify(error.message, 'error')); });
  $('transfer').addEventListener('click', () => { const target = state.members.find(member => member.id === $('transferTarget').value); if (!target) return notify('请先选择盟主转让目标', 'error'); $('transferText').textContent = '目标成员：' + target.name; $('confirmName').value = ''; $('transferDialog').showModal(); $('confirmName').focus(); });
  $('cancelTransfer').addEventListener('click', () => $('transferDialog').close());
  $('confirmTransfer').addEventListener('click', () => { const target = state.members.find(member => member.id === $('transferTarget').value); if (!target) return; busy($('confirmTransfer'), api('/api/guild-role/transfer-president', { method: 'POST', body: JSON.stringify({ confirm: true, targetId: target.id, expectedNickname: $('confirmName').value }) }).then(() => { $('transferDialog').close(); notify('盟主已转让给 ' + target.name); return loadAll(); })).catch(error => notify(error.message, 'error')); });
  loadAccounts().then(loadAll).catch(error => notify(error.message, 'error'));
  setInterval(() => { if (!document.hidden && state.account) reloadStatus().catch(() => {}); }, 3000);
})();
</script>
</body>
</html>`;
