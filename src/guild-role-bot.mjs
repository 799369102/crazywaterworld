import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { guildRoleClockMinutes, normalizeGuildRoleSettings } from './guild-role-settings.mjs';

const MEMBER = 2;
const ELITE = 3;
const VICE_PRESIDENT = 4;
const PRESIDENT = 5;
const MAX_ELITES = 20;
const MAX_VICE_PRESIDENTS = 4;
const MAX_MESSAGE_AGE_MS = 30 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 1000;
const MAX_PROCESSED = 5000;

function idText(value) {
  if (value && typeof value.low === 'number' && typeof value.high === 'number') {
    const id = (BigInt(value.high) << 32n) + BigInt(value.low >>> 0);
    return id > 0n && id <= (1n << 63n) - 1n ? id.toString() : null;
  }
  if (typeof value === 'bigint') return value > 0n && value <= (1n << 63n) - 1n ? value.toString() : null;
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= (1n << 63n) - 1n) return value;
  return null;
}

function beijingParts(timestampMs) {
  const date = new Date(timestampMs + 8 * 60 * 60 * 1000);
  return { day: date.toISOString().slice(0, 10), minutes: date.getUTCHours() * 60 + date.getUTCMinutes() };
}

function inCommandWindow(timestampMs, settings) {
  const { minutes } = beijingParts(timestampMs);
  return minutes >= guildRoleClockMinutes(settings.commandStart) && minutes < guildRoleClockMinutes(settings.commandEnd);
}

function commandKey(message) {
  return `${message.senderId}:${message.timestamp}:${message.command}:${message.text}`;
}

function emptyState() {
  return { version: 5, sequence: 0, queue: [], processed: [], leases: [], baseline: null, permanentViceDonorIds: [], needsReconcile: false,
    pendingTransfer: null, restoredDays: [], transferScheduledDays: [] };
}

function normalizeBaseline(raw) {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day) || !Array.isArray(raw.members)) return null;
  const members = raw.members.filter(row => row && idText(row.memberId) && [MEMBER, ELITE, VICE_PRESIDENT].includes(row.title))
    .map(row => ({ memberId: idText(row.memberId), name: String(row.name || row.memberId), title: row.title }));
  return members.length ? { day: raw.day, capturedAt: Number(raw.capturedAt) || 0, members } : null;
}

function normalizeState(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== 'object') return state;
  state.sequence = Number.isSafeInteger(raw.sequence) && raw.sequence >= 0 ? raw.sequence : 0;
  state.queue = Array.isArray(raw.queue) ? raw.queue.filter(row => row && typeof row.key === 'string' && idText(row.senderId)
    && ['promote', 'demote'].includes(row.command) && Number.isSafeInteger(row.gameTimestamp) && Number.isFinite(row.localReceivedAt)) : [];
  state.processed = Array.isArray(raw.processed) ? raw.processed.filter(row => row && typeof row.key === 'string' && Number.isFinite(row.at)).slice(-MAX_PROCESSED) : [];
  state.leases = Array.isArray(raw.leases) ? raw.leases.filter(row => row && idText(row.memberId) && Number.isFinite(row.expiresAt))
    .map(row => ({ memberId: idText(row.memberId), name: String(row.name || row.memberId), grantedAt: Number(row.grantedAt) || 0, expiresAt: row.expiresAt })) : [];
  state.baseline = normalizeBaseline(raw.baseline);
  state.permanentViceDonorIds = Array.isArray(raw.permanentViceDonorIds)
    ? [...new Set(raw.permanentViceDonorIds.map(idText).filter(Boolean))] : [];
  state.needsReconcile = raw.needsReconcile === true;
  if (!state.baseline) { state.leases = []; state.permanentViceDonorIds = []; state.needsReconcile = false; }
  if (raw.pendingTransfer && /^\d{4}-\d{2}-\d{2}$/.test(raw.pendingTransfer.day) && idText(raw.pendingTransfer.targetId)) {
    state.pendingTransfer = { day: raw.pendingTransfer.day, targetId: idText(raw.pendingTransfer.targetId),
      attempts: Number.isSafeInteger(raw.pendingTransfer.attempts) ? raw.pendingTransfer.attempts : 0,
      nextAttemptAt: Number.isFinite(raw.pendingTransfer.nextAttemptAt) ? raw.pendingTransfer.nextAttemptAt : 0 };
  }
  state.restoredDays = Array.isArray(raw.restoredDays ?? raw.fixedDays)
    ? (raw.restoredDays ?? raw.fixedDays).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)).slice(-30) : [];
  state.transferScheduledDays = Array.isArray(raw.transferScheduledDays)
    ? raw.transferScheduledDays.filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)).slice(-30) : [];
  return state;
}

