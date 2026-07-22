export class WorldEngine {
  constructor({ clock, queue, worldEvents }) {
    this.clock = clock;
    this.queue = queue;
    this.worldEvents = worldEvents;
  }

  async tick({ limit = 100 } = {}) {
    const clock = this.clock.synchronize();
    const due = this.queue.listDue(clock.worldTime, { limit });
    const results = [];
    for (const job of due) {
      if (!this.queue.markRunning(job.id)) continue;
      try {
        let result;
        if (job.type === 'world_event_phase') {
          result = this.worldEvents.handlePhase(job.payload, clock.worldTime);
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
    return { clock, processed: results.length, results };
  }
}
