import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGuildRoleBot } from '../src/guild-role-bot.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-guild-role-'));
let clock = Date.parse('2026-12-18T20:00:10+08:00');
const guildId = '9007199254740000';
const members = new Map();
for (let index = 1; index <= 4; index += 1) members.set(`90071992547400${String(index).padStart(2, '0')}`, { name: `副盟${index}`, title: 4 });
for (let index = 1; index <= 20; index += 1) members.set(`90071992547401${String(index).padStart(2, '0')}`, { name: `精英${index}`, title: 3 });
members.set('9007199254740991', { name: '申请人甲', title: 2 });
members.set('9007199254740992', { name: '申请人乙', title: 2 });
const original = new Map([...members].map(([id, member]) => [id, member.title]));
const protectedVice = '9007199254740001';
const permanentVice2 = '9007199254740002';
const protectedElite = '9007199254740101';
const writes = [];
const events = [];
const handovers = [];
const client = {
  connected: true,
  serverClockOffsetMs: 0,
  async request(name) {
    if (name === 'GuildInfoRequest') return { myTitle: 5, guild: { guildId } };
    if (name === 'GuildMemberRequest') {
      const grouped = new Map();
      for (const [playerId, member] of members) {
        if (!grouped.has(member.title)) grouped.set(member.title, []);
        grouped.get(member.title).push({ playerId, nickname: member.name });
      }
      return { total: members.size, titleList: [...grouped].map(([guildTitle, rows]) => ({ guildTitle, members: rows })) };
    }
    throw new Error('unexpected request ' + name);
  },
  async sendWatch(name, body) {
    assert.equal(name, 'ChangeGuildMemberTitleRequest');
    writes.push({ ...body, at: clock });
    members.get(String(body.memberId)).title = body.title;
  },
};
const bot = createGuildRoleBot({ accountId: 'leader', dataDir: dir, settings: {
  enabled: true,
  commandStart: '20:00',
  commandEnd: '21:00',
  leaseSeconds: 120,
  restoreAt: '21:05',
  allowedMemberIds: ['9007199254740991', '9007199254740992'],
  protectedMemberIds: [protectedVice, protectedElite],
  permanentViceMemberIds: [protectedVice, permanentVice2],
}, now: () => clock, wait: async () => {}, timers: false });
bot.attach(client, {
  getPlayer: () => ({ guildId }),
  enabled: () => true,
  schedule: work => work(),
  afterRestore: async pending => { handovers.push(pending); return { nickname: members.get(pending.targetId).name }; },
  onEvent: entry => events.push(entry),
});
const message = (senderId, command, timestamp = Math.floor(clock / 1000)) => ({
  senderId,
  nickname: members.get(senderId).name,
  command,
  text: command === 'promote' ? '上副盟' : '下副盟',
  timestamp,
});
const count = title => [...members.values()].filter(member => member.title === title).length;
const assertOriginal = () => {
  for (const [id, title] of original) assert.equal(members.get(id).title, title, `${members.get(id).name} 应恢复 R${title}`);
};

const applicant = '9007199254740991';
const first = message(applicant, 'promote');
assert.equal(bot.receive(client, first).accepted, true);
assert.equal(bot.receive(client, first).reason, 'duplicate');
await bot.flush();
assert.equal(members.get(applicant).title, 4);
assert.equal(count(4), 4, '副盟满员时应由原副盟让位，仍保持四人');
assert.equal(count(3), 20, '精英满员时应有人降到 R2，仍保持二十人');
assert.equal([...members].filter(([id, member]) => original.get(id) === 4 && member.title === 3).length, 1);
assert.equal([...members].filter(([id, member]) => original.get(id) === 3 && member.title === 2).length, 1);
assert.equal(members.get(protectedVice).title, 4, '永久副盟主不能被选作让位成员');
assert.equal(members.get(permanentVice2).title, 4, '第二名永久副盟主不能被选作让位成员');
assert.equal(members.get(protectedElite).title, 3, '精英优先成员应优先保留 R3');
assert.equal(bot.snapshot().leases[0].expiresAt - clock, 120000);
assert(bot.snapshot().baseline);

clock += 120001;
await bot.flush();
assertOriginal();
assert.equal(bot.snapshot().leases.length, 0);

