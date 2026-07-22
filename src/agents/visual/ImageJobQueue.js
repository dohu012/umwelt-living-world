/**
 * Serial queue for image generation, kept deliberately separate from RoomManager's per-world turn
 * queue: a StepFun call takes tens of seconds, and running it on the turn queue is exactly what
 * made `scene_done` wait on a picture nobody was blocked on.
 *
 * Two guarantees:
 *  - **serial** — one generation at a time, so a room full of new characters doesn't fire six
 *    concurrent API calls
 *  - **in-flight dedupe by key** — two rooms (or a join racing a scene) asking for the same asset
 *    share one job instead of generating the same image twice
 */
export class ImageJobQueue {
  constructor() {
    this._tail = Promise.resolve();
    this._inflight = new Map(); // key -> Promise<result>
  }

  /** True while `key` is being generated — callers use this to avoid re-announcing a pending job. */
  isPending(key) {
    return this._inflight.has(key);
  }

  /**
   * Runs `job` once per key. A rejected job settles the chain without wedging it (same contract as
   * RoomManager._enqueue) and clears the key so a later attempt can retry.
   */
  enqueue(key, job) {
    const existing = this._inflight.get(key);
    if (existing) return existing;

    const run = this._tail.catch(() => {}).then(job);
    this._tail = run.catch(() => {});
    const tracked = run.finally(() => {
      // Only clear if we are still the current entry: a retry queued after this one finished
      // owns the key from that point on.
      if (this._inflight.get(key) === tracked) this._inflight.delete(key);
    });
    this._inflight.set(key, tracked);
    return tracked;
  }
}
