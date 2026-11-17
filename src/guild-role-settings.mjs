import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_GUILD_ROLE_SETTINGS = Object.freeze({
  enabled: false,
  commandStart: '20:00',
  commandEnd: '21:00',
  leaseSeconds: 120,
  restoreAt: '21:05',
  allowedMemberIds: [],
  protectedMemberIds: [],
  permanentViceMemberIds: [],
  transferTargetId: null,
  transferAfterRestore: false,
});

const ID_PATTERN = /^[1-9]\d{0,18}$/;
const MAX_ID = (1n << 63n) - 1n;

export function guildRoleClockMinutes(value, label = '时间') {
  const text = String(value ?? '');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error(`${label}必须使用 HH:mm 格式`);
  const [hour, minute] = text.split(':').map(Number);
  return hour * 60 + minute;
}
function memberIds(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}必须是成员列表`);
  const ids = [];
  for (const raw of value) {
    const id = String(raw ?? '');
    if (!ID_PATTERN.test(id) || BigInt(id) > MAX_ID) throw new Error(`${label}包含无效成员 ID`);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

function optionalMemberId(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const id = String(value);
  if (!ID_PATTERN.test(id) || BigInt(id) > MAX_ID) throw new Error(`${label}不是有效成员`);
  return id;
}

export function normalizeGuildRoleSettings(input = {}, fallback = DEFAULT_GUILD_ROLE_SETTINGS) {
  const merged = { ...DEFAULT_GUILD_ROLE_SETTINGS, ...fallback, ...input };
  if (typeof merged.enabled !== 'boolean') throw new Error('机器人开关必须是布尔值');
  if (typeof merged.transferAfterRestore !== 'boolean') throw new Error('统一恢复后转让开关必须是布尔值');
  const commandStart = String(merged.commandStart);
  const commandEnd = String(merged.commandEnd);
  const restoreAt = String(merged.restoreAt);
  const startMinutes = guildRoleClockMinutes(commandStart, '指令开始时间');
  const endMinutes = guildRoleClockMinutes(commandEnd, '指令结束时间');
  const restoreMinutes = guildRoleClockMinutes(restoreAt, '职位恢复时间');
  if (endMinutes <= startMinutes) throw new Error('指令结束时间必须晚于开始时间，第一版暂不支持跨日时间窗');
  if (restoreMinutes < endMinutes) throw new Error('职位恢复时间不能早于指令结束时间');
  const leaseSeconds = Number(merged.leaseSeconds);
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 600) throw new Error('副盟主持续时间必须是 10–600 秒的整数');
  const transferTargetId = optionalMemberId(merged.transferTargetId, '盟主转让目标');
  const permanentViceMemberIds = memberIds(merged.permanentViceMemberIds, '永久副盟名单');
  if (permanentViceMemberIds.length > 2) throw new Error('永久副盟最多选择 2 人');
  if (merged.transferAfterRestore && !transferTargetId) throw new Error('开启统一恢复后转让前必须选择目标成员');
  if (merged.transferAfterRestore && !merged.enabled) throw new Error('统一恢复后自动转让需要先启用机器人');
  return {
    enabled: merged.enabled,
    commandStart,
    commandEnd,
    leaseSeconds,
    restoreAt,
    allowedMemberIds: memberIds(merged.allowedMemberIds, '允许发指令名单'),
    protectedMemberIds: memberIds(merged.protectedMemberIds, '职位保护名单'),
    permanentViceMemberIds,
    transferTargetId,
    transferAfterRestore: merged.transferAfterRestore,
  };
}

function settingsFile(accountId, dataDir) {
  if (typeof accountId !== 'string' || !accountId) throw new Error('联盟职位配置缺少账号标识');
  return path.join(dataDir, 'guild-role-settings-' + encodeURIComponent(accountId) + '.json');
}

function defaultsFromEnvironment(env) {
  return normalizeGuildRoleSettings({
    enabled: env.CW_GUILD_ROLE_BOT === '1',
    restoreAt: env.CW_GUILD_ROLE_RESTORE_AT || DEFAULT_GUILD_ROLE_SETTINGS.restoreAt,
  });
}

export function loadGuildRoleSettings(accountId, dataDir, { env = process.env } = {}) {
  const file = settingsFile(accountId, dataDir);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      revision: Number.isSafeInteger(raw.revision) && raw.revision > 0 ? raw.revision : 1,
      savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : null,
      settings: normalizeGuildRoleSettings(raw.settings),
      file,
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { revision: 0, savedAt: null, settings: defaultsFromEnvironment(env), file };
  }
}

export function saveGuildRoleSettings(accountId, dataDir, settings, { revision } = {}) {
  const current = loadGuildRoleSettings(accountId, dataDir);
  if (!Number.isSafeInteger(revision) || revision !== current.revision) throw new Error('联盟职位配置已在其他页面更新，请刷新后重试');
  const entry = {
    version: 1,
    revision: current.revision + 1,
    savedAt: new Date().toISOString(),
    settings: normalizeGuildRoleSettings(settings, current.settings),
  };
  fs.mkdirSync(path.dirname(current.file), { recursive: true });
  const temporary = current.file + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(entry, null, 2) + '\n');
    fs.renameSync(temporary, current.file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return { ...entry, file: current.file };
}
