import assert from 'node:assert/strict';
import vm from 'node:vm';
import { GUILD_ROLE_PAGE } from '../src/guild-role-page.mjs';
import { DEFAULT_GUILD_ROLE_SETTINGS } from '../src/guild-role-settings.mjs';

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.handlers = new Map(); this.value = ''; this.checked = false; this.disabled = false; this.textContent = ''; this.classList = { toggle() {} }; }
  append(...elements) { this.children.push(...elements); }
  replaceChildren(...elements) { this.children = elements; }
  addEventListener(name, work) { this.handlers.set(name, work); }
  fire(name) { return this.handlers.get(name)?.({ target: this }); }
  showModal() {} close() {} focus() {}
}
const elements = new Map([...GUILD_ROLE_PAGE.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, new Element(id === 'account' || id === 'transferTarget' ? 'select' : 'div')]));
const data = {
  revision: 1, settings: { ...DEFAULT_GUILD_ROLE_SETTINGS, enabled: true, allowedMemberIds: ['1'], protectedMemberIds: ['99'], transferTargetId: '99' },
  members: [{ id: '1', name: '甲', title: 2 }, { id: '2', name: '乙', title: 4 }, { id: '99', name: '现任盟主', title: 5 }],
  version: 1, canManage: false,
};
const status = () => ({ enabled: true, active: data.canManage, ready: data.canManage, canManage: data.canManage,
  baseline: data.baseline || null, transferring: data.transferring || false,
  revision: data.revision, rosterVersion: data.version, queue: [], leases: [], permanentVice: { status: 'saved' } });
const posts = [], requests = [], timers = new Map(), stored = new Map(), sources = [];
let timerId = 0;
class Source {
  constructor(url) { this.url = url; this.handlers = new Map(); sources.push(this); }
  addEventListener(name, work) { this.handlers.set(name, work); }
  close() { this.closed = true; }
  emit() { this.handlers.get('guild-role-changed')?.(); }
}
const context = vm.createContext({
  document: { hidden: false, getElementById: id => elements.get(id), createElement: tag => new Element(tag) },
  location: { search: '?account=A' }, history: { replaceState() {} }, URLSearchParams, EventSource: Source,
  localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
  addEventListener() {}, confirm: () => true,
  setTimeout: (work, delay) => { const id = ++timerId; timers.set(id, { work, delay }); return id; },
  clearTimeout: id => timers.delete(id), setInterval() {}, console,
  fetch: async (url, options = {}) => {
    const path = url.split('?')[0]; requests.push(path);
    let value;
    if (options.method === 'POST') {
      const payload = JSON.parse(options.body); posts.push({ path, payload });
      if (payload.revision !== data.revision) return { ok: false, json: async () => ({ error: '配置已在其他页面更新，请刷新后重试' }) };
      if (path.endsWith('/permanent-vice')) data.settings = { ...data.settings, permanentViceMemberIds: payload.memberIds };
      else data.settings = payload.settings;
      data.revision++;
      value = { settings: data.settings, revision: data.revision, status: status() };
    } else if (path === '/api/accounts') value = { accounts: [{ id: 'A', title: '离线账号' }], activeId: 'A' };
    else if (path.endsWith('/config')) value = { settings: data.settings, revision: data.revision, status: status() };
    else if (path.endsWith('/members') || path.endsWith('/roster')) value = { members: data.members, total: data.members.length, canManage: data.canManage,
      rosterVersion: data.version, revision: data.revision, settings: data.settings, status: status() };
    else if (path.endsWith('/status')) value = status();
    else assert.fail('unexpected fixture request ' + path);
    return { ok: true, json: async () => structuredClone(value) };
  },
});
const script = [...GUILD_ROLE_PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
vm.runInContext(script, context);
async function settle() { for (let n = 0; n < 15; n++) await new Promise(resolve => setImmediate(resolve)); }
async function autosave() {
  for (const [id, timer] of [...timers]) if (timer.delay === 600) { timers.delete(id); timer.work(); }
  await settle();
}
const get = id => elements.get(id);
const choose = (host, name) => get(host).children.find(label => label.children[1]?.textContent === name)?.children[0];
await settle();
assert.equal(sources.length, 1); assert.equal(get('restoreNow').disabled, true);
assert(choose('protectedOptions', '现任盟主').checked, '成为盟主之前可以预配置现任盟主');

// Live status/roster synchronization must not replace unsaved time or permission drafts.
get('start').value = '19:30'; get('start').fire('input');
data.canManage = true; data.members[0].title = 4; data.version++;
sources[0].emit(); await settle();
assert.equal(get('restoreNow').disabled, false);
assert.equal(get('start').value, '19:30');
data.baseline = { day: '2026-12-20', memberCount: 3 }; sources[0].emit(); await settle();
assert.equal(get('transfer').disabled, false, '有原始快照时也能一键恢复后转让');
get('transferTarget').value = '2'; get('transfer').fire('click');
assert(get('transferText').textContent.includes('先按原始快照恢复'));
data.transferring = true; sources[0].emit(); await settle();
assert.equal(get('transfer').disabled, true, '执行时阻止重复点击');
data.transferring = false; sources[0].emit(); await settle();
assert(get('allowedOptions').children[0].children[2].textContent.includes('副盟主'));
assert(requests.includes('/api/guild-role/roster'));

const permanent = choose('permanentViceOptions', '甲'); permanent.checked = true; permanent.fire('change'); await autosave();
assert.equal(posts.at(-1).path, '/api/guild-role/permanent-vice');
assert.deepEqual(Object.keys(posts.at(-1).payload).sort(), ['confirm', 'memberIds', 'revision']);
assert.deepEqual(data.settings.allowedMemberIds, ['1']); assert.deepEqual(data.settings.protectedMemberIds, ['99']);
assert.equal(data.settings.transferTargetId, '99'); assert.equal(data.settings.commandStart, '20:00');
assert.equal(get('start').value, '19:30', '自动保存永久名单也不覆盖其他草稿');

// Persist transfer preferences automatically, including the current leader as a future target.
get('transferAfterRestore').checked = true; get('transferAfterRestore').fire('change'); await autosave();
assert.equal(data.settings.transferAfterRestore, true); assert.equal(data.settings.transferTargetId, '99');

// An external revision must not be silently adopted underneath a stale form.
data.revision++; data.settings.allowedMemberIds = ['2']; sources[0].emit(); await settle();
const second = choose('permanentViceOptions', '乙'); second.checked = true; second.fire('change'); await autosave();
assert(get('notice').textContent.includes('其他页面更新'));
assert.deepEqual(data.settings.permanentViceMemberIds, ['1']); assert.deepEqual(data.settings.allowedMemberIds, ['2']);
assert(stored.size, '冲突时保留本地未保存草稿');
console.log('guild role page ok: live roster, draft preservation, partial permanent save, persistent transfer and revision conflicts');