// 同一成员的新消息仍可再次执行，并可用“下副盟”提前恢复整条让位链。
clock += 1000;
assert.equal(bot.receive(client, message(applicant, 'promote')).accepted, true);
await bot.flush();
assert.equal(members.get(applicant).title, 4);
clock += 1000;
assert.equal(bot.receive(client, message(applicant, 'demote')).accepted, true);
await bot.flush();
assertOriginal();

// 21:05 收尾会清除未到期租约，并按首次快照恢复所有成员。
clock = Date.parse('2026-12-18T20:59:50+08:00');
const secondApplicant = '9007199254740992';
bot.configure({ enabled: true, commandStart: '20:00', commandEnd: '21:00', leaseSeconds: 120, restoreAt: '21:05',
  allowedMemberIds: [applicant, secondApplicant], protectedMemberIds: [protectedVice, protectedElite],
  transferTargetId: secondApplicant, transferAfterRestore: true });
assert.equal(bot.receive(client, message(secondApplicant, 'promote')).accepted, true);
await bot.flush();
assert.equal(members.get(secondApplicant).title, 4);
clock = Date.parse('2026-12-18T21:05:00+08:00');
await bot.flush();
assertOriginal();
assert.equal(bot.snapshot().baseline, null);
assert.equal(bot.snapshot().leases.length, 0);
assert.equal(handovers.length, 1);
assert.equal(handovers[0].targetId, secondApplicant);
assert.equal(bot.snapshot().pendingTransfer, null);
bot.configure({ enabled: true, commandStart: '20:00', commandEnd: '21:00', leaseSeconds: 120, restoreAt: '21:05',
  allowedMemberIds: [applicant, secondApplicant], protectedMemberIds: [protectedVice, protectedElite],
  transferTargetId: secondApplicant, transferAfterRestore: false });

assert.equal(bot.receive(client, message(applicant, 'promote')).reason, 'not-live-or-outside-window');
assert.equal(bot.receive(client, message(protectedElite, 'promote')).reason, 'sender-not-allowed');

// 收尾时离线也不能遗留错位：次日重新连接先补偿恢复昨天快照。
clock = Date.parse('2026-12-19T20:59:50+08:00');
assert.equal(bot.receive(client, message(applicant, 'promote')).accepted, true);
await bot.flush();
assert.equal(members.get(applicant).title, 4);
clock = Date.parse('2026-12-20T10:00:00+08:00');
await bot.flush();
assertOriginal();
assert.equal(bot.snapshot().baseline, null);

// 当天没有临时职位和快照，也要在统一收尾时间执行配置的盟主转让。
await bot.restoreNow();
clock = Date.parse('2026-12-21T21:05:00+08:00');
bot.configure({ enabled: true, commandStart: '20:00', commandEnd: '21:00', leaseSeconds: 120, restoreAt: '21:05',
  allowedMemberIds: [applicant], protectedMemberIds: [protectedVice, protectedElite],
  transferTargetId: applicant, transferAfterRestore: true });
await bot.flush();
assert.equal(handovers.length, 2);
assert.equal(handovers[1].targetId, applicant);
await bot.flush();
assert.equal(handovers.length, 2, '同一天的统一恢复后转让只能执行一次');

// R3 有空位时，精英优先名单中的 R2 会自动补到精英；永久副盟仍固定为 R4。
await bot.restoreNow();
const vacantElite = '9007199254740120';
members.get(vacantElite).title = 2;
clock = Date.parse('2026-12-22T20:00:10+08:00');
bot.configure({ enabled: true, commandStart: '20:00', commandEnd: '21:00', leaseSeconds: 120, restoreAt: '21:05',
  allowedMemberIds: [protectedVice], protectedMemberIds: [applicant], permanentViceMemberIds: [protectedVice, permanentVice2],
  transferTargetId: null, transferAfterRestore: false });
assert.equal(bot.receive(client, message(protectedVice, 'promote')).accepted, true);
await bot.flush();
assert.equal(members.get(applicant).title, 3, '精英空缺时应优先提升配置成员');
assert.equal(members.get(protectedVice).title, 4);
assert.equal(members.get(permanentVice2).title, 4);

assert(events.some(entry => /原始职位快照/.test(entry.message)));
assert(events.some(entry => /所有在盟成员已严格按盟主检测时的原始快照恢复/.test(entry.message)));
const saved = JSON.parse(fs.readFileSync(bot.stateFile, 'utf8'));
assert(saved.processed.length >= 4);
assert.equal(saved.queue.length, 0);

