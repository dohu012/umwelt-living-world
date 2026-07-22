import { Router } from 'express';

/**
 * The player's own cross-location history — everything they were actually present to witness, in
 * order, regardless of which room it happened in. Works because every event a persona witnesses
 * gets tagged `private:<personaId>` at write time (see InteractivePlay.appendPlayerMessage,
 * TurnRunner.runTurn, NarratorRunner.runNarratorTurn — all take a witnessIds list), so this is a
 * single exact-tag query, not a per-room fan-out: naturally bounded to the presence window (a room
 * the player has since left, or hasn't arrived at yet, was never tagged with their id), no separate
 * "were they there" filtering needed.
 */
export function timelineRouter(worldRegistry) {
  const router = Router({ mergeParams: true });

  router.get('/timeline', (req, res) => {
    const { worldId, personaId } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    const { store } = worldRegistry.getWorld(worldId);
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const afterEventId = req.query.afterEventId ? Number(req.query.afterEventId) : 0;
    const events = store.getEventsByTagPrefix(`private:${personaId}`, { limit, afterEventId });
    res.json({ personaId, events });
  });

  return router;
}
