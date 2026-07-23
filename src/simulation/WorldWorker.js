export class WorldWorker {
  constructor(worldRegistry, {
    intervalMs = 10_000,
    onError = console.error,
    runWorld = (_worldId, job) => job(),
  } = {}) {
    this.worldRegistry = worldRegistry;
    this.intervalMs = intervalMs;
    this.onError = onError;
    this.runWorld = runWorld;
    this.timer = null;
    this.running = false;
  }

  async tickOnce() {
    if (this.running) return [];
    this.running = true;
    try {
      // Worlds have separate databases and locks. Run them concurrently so a slow provider in
      // one world never delays unrelated worlds.
      return await Promise.all(this.worldRegistry.listWorldIds().map(async (worldId) => {
        try {
          const { engine } = this.worldRegistry.getWorld(worldId);
          const result = await this.runWorld(worldId, () => engine.tick());
          return { worldId, ok: true, ...result };
        } catch (error) {
          // One corrupt world or unavailable model must not starve every world after it.
          this.onError(error, { worldId });
          return { worldId, ok: false, error: error.message };
        }
      }));
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) return;
    // Wake persisted work immediately after a restart instead of waiting for the first interval.
    this.tickOnce().catch(this.onError);
    this.timer = setInterval(() => this.tickOnce().catch(this.onError), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