function loadState(file) {
  try { return normalizeState(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return emptyState(); throw error; }
}

function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function createGuildRoleBot({
  accountId,
  dataDir,
  enabled = false,
  restoreAt = '21:05',
  settings: configuredSettings,
  now = () => Date.now(),
  random = Math.random,
  wait = sleep,
  timers = true,
} = {}) {
  if (typeof accountId !== 'string' || !accountId) throw new Error('联盟职位机器人缺少账号标识');
  let settings = normalizeGuildRoleSettings(configuredSettings ?? { enabled, restoreAt });
  const file = path.join(dataDir, 'guild-role-bot-' + encodeURIComponent(accountId) + '.json');
  const state = loadState(file);
  let context = null;
  let interval = null;
  let running = null;

  const persist = () => saveState(file, state);
  const report = (level, message, extra) => context?.onEvent?.({ level, message, extra });
  const gameNow = () => now() + (context?.client?.serverClockOffsetMs || 0);
  const active = () => settings.enabled && Boolean(context?.client) && context.client.connected !== false && context?.enabled?.() !== false;
  const accepting = () => settings.enabled && Boolean(context?.client) && context.client.connected !== false
    && (context?.accepting ? context.accepting() !== false : context?.enabled?.() !== false);
  const processedKeys = () => new Set(state.processed.map(row => row.key));

  function markProcessed(entry, result) {
    state.processed.push({ key: entry.key, at: now(), result });
    if (state.processed.length > MAX_PROCESSED) state.processed.splice(0, state.processed.length - MAX_PROCESSED);
  }

  async function roster() {
    const client = context.client;
    const player = context.getPlayer?.();
    const [guild, memberReply] = await Promise.all([
      client.request('GuildInfoRequest', {}, 'GuildInfoResponse'),
      client.request('GuildMemberRequest', {}, 'GuildMemberResponse'),
    ]);
    if (guild?.myTitle !== PRESIDENT) throw new Error('当前托管账号不是盟主，不能执行职位指令');
    const playerGuildId = idText(player?.guildId), responseGuildId = idText(guild?.guild?.guildId);
    if (!playerGuildId || playerGuildId !== responseGuildId) throw new Error('联盟身份已变化，停止职位操作');
    if (!Array.isArray(memberReply?.titleList)) throw new Error('服务器未返回完整联盟成员列表');
    const members = new Map();
    for (const group of memberReply.titleList) {
      if (!Array.isArray(group.members)) throw new Error('联盟成员职位分组不完整');
      for (const member of group.members) {
        const memberId = idText(member.playerId);
        if (memberId) members.set(memberId, { id: memberId, name: member.nickname || memberId, title: group.guildTitle });
      }
    }
    return { members };
  }

  async function changeTitle(memberId, title) {
    await context.client.sendWatch('ChangeGuildMemberTitleRequest', { memberId, title }, { window: 500 });
    for (const delay of [150, 300, 600]) {
      await wait(delay);
      const current = await roster();
      if (current.members.get(memberId)?.title === title) return current;
    }
    throw Object.assign(new Error('职位修改请求已发送，但成员列表尚未确认结果'), { resultUnknown: true });
  }

  function captureBaseline(current) {
    state.baseline = {
      day: beijingParts(gameNow()).day,
      capturedAt: gameNow(),
      members: [...current.members.values()].filter(member => [MEMBER, ELITE, VICE_PRESIDENT].includes(member.title))
        .map(member => ({ memberId: member.id, name: member.name, title: member.title }))
        .sort((a, b) => a.memberId.localeCompare(b.memberId)),
    };
    const permanentIds = new Set(settings.permanentViceMemberIds);
    const permanentPromotions = state.baseline.members.filter(member => permanentIds.has(member.memberId) && member.title !== VICE_PRESIDENT).length;
    const currentViceCount = state.baseline.members.filter(member => member.title === VICE_PRESIDENT).length;
    const donorsNeeded = Math.max(0, currentViceCount + permanentPromotions - MAX_VICE_PRESIDENTS);
    const candidates = state.baseline.members.filter(member => member.title === VICE_PRESIDENT && !permanentIds.has(member.memberId));
    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const selected = Math.floor(Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * (index + 1));
      [candidates[index], candidates[selected]] = [candidates[selected], candidates[index]];
    }
    if (donorsNeeded > candidates.length) throw new Error('没有足够的非永久副盟为永久副盟让位');
    state.permanentViceDonorIds = candidates.slice(0, donorsNeeded).map(member => member.memberId);
    state.needsReconcile = false;
    persist();
    report('info', `联盟职位 · 已保存 ${state.baseline.members.length} 名成员的原始职位快照`);
  }

  function desiredTitles() {
    if (!state.baseline) throw new Error('缺少联盟原始职位快照');
    const desired = new Map(state.baseline.members.map(member => [member.memberId, member.title]));
    const leaseIds = new Set(state.leases.map(lease => lease.memberId));
    const permanentViceIds = new Set(settings.permanentViceMemberIds.filter(memberId => desired.has(memberId)));
    for (const memberId of permanentViceIds) desired.set(memberId, VICE_PRESIDENT);
    for (const memberId of leaseIds) if ([MEMBER, ELITE].includes(desired.get(memberId))) desired.set(memberId, VICE_PRESIDENT);

    let excessVice = [...desired.values()].filter(title => title === VICE_PRESIDENT).length - MAX_VICE_PRESIDENTS;
    const protectedIds = new Set(settings.protectedMemberIds);
    const donorPriority = new Map(state.permanentViceDonorIds.map((memberId, index) => [memberId, index]));
    const viceDonors = state.baseline.members.filter(member => desired.get(member.memberId) === VICE_PRESIDENT
      && !leaseIds.has(member.memberId) && !permanentViceIds.has(member.memberId))
      .sort((a, b) => (donorPriority.get(a.memberId) ?? Number.MAX_SAFE_INTEGER) - (donorPriority.get(b.memberId) ?? Number.MAX_SAFE_INTEGER)
        || a.memberId.localeCompare(b.memberId));
    for (const donor of viceDonors) {
      if (excessVice <= 0) break;
      desired.set(donor.memberId, ELITE);
      excessVice -= 1;
    }
    if (excessVice > 0) throw new Error('永久副盟和临时副盟已超过 4 个 R4 名额');

    let excessElite = [...desired.values()].filter(title => title === ELITE).length - MAX_ELITES;
    const eliteDonors = state.baseline.members.filter(member => desired.get(member.memberId) === ELITE)
      .sort((a, b) => Number(protectedIds.has(a.memberId)) - Number(protectedIds.has(b.memberId))
        || Number(a.title !== ELITE) - Number(b.title !== ELITE) || a.memberId.localeCompare(b.memberId));
    for (const donor of eliteDonors) {
      if (excessElite <= 0) break;
      desired.set(donor.memberId, MEMBER);
      excessElite -= 1;
    }
    if (excessElite > 0) throw new Error('精英职位计算超过 20 个 R3 名额');
    let eliteVacancies = MAX_ELITES - [...desired.values()].filter(title => title === ELITE).length;
    const elitePriority = state.baseline.members.filter(member => protectedIds.has(member.memberId) && desired.get(member.memberId) === MEMBER)
      .sort((a, b) => a.memberId.localeCompare(b.memberId));
    for (const member of elitePriority) {
      if (eliteVacancies <= 0) break;
      desired.set(member.memberId, ELITE);
      eliteVacancies -= 1;
    }
    return desired;
  }

  async function applyDesiredTitles(desired, label) {
    let current = await roster();
    const changed = [...desired].filter(([memberId, title]) => current.members.has(memberId) && current.members.get(memberId).title !== title);
    // 先降到 R2 释放所有受限名额，再依次恢复 R3 和 R4。
    for (const [memberId, title] of changed) {
      const member = current.members.get(memberId);
      if (member.title !== MEMBER && title !== member.title) current = await changeTitle(memberId, MEMBER);
    }
    for (const title of [ELITE, VICE_PRESIDENT]) {
      for (const [memberId, desiredTitle] of changed) {
        if (desiredTitle === title && current.members.get(memberId)?.title !== title) current = await changeTitle(memberId, title);
      }
    }
    state.needsReconcile = false;
    persist();
    if (changed.length) report('info', `联盟职位 · ${label}，已调整 ${changed.length} 名成员`);
  }

  async function reconcile(label) {
    if (state.baseline) await applyDesiredTitles(desiredTitles(), label);
  }

  function queuePendingTransfer(day) {
    if (!settings.transferAfterRestore || !settings.transferTargetId || state.transferScheduledDays.includes(day)) return;
    state.pendingTransfer = { day, targetId: settings.transferTargetId, attempts: 0, nextAttemptAt: 0 };
    state.transferScheduledDays.push(day);
    state.transferScheduledDays = state.transferScheduledDays.slice(-30);
  }

  async function restoreBaseline(day, reason, { queueTransfer = false } = {}) {
    if (!state.baseline) return;
    state.leases = [];
    await applyDesiredTitles(new Map(state.baseline.members.map(member => [member.memberId, member.title])), reason);
    for (const entry of state.queue.splice(0)) markProcessed(entry, 'cleared-at-restore');
    state.baseline = null;
    state.permanentViceDonorIds = [];
    state.needsReconcile = false;
    if (queueTransfer) queuePendingTransfer(day);
    if (!state.restoredDays.includes(day)) state.restoredDays.push(day);
    state.restoredDays = state.restoredDays.slice(-30);
    persist();
    report('info', `联盟职位 · ${reason}，所有在盟成员已严格按盟主检测时的原始快照恢复`);
  }

  async function attemptPendingTransfer() {
    const pending = state.pendingTransfer;
    if (!pending || pending.nextAttemptAt > now()) return false;
    if (!settings.transferAfterRestore || settings.transferTargetId !== pending.targetId || !context?.afterRestore) {
      state.pendingTransfer = null;
      persist();
      return false;
    }
    try {
      const result = await context.afterRestore({ ...pending });
      state.pendingTransfer = null;
      persist();
      report('info', `联盟职位 · 统一恢复后已转让盟主给 ${result.nickname || pending.targetId}`);
      return true;
    } catch (error) {
      pending.attempts += 1;
      pending.nextAttemptAt = now() + Math.min(5 * 60 * 1000, pending.attempts * 30 * 1000);
      persist();
      report('warn', `联盟职位 · 统一恢复后的盟主转让失败，将自动重试：${error.message}`);
      return false;
    }
  }

  async function restoreAtCutoff() {
    if (!active()) return false;
    const restoreMinutes = guildRoleClockMinutes(settings.restoreAt);
    const local = beijingParts(now()), server = beijingParts(gameNow());
    if (local.day !== server.day) return false;
    const overdue = state.baseline && state.baseline.day < server.day;
    const cutoffReached = local.minutes >= restoreMinutes && server.minutes >= restoreMinutes;
    if (!overdue && !cutoffReached) return false;
    const actionDay = overdue ? state.baseline.day : server.day;
    const needsRestore = Boolean(state.baseline && (overdue || state.baseline.day === server.day));
    const needsTransfer = settings.transferAfterRestore && settings.transferTargetId && !state.transferScheduledDays.includes(actionDay);
    if (!needsRestore && !needsTransfer) return false;
    await context.schedule(async () => {
      if (needsRestore) await restoreBaseline(actionDay, overdue ? '跨日补偿恢复' : `${settings.restoreAt} 收尾`, { queueTransfer: true });
      else { queuePendingTransfer(actionDay); persist(); }
      await attemptPendingTransfer();
    });
    return true;
  }

  async function expireLeases() {
    const due = state.leases.filter(lease => lease.expiresAt <= gameNow());
    if (!due.length) return;
    state.leases = state.leases.filter(lease => lease.expiresAt > gameNow());
    state.needsReconcile = true;
    persist();
    await context.schedule(() => reconcile(`${settings.leaseSeconds} 秒临时职位到期`));
    for (const lease of due) report('info', `联盟职位 · ${lease.name} 的临时副盟主已到 ${settings.leaseSeconds} 秒`);
  }

  async function execute(entry) {
    const localTimestamp = now(), serverTimestamp = gameNow();
    if (!inCommandWindow(localTimestamp, settings) || !inCommandWindow(serverTimestamp, settings)
      || !inCommandWindow(entry.gameTimestamp * 1000, settings)) return { result: 'outside-window' };
    const current = await roster();
    const member = current.members.get(entry.senderId);
    if (!member) return { result: 'not-member' };
    if (!state.baseline) captureBaseline(current);
    if (state.baseline.day !== beijingParts(serverTimestamp).day) throw new Error('原始职位快照不是今天的数据，请等待恢复后重试');
    const lease = state.leases.find(row => row.memberId === entry.senderId);

    if (entry.command === 'demote') {
      if (!lease) return { result: 'not-temporary-vice' };
      state.leases = state.leases.filter(row => row !== lease);
      state.needsReconcile = true;
      persist();
      await reconcile(`${member.name} 执行下副盟`);
      return { result: 'demoted' };
    }

    const originalTitle = state.baseline.members.find(row => row.memberId === member.id)?.title;
    if (settings.permanentViceMemberIds.includes(member.id)) {
      state.needsReconcile = true;
      persist();
      await reconcile(`${member.name} 应用永久副盟配置`);
      return { result: 'permanent-vice' };
    }
    if (originalTitle === VICE_PRESIDENT) return { result: 'original-vice' };
    if (![MEMBER, ELITE].includes(originalTitle)) return { result: 'title-not-eligible' };
    if (lease) return { result: 'already-temporary-vice' };
    const newLease = { memberId: member.id, name: member.name, grantedAt: serverTimestamp,
      expiresAt: serverTimestamp + settings.leaseSeconds * 1000 };
    const previousNeedsReconcile = state.needsReconcile;
    state.leases.push(newLease);
    try {
      desiredTitles();
    } catch (error) {
      state.leases = state.leases.filter(row => row !== newLease);
      state.needsReconcile = previousNeedsReconcile;
      persist();
      throw error;
    }
    state.needsReconcile = true;
    persist();
    await reconcile(`${member.name} 执行上副盟`);
    return { result: 'promoted' };
  }

  async function drain() {
    if (!active()) return;
    if (state.pendingTransfer && state.pendingTransfer.nextAttemptAt <= now()) {
      await context.schedule(() => attemptPendingTransfer());
      if (!active()) return;
    }
    if (await restoreAtCutoff()) return;
    await expireLeases();
    if (state.needsReconcile && state.baseline) await context.schedule(() => reconcile('恢复未完成的职位调整'));
    state.queue.sort((a, b) => a.gameTimestamp - b.gameTimestamp || a.sequence - b.sequence);
    while (active() && state.queue.length) {
      const entry = state.queue[0];
      if (!inCommandWindow(now(), settings) || !inCommandWindow(gameNow(), settings)) {
        state.queue.shift();
        markProcessed(entry, 'expired-in-queue');
        persist();
        continue;
      }
      try {
        const outcome = await context.schedule(() => execute(entry));
        state.queue.shift();
        markProcessed(entry, outcome.result);
        persist();
      } catch (error) {
        state.queue.shift();
        markProcessed(entry, error.resultUnknown ? 'result-unknown' : 'failed');
        persist();
        report('warn', `联盟职位 · ${entry.nickname} 的指令执行失败：${error.message}`);
      }
      await expireLeases();
    }
  }

  function kick() {
    if (running) return running;
    running = Promise.resolve().then(drain).catch(error => report('warn', '联盟职位队列失败：' + error.message)).finally(() => { running = null; });
    return running;
  }

  function receive(client, message) {
    if (!accepting() || context?.client !== client || !message?.command) return { accepted: false, reason: 'disabled-or-detached' };
    if (!settings.allowedMemberIds.includes(message.senderId)) return { accepted: false, reason: 'sender-not-allowed' };
    const key = commandKey(message);
    if (processedKeys().has(key) || state.queue.some(row => row.key === key)) return { accepted: false, reason: 'duplicate' };
    const localReceivedAt = now(), serverReceivedAt = gameNow(), messageAt = message.timestamp * 1000;
    if (!inCommandWindow(localReceivedAt, settings) || !inCommandWindow(serverReceivedAt, settings) || !inCommandWindow(messageAt, settings)
      || serverReceivedAt - messageAt > MAX_MESSAGE_AGE_MS || messageAt - serverReceivedAt > MAX_FUTURE_SKEW_MS) {
      state.processed.push({ key, at: localReceivedAt, result: 'not-live-or-outside-window' });
      state.processed = state.processed.slice(-MAX_PROCESSED);
      persist();
      return { accepted: false, reason: 'not-live-or-outside-window' };
    }
    const entry = { key, sequence: ++state.sequence, senderId: message.senderId, nickname: message.nickname,
      command: message.command, text: message.text, gameTimestamp: message.timestamp, localReceivedAt, serverReceivedAt };
    state.queue.push(entry);
    persist();
    report('info', `联盟职位 · 已排队 ${message.nickname} 的“${message.text}”`, { guildRoleQueue: entry });
    kick();
    return { accepted: true, entry };
  }

  function attach(client, options) {
    context = { client, ...options };
    updateTimer();
    kick();
  }

  async function initializeLeadership(rosterMembers) {
    if (!context?.client) throw new Error('账号尚未连接，不能初始化联盟职位');
    const supplied = Array.isArray(rosterMembers) ? rosterMembers : null;
    const current = supplied ? { members: new Map(supplied.map(member => [member.id, { id: member.id, name: member.name, title: member.title }])) } : await roster();
    if (!state.baseline) captureBaseline(current);
    state.needsReconcile = true;
    persist();
    await applyDesiredTitles(desiredTitles(), '盟主身份初始化，应用永久副盟');
    return snapshot();
  }

  function detach(client) {
    if (client && context?.client !== client) return;
    if (interval) clearInterval(interval);
    interval = null;
    context = null;
  }

  function snapshot() {
    return {
      enabled: settings.enabled,
      active: active(),
      commandWindow: `${settings.commandStart}-${settings.commandEnd}`,
      leaseSeconds: settings.leaseSeconds,
      restoreAt: settings.restoreAt,
      allowedMemberCount: settings.allowedMemberIds.length,
      protectedMemberCount: settings.protectedMemberIds.length,
      permanentViceMemberCount: settings.permanentViceMemberIds.length,
      permanentViceDonorIds: [...state.permanentViceDonorIds],
      transferAfterRestore: settings.transferAfterRestore,
      transferTargetId: settings.transferTargetId,
      baseline: state.baseline ? { day: state.baseline.day, capturedAt: state.baseline.capturedAt, memberCount: state.baseline.members.length } : null,
      queue: state.queue.map(row => ({ ...row, gameTime: new Date(row.gameTimestamp * 1000).toISOString(), localTime: new Date(row.localReceivedAt).toISOString() })),
      leases: state.leases.map(row => ({ ...row, expiresTime: new Date(row.expiresAt).toISOString() })),
      needsReconcile: state.needsReconcile,
      pendingTransfer: state.pendingTransfer ? { ...state.pendingTransfer } : null,
      processedCount: state.processed.length,
    };
  }

  function updateTimer() {
    if (interval) clearInterval(interval);
    interval = null;
    if (timers && context && settings.enabled) {
      interval = setInterval(kick, 1000);
      interval.unref?.();
    }
  }

  function configure(next) {
    settings = normalizeGuildRoleSettings(next, settings);
    if (state.pendingTransfer && (!settings.transferAfterRestore || settings.transferTargetId !== state.pendingTransfer.targetId)) {
      state.pendingTransfer = null;
      persist();
    }
    updateTimer();
    kick();
    return snapshot();
  }

  async function restoreNow() {
    if (!context?.client) throw new Error('账号尚未连接，不能恢复联盟职位');
    if (!state.baseline) return { ok: true, restored: false };
    const day = state.baseline.day;
    await context.schedule(() => restoreBaseline(day, '手动立即恢复'));
    return { ok: true, restored: true };
  }

  return { attach, detach, receive, flush: kick, snapshot, configure, initializeLeadership, restoreNow, stateFile: file };
}
