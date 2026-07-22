import { Router } from 'express';

const HOUR = 60 * 60 * 1000;

export function simulationRouter(worldRegistry) {
  const router = Router({ mergeParams: true });

  function world(req, res) {
    if (!worldRegistry.worldExists(req.params.worldId)) {
      res.status(404).json({ error: `world "${req.params.worldId}" not found` });
      return null;
    }
    return worldRegistry.getWorld(req.params.worldId);
  }

  router.get('/clock', (req, res) => {
    const current = world(req, res);
    if (current) res.json(current.clock.getState());
  });

  router.post('/clock', (req, res) => {
    const current = world(req, res);
    if (!current) return;
    try {
      const { action, timeScale, hours } = req.body ?? {};
      let state;
      if (action === 'pause') state = current.clock.setStatus('paused');
      else if (action === 'resume') state = current.clock.setStatus('running');
      else if (action === 'advance') state = current.clock.advanceBy(Number(hours) * HOUR);
      else if (action === 'set_scale') state = current.clock.setTimeScale(timeScale);
      else return res.status(400).json({ error: 'action must be pause, resume, advance, or set_scale' });
      res.json(state);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/events', (req, res) => {
    const current = world(req, res);
    if (current) res.json({ events: current.worldEvents.list() });
  });

  router.post('/events', (req, res) => {
    const current = world(req, res);
    if (!current) return;
    try {
      const event = current.worldEvents.schedule(req.body ?? {});
      res.status(201).json(event);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/decisions', (req, res) => {
    const current = world(req, res);
    if (current) res.json({ decisions: current.decisions.listOpen() });
  });

  router.post('/decisions/:decisionId/suggestions', (req, res) => {
    const current = world(req, res);
    if (!current) return;
    try {
      const decision = current.decisions.suggest(Number(req.params.decisionId), req.body ?? {});
      res.status(201).json(decision);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/tick', async (req, res, next) => {
    const current = world(req, res);
    if (!current) return;
    try {
      res.json(await current.engine.tick());
    } catch (error) {
      next(error);
    }
  });

  return router;
}
