export class WorldWorker {
  constructor(worldRegistry, { intervalMs = 10_000, onError = console.error } = {}) {
    this.worldRegistry = worldRegistry;
    this.intervalMs = intervalMs;
    this.onError = onError;
    this.timer = null;
    this.running = false;
  }

  async tickOnce() {
    if (this.running) return [];
    this.running = true;
    try {
      const results = [];
      for (const worldId of this.worldRegistry.listWorldIds()) {
        const { engine } = this.worldRegistry.getWorld(worldId);
        results.push({ worldId, ...(await engine.tick()) });
      }
      return results;
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tickOnce().catch(this.onError), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
