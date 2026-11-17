import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readGuildRoleMembers, transferGuildPresident, validateGuildRolePreconfiguration } from '../src/guild-role-admin.mjs';
import { loadGuildRoleSettings, normalizeGuildRoleSettings, saveGuildRoleSettings } from '../src/guild-role-settings.mjs';
import { GUILD_ROLE_PAGE } from '../src/guild-role-page.mjs';
import { PAGE } from '../src/page.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-guild-role-admin-'));
const accountId = 'leader-account';
const first = loadGuildRoleSettings(accountId, dir, { env: {} });
assert.equal(first.revision, 0);
assert.equal(first.settings.enabled, false);
assert.deepEqual(first.settings.allowedMemberIds, []);

const saved = saveGuildRoleSettings(accountId, dir, {
  enabled: true,
  commandStart: '20:00',
  commandEnd: '21:00',
  leaseSeconds: 120,
  restoreAt: '21:10',
  allowedMemberIds: ['9007199254740992'],
  protectedMemberIds: ['9007199254740991'],
  permanentViceMemberIds: ['9007199254740991', '9007199254740992'],
  transferTargetId: '9007199254740992',
  transferAfterRestore: true,
}, { revision: 0 });
assert.equal(saved.revision, 1);
assert.equal(loadGuildRoleSettings(accountId, dir).settings.restoreAt, '21:10');
assert.equal(loadGuildRoleSettings(accountId, dir).settings.transferAfterRestore, true);
assert.deepEqual(loadGuildRoleSettings(accountId, dir).settings.allowedMemberIds, ['9007199254740992']);
assert.deepEqual(loadGuildRoleSettings(accountId, dir).settings.protectedMemberIds, ['9007199254740991']);
assert.deepEqual(loadGuildRoleSettings(accountId, dir).settings.permanentViceMemberIds, ['9007199254740991', '9007199254740992']);
assert.throws(() => normalizeGuildRoleSettings({ ...saved.settings, permanentViceMemberIds: ['1', '2', '3'] }), /最多选择 2 人/);
assert.throws(() => saveGuildRoleSettings(accountId, dir, saved.settings, { revision: 0 }), /其他页面更新/);
assert.throws(() => saveGuildRoleSettings(accountId, dir, { ...saved.settings, restoreAt: '20:30' }, { revision: 1 }), /不能早于/);
assert.deepEqual(normalizeGuildRoleSettings({ ...saved.settings, allowedMemberIds: [] }).allowedMemberIds, []);

const guildId = '9007199254740000';
const ownId = '9007199254740900';
const targetId = '9007199254740992';
let myTitle = 5;
const members = new Map([
  [ownId, { name: '原盟主', title: 5, online: true }],
  ['9007199254740991', { name: '受保护副盟', title: 4, online: false }],
  [targetId, { name: '新盟主', title: 2, online: true }],
]);
const client = {
  async request(name) {
    if (name === 'GuildInfoRequest') return { myTitle, guild: { guildId, name: '测试联盟' } };
    if (name === 'GuildMemberRequest') {
      const groups = new Map();
      for (const [playerId, member] of members) {
        if (!groups.has(member.title)) groups.set(member.title, []);
        groups.get(member.title).push({ playerId, nickname: member.name, online: member.online });
      }
      return { total: members.size, titleList: [...groups].map(([guildTitle, rows]) => ({ guildTitle, members: rows })) };
    }
    throw new Error('unexpected request ' + name);
  },
  async sendWatch(name, body) {
    assert.equal(name, 'ChangeGuildMemberTitleRequest');
    assert.deepEqual(body, { memberId: targetId, title: 5 });
    members.get(ownId).title = 4;
    members.get(targetId).title = 5;
    myTitle = 4;
  },
};
const player = { playerId: ownId, guildId };
const roster = await readGuildRoleMembers(client, player);
assert.equal(roster.canManage, true);
assert.equal(roster.members.length, 3);
assert.equal(roster.members[0].title, 5);
const futureLeaderRoster = { ...roster, canManage: false };
assert.deepEqual(validateGuildRolePreconfiguration(futureLeaderRoster, {
  allowedMemberIds: [ownId], protectedMemberIds: [targetId], permanentViceMemberIds: [ownId, targetId], transferTargetId: ownId,
}), { canManage: false, memberCount: 3 });
assert.throws(() => validateGuildRolePreconfiguration(futureLeaderRoster, {
  allowedMemberIds: [], protectedMemberIds: [], permanentViceMemberIds: ['888'], transferTargetId: null,
}), /永久副盟名单中有成员已离盟/);
await assert.rejects(() => transferGuildPresident(client, player, { targetId, expectedNickname: '写错昵称', wait: async () => {} }), /确认昵称/);
const transferred = await transferGuildPresident(client, player, { targetId, expectedNickname: '新盟主', wait: async () => {} });
assert.equal(transferred.ok, true);
assert.equal(members.get(targetId).title, 5);
const repeated = await transferGuildPresident(client, player, { targetId, expectedNickname: '新盟主', wait: async () => {} });
assert.equal(repeated.alreadyTransferred, true);

for (const marker of ['/api/guild-role/config', '/api/guild-role/members', '刷新成员职务', '成员当前职务已刷新', '立即恢复全部职位', '确认转让', '统一恢复后自动转让', '成员权限已自动保存', '已恢复并保存上次的成员权限', '永久副盟（最多 2 人）', '精英优先', '配置可以提前保存', '随托管自动运行']) {
  assert(GUILD_ROLE_PAGE.includes(marker), `独立页面应包含 ${marker}`);
}
assert.equal((PAGE.match(/class="nav-tab"/g) ?? []).length, 9);
assert(PAGE.indexOf('data-tab="login-settings"') < PAGE.indexOf('data-tab="guild-role"'), '联盟职位标签应位于登录设置之后');
assert.match(PAGE, /id="tab-guild-role"[\s\S]+id="guild-role-frame"/);
assert.match(PAGE, /\/guild-role\?embedded=1/);

fs.rmSync(dir, { recursive: true, force: true });
console.log('guild role admin ok: persisted settings, roster controls, confirmed president transfer and embedded console page');
