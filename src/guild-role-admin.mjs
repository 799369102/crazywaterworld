const PRESIDENT = 5;

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
async function readRawRoster(client, player) {
  const [info, reply] = await Promise.all([
    client.request('GuildInfoRequest', {}, 'GuildInfoResponse'),
    client.request('GuildMemberRequest', {}, 'GuildMemberResponse'),
  ]);
  const playerGuildId = idText(player?.guildId);
  const responseGuildId = idText(info?.guild?.guildId);
  if (!playerGuildId || playerGuildId !== responseGuildId) throw new Error('联盟身份已变化，请重新读取成员名单');
  if (!Array.isArray(reply?.titleList)) throw new Error('服务器未返回完整联盟成员列表');
  const members = new Map();
  for (const group of reply.titleList) {
    if (!Array.isArray(group.members)) throw new Error('联盟成员职位分组不完整');
    if (![2, 3, 4, 5].includes(group.guildTitle)) continue;
    for (const member of group.members) {
      const id = idText(member.playerId);
      const name = typeof member.nickname === 'string' ? member.nickname.trim() : '';
      if (!id || !name) throw new Error('联盟成员身份未能精确读取');
      if (members.has(id)) throw new Error('联盟成员列表存在重复 ID');
      members.set(id, { id, name, title: group.guildTitle, online: member.online === true });
    }
  }
  return { info, members, total: Number.isSafeInteger(reply.total) ? reply.total : members.size };
}

export async function readGuildRoleMembers(client, player) {
  const current = await readRawRoster(client, player);
  return {
    guildId: idText(current.info.guild.guildId),
    guildName: current.info.guild.name || '当前联盟',
    myTitle: current.info.myTitle,
    canManage: current.info.myTitle === PRESIDENT,
    total: current.total,
    checkedAt: new Date().toISOString(),
    members: [...current.members.values()].sort((a, b) => b.title - a.title || Number(b.online) - Number(a.online)
      || a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id)),
  };
}

export function validateGuildRolePreconfiguration(roster, settings) {
  const members = new Map((roster?.members || []).map(member => [member.id, member]));
  for (const id of settings.allowedMemberIds || []) {
    if (!members.has(id)) throw new Error('允许发指令名单中有成员已离盟');
  }
  for (const id of settings.protectedMemberIds || []) {
    if (!members.has(id)) throw new Error('精英优先名单中有成员已离盟');
  }
  for (const id of settings.permanentViceMemberIds || []) {
    if (!members.has(id)) throw new Error('永久副盟名单中有成员已离盟');
  }
  if (settings.transferTargetId && !members.has(settings.transferTargetId)) throw new Error('盟主转让目标已离盟');
  return { canManage: roster?.canManage === true, memberCount: members.size };
}

export async function previewGuildPresidentTransfer(client, player, {
  targetId,
  expectedNickname,
  enabled = () => true,
} = {}) {
  const id = idText(targetId);
  if (!id) throw new Error('请选择要转让盟主的成员');
  if (!enabled()) throw new Error('账号连接已变化，请重新操作');
  const before = await readRawRoster(client, player);
  const target = before.members.get(id);
  if (!target) throw new Error('目标成员已经不在当前联盟');
  if (String(expectedNickname ?? '') !== target.name) throw new Error('确认昵称与目标成员不一致');
  if (target.title === PRESIDENT && before.info.myTitle !== PRESIDENT) {
    return { ok: true, targetId: id, nickname: target.name, myTitle: before.info.myTitle, alreadyTransferred: true };
  }
  if (before.info.myTitle !== PRESIDENT) throw new Error('当前托管账号不是盟主，不能转让盟主');
  if (target.title === PRESIDENT) throw new Error('目标成员已经是盟主');
  if (!enabled()) throw new Error('账号连接已变化，请重新操作');
  return { targetId: id, nickname: target.name };
}

export async function transferGuildPresident(client, player, {
  targetId, expectedNickname, enabled = () => true,
  wait = delay => new Promise(resolve => setTimeout(resolve, delay)),
} = {}) {
  const preview = await previewGuildPresidentTransfer(client, player, { targetId, expectedNickname, enabled });
  if (preview.alreadyTransferred) return preview;
  const id = preview.targetId;
  if (!enabled()) throw new Error('账号连接已变化，请重新操作');
  await client.sendWatch('ChangeGuildMemberTitleRequest', { memberId: id, title: PRESIDENT }, { window: 800 });
  for (const delay of [250, 500, 1000]) {
    await wait(delay);
    const after = await readRawRoster(client, player);
    if (after.members.get(id)?.title === PRESIDENT && after.info.myTitle !== PRESIDENT) {
      return { ok: true, targetId: id, nickname: preview.nickname, myTitle: after.info.myTitle };
    }
  }
  throw Object.assign(new Error('盟主转让请求已发送，但成员列表尚未确认结果，请立即进游戏核对'), { resultUnknown: true });
}
