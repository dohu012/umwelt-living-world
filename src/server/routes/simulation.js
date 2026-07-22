import { Router } from 'express';

const HOUR = 60 * 60 * 1000;

function parseEventData(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

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

  router.get('/environment', (req, res) => {
    const current = world(req, res);
    if (current) res.json({ environment: current.environment.list(req.query.scope ?? null) });
  });

  router.get('/history', (req, res) => {
    const current = world(req, res);
    if (!current) return;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
    const activityTypes = new Set(['life_action', 'decision_resolved', 'world_event', 'autonomous_scene']);
    const events = current.store.getEventsWithTags()
      .map((event) => ({
        ...event,
        data: parseEventData(event.data),
      }))
      .filter((event) => activityTypes.has(event.type) || event.data?.autonomous === true)
      .slice(-limit)
      .reverse();
    res.json({ events });
  });

  router.get('/agents', (req, res) => {
    const current = world(req, res);
    if (current) res.json({ agents: current.lifeSimulator.listAgents(current.clock.getState().worldTime) });
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

  router.post('/world-will', async (req, res, next) => {
    const current = world(req, res);
    if (!current) return;
    try {
      const result = await current.worldWillAgent.planAndSchedule({
        instruction: req.body?.instruction,
        worldTime: current.clock.getState().worldTime,
      });
      res.status(201).json(result);
    } catch (error) {
      if (/请描述|需要一个|计划|时间无效|缺少/.test(error.message)) {
        return res.status(400).json({ error: error.message });
      }
      if (/无法调用模型|unreachable/i.test(error.message)) {
        return res.status(502).json({ error: error.message });
      }
      next(error);
    }
  });

  router.get('/decisions', (req, res) => {
    const current = world(req, res);
    if (!current) return;
    const status = req.query.status ?? 'open';
    const decisions = status === 'open'
      ? current.decisions.listOpen()
      : current.decisions.list({ status: status === 'all' ? null : status });
    res.json({ decisions });
  });

  router.post('/decisions', (req, res) => {
    const current = world(req, res);
    if (!current) return;
    try {
      res.status(201).json(current.decisions.create(req.body ?? {}));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
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
