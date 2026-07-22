export class TurnScheduler {
  constructor(agentOrder, { directorEveryNRounds = 0 } = {}) {
    if (!agentOrder || agentOrder.length === 0) {
      throw new Error('TurnScheduler requires a non-empty agentOrder');
    }
    this.agentOrder = agentOrder;
    this.directorEveryNRounds = directorEveryNRounds;
  }

  /** Fully deterministic — returns the whole schedule up front, not a stateful iterator. */
  buildSchedule(totalRounds) {
    const slots = [];
    for (let round = 1; round <= totalRounds; round++) {
      for (const agentId of this.agentOrder) {
        slots.push({ kind: 'agent', agentId, round });
      }
      if (this.directorEveryNRounds > 0 && round % this.directorEveryNRounds === 0) {
        slots.push({ kind: 'director', round });
      }
    }
    return slots;
  }
}
