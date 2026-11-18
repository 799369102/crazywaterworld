// Background ownership checks are independent of the web page and never reconnect an account.
export function createGuildRoleMonitor({ client, isCurrent, readRoster, onRoster, initialize, revoke,
  onError = () => {}, afterCheck = () => {}, pollMs = 15000, debounceMs = 200, timers = true }) {
  let stopped = false, running = null, dirty = false, debounce = null, interval = null;
  const usable = () => !stopped && isCurrent() && client.connected !== false;
  async function check() {
    do {
      dirty = false;
      if (!usable()) return;
      try {
        let roster = await readRoster();
        if (!usable()) return;
        onRoster(roster);
        if (roster.canManage) {
          await initialize(roster);
          if (!usable()) return;
          // Mutations must be reflected by the roster returned to the page.
          roster = await readRoster();
          if (!usable()) return;
          onRoster(roster);
        }
        afterCheck();
      } catch (error) {
        if (usable()) { revoke(); onError(error); }
      }
    } while (dirty && usable());
  }
  function refresh() {
    if (running) { dirty = true; return running; }
    clearTimeout(debounce); debounce = null;
    running = check().finally(() => { running = null; });
    return running;
  }
  function invalidate() {
    if (!usable() || debounce) return;
    debounce = setTimeout(() => { debounce = null; void refresh(); }, debounceMs);
    debounce.unref?.();
  }
  function message({ name, body }) {
    if (!usable() || !['SCGuildMemberTitleChange', 'SCGuildChanged', 'SCJoinGuild', 'SCLeaveGuild'].includes(name)) return;
    // Revoke immediately; a fresh full roster is required before another write.
    if (name !== 'SCGuildMemberTitleChange' || Number(body?.title) !== 5) revoke();
    invalidate();
  }
  function stop() {
    stopped = true; clearTimeout(debounce); clearInterval(interval);
    client.off('message', message); client.off('close', stop);
    revoke();
  }
  client.on('message', message);
  client.once('close', stop);
  if (timers) { interval = setInterval(invalidate, pollMs); interval.unref?.(); invalidate(); }
  return { refresh, invalidate, stop };
}
