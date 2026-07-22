import { Router } from 'express';

export function messagesRouter(worldRegistry) {
  const router = Router({ mergeParams: true });

  router.get('/messages', (req, res) => {
    const { worldId, location } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    const { store, locationRegistry } = worldRegistry.getWorld(worldId);
    if (!locationRegistry.get(location)) {
      return res.status(404).json({ error: `no location "${location}" in world "${worldId}"` });
    }
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const afterEventId = req.query.afterEventId ? Number(req.query.afterEventId) : 0;
    const events = store.getEventsByTagPrefix(`local:${location}`, { limit, afterEventId });
    res.json({ location, events });
  });

  return router;
}
