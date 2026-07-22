export class WorldEngine {
  constructor({ clock, queue, worldEvents, lifeSimulator = null, autonomousScenes = null, sceneScheduler = null }) {
    this.clock = clock;
    this.queue = queue;
    this.worldEvents = worldEvents;
    this.lifeSimulator = lifeSimulator;
    this.autonomousScenes = autonomousScenes;
    this.sceneScheduler = sceneScheduler;
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
        results.push({ jobId: job.id, ok: true, result });
      } catch (error) {
        this.queue.fail(job.id, error);
        results.push({ jobId: job.id, ok: false, error: error.message });
      }
    }
    return results;
  }
}
