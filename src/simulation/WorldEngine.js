export class WorldEngine {
  constructor({
    clock, queue, worldEvents, lifeSimulator = null, autonomousScenes = null, sceneScheduler = null,
    sceneRetryMinutes = 5,
  }) {
    this.clock = clock;
    this.queue = queue;
    this.worldEvents = worldEvents;
    this.lifeSimulator = lifeSimulator;
    this.autonomousScenes = autonomousScenes;
    this.sceneScheduler = sceneScheduler;
    this.sceneRetryMs = Math.max(1, Number(sceneRetryMinutes) || 5) * 60 * 1000;
  }

  async tick({ limit = 100 } = {}) {
    const clock = this.clock.synchronize();
    const results = await this._processDue(clock.worldTime, limit);
    const life = this.lifeSimulator?.advanceTo(clock.worldTime) ?? null;
    const scheduledScenes = this.sceneScheduler?.scheduleFromLife(life, clock.worldTime) ?? [];
    // Scene jobs created from this life step are already due. Execute them now so a manual
    // “同步” is one complete operation instead of secretly requiring a second click/worker tick.
    if (scheduledScenes.length > 0) {
      results.push(...await this._processDue(clock.worldTime, limit));
    }
    return { clock, processed: results.length, results, life, scheduledScenes: scheduledScenes.length };
  }

  async _processDue(worldTime, limit) {
    const due = this.queue.listDue(worldTime, { limit });
    const results = [];
    for (const job of due) {
      if (!this.queue.markRunning(job.id)) continue;
      try {
        let result;
        if (job.type === 'world_event_phase') {
          result = this.worldEvents.handlePhase(job.payload, worldTime);
        } else if (job.type === 'world_will_step') {
          result = this.worldEvents.handlePlannedStep(job.payload, worldTime);
        } else if (job.type === 'autonomous_scene') {
          if (!this.autonomousScenes) throw new Error('autonomous scene runner is not configured');
          result = await this.autonomousScenes.run(job.payload, worldTime);
        } else {
          throw new Error(`no handler for job type "${job.type}"`);
        }
        this.queue.complete(job.id);
        if (job.type === 'autonomous_scene' && ['skipped', 'partial'].includes(result?.status)) {
          this.sceneScheduler?.release(job.payload?.location, job.payload?.triggeredAt);
        }
        results.push({ jobId: job.id, ok: true, result });
      } catch (error) {
        const retryAt = new Date(new Date(worldTime).getTime() + this.sceneRetryMs).toISOString();
        const retrying = job.type === 'autonomous_scene'
          && typeof this.queue.retry === 'function'
          && this.queue.retry(job.id, { runAt: retryAt, error });
        if (!retrying) {
          this.queue.fail(job.id, error);
          if (job.type === 'autonomous_scene') {
            this.sceneScheduler?.release(job.payload?.location, job.payload?.triggeredAt);
          }
        }
        results.push({
          jobId: job.id,
          ok: false,
          retrying,
          ...(retrying ? { retryAt } : {}),
          error: error.message,
        });
      }
    }
    return results;
  }
}
