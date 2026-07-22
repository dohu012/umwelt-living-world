export class SimulationLoop {
  constructor({ store, scheduler, turnRunner }) {
    this.store = store;
    this.scheduler = scheduler;
    this.turnRunner = turnRunner;
  }

  async run(totalRounds, { onSlot } = {}) {
    const slots = this.scheduler.buildSchedule(totalRounds);
    for (const slot of slots) {
      if (slot.kind === 'director') {
        const result = this._runDirectorSlot(slot.round);
        onSlot?.(slot, result);
      } else {
        const result = await this.turnRunner.runTurn(slot.agentId);
        onSlot?.(slot, result);
      }
    }
  }

  /** Bare placeholder this phase — real world-event content lands in milestones 3-4. */
  _runDirectorSlot(round) {
    return this.store.append(
      {
        type: 'system',
        actor: 'system',
        content: `Director checkpoint (round ${round}).`,
      },
      ['global'],
    );
  }
}
