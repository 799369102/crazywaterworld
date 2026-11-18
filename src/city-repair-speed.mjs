import { exactAutomationId } from './automation-policy.mjs';
import { rewardData } from './missing-rewards.mjs';
import { settleFleetSnapshot } from './fleet-settlement.mjs';
import { siliconRepairDiamondCost, watchSiliconMining } from './silicon-mining.mjs';

const active = new WeakSet(), refusals = new WeakMap();
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const nowOf = client => Math.floor((Date.now() + (client.serverClockOffsetMs || 0)) / 1000);
const dayOf = time => Math.floor((time + 28800) / 86400);
const identity = player => [player?.worldId, player?.playerId, player?.guildId].map(exactAutomationId).join(':');
const permitted = settings => settings?.cityWar?.enabled && settings.cityWar.autoRepair && settings.cityWar.repairSpeedUp;

// 普通维修与加速分别留账。只有已确认的工具城战维修可以花钻加速。
export async function runCityRepairSpeed(client, protocol, config, player, { getSettings, ledger, enabled = () => true, onStep } = {}) {
  const result = { results: [], fleets: null };
  if (!permitted(getSettings?.()) || !enabled() || !client.connected || active.has(client)) return result;
  if (!protocol?.SpeedUpRepairRequest || !protocol?.SpeedUpCost?.SPEED_UP_RUBY || !config || !ledger) return result;
  const worldId = exactAutomationId(player?.worldId), playerId = exactAutomationId(player?.playerId), who = identity(player);
  if (!worldId || !playerId || !exactAutomationId(player?.guildId)) return result;
  active.add(client);
  const watcher = watchSiliconMining(client), failures = refusals.get(client) ?? new Map();
  refusals.set(client, failures);
  const read = async name => rewardData(await client.request(name + 'Request', {}, name + 'Response', 8000));
  let remainingRuby = Infinity;
  try {
    for (const buildingId of getSettings().cityWar.fleetIds) {
      const settings = getSettings(), p = settings.cityWar, resources = settings.resources;
      const allowed = () => enabled() && client.connected && getSettings() === settings && identity(player) === who && permitted(settings);
      if (!allowed()) break;
      if (!resources?.allowDiamonds || !integer(resources.diamondDailyLimit, 1) || !integer(resources.diamondThreshold) ||
          !integer(p.maxRepairSpeedDiamondCost, 1) || !integer(p.dailyRepairSpeedDiamondLimit, 1)) continue;
      const repairKey = 'cityWar:' + worldId + ':' + buildingId.replace('远征船', '');
      const prior = ledger.keyRecords()[repairKey];
      if (!prior?.confirmed || prior.expired || prior.details?.kind !== 'cityRepair' || prior.details.buildingId !== buildingId) continue;
      const uniqueKey = 'cityRepairSpeed:' + worldId + ':' + buildingId.replace('远征船', '') + ':' + prior.id;
      const step = { kind: 'cityRepairSpeed', request: 'SpeedUpRepairRequest', buildingId, uniqueKey, label: buildingId + '城战维修加速' };
      const report = entry => { const item = { step, ...entry }; result.results.push(item); onStep?.(item); };
      try {
        const baseline = ledger.keyRecords(), confirmedBefore = ledger.confirmedCounters().diamonds ?? 0;
        const [war, own, balance, merge] = await Promise.all([read('WarDeclaration'), read('MyFleets'), read('AllResource'), read('UniteWorldsPlan')]);
        const now = nowOf(client), today = dayOf(now);
        if (!allowed()) break;
        result.fleets = own.fleets;
        settleFleetSnapshot(ledger, { worldId, fleets: own.fleets, now, baseline, kinds: ['cityRepair', 'cityRepairSpeed'] });
        if (ledger.hasKey(uniqueKey)) continue;
        const current = ledger.keyRecords()[repairKey];
        if (!current?.confirmed || current.id !== prior.id) continue;
        const matches = own.fleets?.filter(fleet => fleet.buildingId === buildingId), fleet = matches?.[0];
        if (matches?.length !== 1 || fleet.owner && exactAutomationId(fleet.owner.playerId) !== playerId) continue;
        const repair = fleet.repairing;
        if (fleet.state !== 4 || !integer(repair?.startTs, 1) || !integer(repair.endTs, now + 1) ||
            !integer(fleet.maxDura, 1) || !integer(prior.details.sentAt, 1) ||
            repair.startTs < prior.details.sentAt - 2 || repair.startTs > prior.details.sentAt + 60) continue;
        if (!integer(war.startTime, 1) || !integer(war.endTime, war.startTime + 1) ||
            now < war.startTime || now >= war.endTime || prior.details.sentAt < war.startTime || prior.details.sentAt >= war.endTime) {
          report({ skipped: true, reason: '仅在服务器城战时段内加速本场城战产生的维修' }); continue;
        }
        if (!Array.isArray(merge.worldIds) || merge.matchMaking || merge.worldIds.length && merge.executeTs > 0 &&
            (now >= merge.executeTs - 3600 || dayOf(now) === dayOf(merge.executeTs))) {
          report({ skipped: true, reason: '合服状态未确认或匹配/执行期间暂停城战维修加速' }); continue;
        }
        const cost = siliconRepairDiamondCost(config, Math.ceil((repair.endTs - now) / 60), watcher.repairMinutes());
        if (!integer(cost, 1)) { report({ skipped: true, reason: '维修加速价格未确认' }); continue; }
        step.cost = cost; step.costs = [{ id: '钻石', num: cost }];
        if (cost > p.maxRepairSpeedDiamondCost) { report({ skipped: true, reason: '维修加速费用超过单次钻石上限' }); continue; }
        const rubyRows = balance.list?.filter(row => row.res === 4), ruby = rubyRows?.[0]?.amount;
        const pending = ledger.pendingCounters().diamonds ?? 0, spentSinceRead = (ledger.confirmedCounters().diamonds ?? 0) - confirmedBefore;
        if (rubyRows?.length !== 1 || !integer(ruby) || !integer(pending) || !integer(spentSinceRead)) {
          report({ skipped: true, reason: '钻石余额或待确认费用未同步' }); continue;
        }
        remainingRuby = Math.min(remainingRuby, ruby - spentSinceRead);
        if (remainingRuby - pending - cost < resources.diamondThreshold) { report({ skipped: true, reason: '钻石不足或会低于钻石保留量' }); continue; }
        const signature = JSON.stringify([prior.id, repair.startTs, repair.endTs, cost, ruby, p, resources]);
        const failure = failures.get(uniqueKey);
        if (failure?.until > Date.now() && failure.signature === signature) continue;
        // 最后回读舰队后再核对时段；换号、暂停、改配置或换日都取消。
        const fresh = await read('MyFleets'), check = fresh.fleets?.filter(row => row.buildingId === buildingId);
        const currentRepair = ledger.keyRecords()[repairKey];
        if (!allowed() || dayOf(nowOf(client)) !== today || nowOf(client) >= war.endTime || nowOf(client) >= repair.endTs ||
            check?.length !== 1 || check[0].owner && exactAutomationId(check[0].owner.playerId) !== playerId || check[0].state !== 4 || check[0].repairing?.startTs !== repair.startTs ||
            check[0].repairing?.endTs !== repair.endTs || !p.fleetIds.includes(buildingId) || currentRepair?.id !== prior.id || !currentRepair.confirmed) continue;
        const reviewedCost = siliconRepairDiamondCost(config, Math.ceil((repair.endTs - nowOf(client)) / 60), watcher.repairMinutes());
        if (!integer(reviewedCost, 1) || reviewedCost > cost) continue;
        const details = { kind: step.kind, buildingId, repairId: prior.id, repairStart: repair.startTs, beforeEnd: repair.endTs,
          targetDurability: fleet.maxDura, sentAt: nowOf(client) };
        const ticket = ledger.reserve({ diamonds: cost, cityRepairSpeedDiamonds: cost },
          { diamonds: resources.diamondDailyLimit, cityRepairSpeedDiamonds: p.dailyRepairSpeedDiamondLimit }, {}, { uniqueKey, details });
        if (!allowed() || dayOf(nowOf(client)) !== today || nowOf(client) >= war.endTime) { ledger.cancel(ticket); break; }
        step.body = { buildingId, speedUp: { type: protocol.SpeedUpCost.SPEED_UP_RUBY, useNum: 0 } };
        try {
          watcher.invalidateRepairMinutes();
          await client.sendWatch(step.request, step.body, { window: 600 });
          remainingRuby -= cost;
          const afterBaseline = ledger.keyRecords(), after = await read('MyFleets');
          if (identity(player) !== who) throw Error('维修加速后角色已切换，保留待确认费用');
          result.fleets = after.fleets;
          settleFleetSnapshot(ledger, { worldId, fleets: after.fleets, now: nowOf(client), baseline: afterBaseline, kinds: ['cityRepairSpeed', 'cityRepair'] });
          const record = ledger.keyRecords()[uniqueKey], confirmed = !record || record.confirmed;
          report({ ok: confirmed, status: confirmed ? 'confirmed' : 'unknown', note: confirmed ? '服务器已确认城战维修加速，按最新舰队状态继续出战' : '加速结果待确认，保留钻石预算和舰队锁，不重复发送' });
          if (!confirmed) break;
        } catch (error) {
          const rejected = error.prompt && error.request === step.request;
          if (rejected || error.notSent && error.request === step.request) {
            ledger.cancel(ticket); failures.set(uniqueKey, { signature, until: Date.now() + 300000 });
          }
          report({ ok: false, status: rejected || error.notSent && error.request === step.request ? 'rejected' : 'unknown', error: error.message });
          break;
        }
      } catch (error) { report({ skipped: true, reason: error.message.replaceAll('cityRepairSpeedDiamonds', '城战维修加速钻石') }); }
    }
    return result;
  } finally { active.delete(client); }
}