// 检测为盟主时先保存原职务，再随机让现任副盟给两名永久副盟让位；手动恢复必须忽略永久配置。
const bootstrapMembers = new Map();
for (let index = 1; index <= 4; index += 1) bootstrapMembers.set(`800000000000000${index}`, { name: `原副盟${index}`, title: 4 });
for (let index = 1; index <= 20; index += 1) bootstrapMembers.set(`80000000000001${String(index).padStart(2, '0')}`, { name: `原精英${index}`, title: 3 });
const fixedA = '8000000000000901', fixedB = '8000000000000902';
bootstrapMembers.set(fixedA, { name: '永久副盟甲', title: 2 });
bootstrapMembers.set(fixedB, { name: '永久副盟乙', title: 2 });
const queuedApplicant = '8000000000000903';
bootstrapMembers.set(queuedApplicant, { name: '初始化排队成员', title: 2 });
const bootstrapOriginal = new Map([...bootstrapMembers].map(([id, member]) => [id, member.title]));
const bootstrapClient = {
  connected: true,
  serverClockOffsetMs: 0,
  async request(name) {
    if (name === 'GuildInfoRequest') return { myTitle: 5, guild: { guildId } };
    if (name === 'GuildMemberRequest') {
      const grouped = new Map();
      for (const [playerId, member] of bootstrapMembers) {
        if (!grouped.has(member.title)) grouped.set(member.title, []);
        grouped.get(member.title).push({ playerId, nickname: member.name });
      }
      return { total: bootstrapMembers.size, titleList: [...grouped].map(([guildTitle, rows]) => ({ guildTitle, members: rows })) };
    }
    throw new Error('unexpected bootstrap request ' + name);
  },
  async sendWatch(name, body) {
    assert.equal(name, 'ChangeGuildMemberTitleRequest');
    bootstrapMembers.get(String(body.memberId)).title = body.title;
  },
};
const bootstrapClock = Date.parse('2026-12-23T20:00:10+08:00');
const bootstrapBot = createGuildRoleBot({ accountId: 'bootstrap-leader', dataDir: dir, random: () => 0, now: () => bootstrapClock,
  timers: false, wait: async () => {}, settings: {
  enabled: true, commandStart: '20:00', commandEnd: '21:00', leaseSeconds: 120, restoreAt: '21:05',
  allowedMemberIds: [queuedApplicant], protectedMemberIds: [], permanentViceMemberIds: [fixedA, fixedB],
} });
let bootstrapReady = false;
bootstrapBot.attach(bootstrapClient, {
  getPlayer: () => ({ guildId }),
  enabled: () => bootstrapReady,
  accepting: () => true,
  schedule: work => work(),
});
assert.equal(bootstrapBot.receive(bootstrapClient, {
  senderId: queuedApplicant, nickname: bootstrapMembers.get(queuedApplicant).name,
  command: 'promote', text: '上副盟', timestamp: Math.floor(bootstrapClock / 1000),
}).accepted, true, '永久副盟初始化完成前，时段内实时指令应先进入队列');
assert.equal(bootstrapBot.snapshot().queue.length, 1);
assert.equal(bootstrapMembers.get(queuedApplicant).title, 2);
await bootstrapBot.initializeLeadership([...bootstrapMembers].map(([id, member]) => ({ id, ...member })));
assert.equal(bootstrapBot.snapshot().baseline.memberCount, bootstrapMembers.size);
assert.equal(bootstrapBot.snapshot().permanentViceDonorIds.length, 2);
assert.equal(bootstrapMembers.get(fixedA).title, 4);
assert.equal(bootstrapMembers.get(fixedB).title, 4);
assert.equal([...bootstrapMembers.values()].filter(member => member.title === 4).length, 4);
assert.equal(bootstrapMembers.get(queuedApplicant).title, 2, '初始化未放行前不能执行已排队指令');
bootstrapReady = true;
await bootstrapBot.flush();
assert.equal(bootstrapMembers.get(queuedApplicant).title, 4, '初始化完成后应执行已排队指令');
await bootstrapBot.restoreNow();
for (const [id, title] of bootstrapOriginal) assert.equal(bootstrapMembers.get(id).title, title, `${bootstrapMembers.get(id).name} 应严格恢复 R${title}`);

fs.rmSync(dir, { recursive: true, force: true });
console.log('guild role bot ok: full R4/R3 rotation, repeat-safe commands, 120-second leases and cutoff restore');
