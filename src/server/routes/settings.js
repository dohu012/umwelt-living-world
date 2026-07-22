import { Router } from 'express';
import { KINDS, USER_KINDS, KIND_LABELS } from '../../settings/ProviderSettingsStore.js';

export function settingsRouter(providerSettingsStore) {
  const router = Router();

  router.get('/providers', (req, res) => {
    const labels = Object.fromEntries(USER_KINDS.map((k) => [k, KIND_LABELS[k]]));
    res.json({
      providers: providerSettingsStore.list(),
      activeByKind: providerSettingsStore.getActiveByKind(),
      // Compat for older UI / dashboard checks
      activeId: providerSettingsStore.getActiveId(),
      kinds: USER_KINDS,
      kindLabels: labels,
    });
  });

  router.post('/providers', (req, res) => {
    const { name, baseUrl, model, kind } = req.body ?? {};
    if (!name || !baseUrl || !model) {
      return res.status(400).json({ error: 'name, baseUrl, and model are required' });
    }
    if (kind && !USER_KINDS.includes(kind)) {
      return res.status(400).json({ error: `unknown kind "${kind}", expected one of ${USER_KINDS.join(', ')}` });
    }
    res.status(201).json(providerSettingsStore.create(req.body));
  });

  router.put('/providers/:id', (req, res) => {
    try {
      res.json(providerSettingsStore.update(req.params.id, req.body ?? {}));
    } catch (err) {
      const status = /unknown kind/.test(err.message) ? 400 : 404;
      res.status(status).json({ error: err.message });
    }
  });

  router.delete('/providers/:id', (req, res) => {
    providerSettingsStore.remove(req.params.id);
    res.status(204).end();
  });

  /** Enable this provider for its own kind (other kinds stay enabled). */
  router.post('/providers/:id/activate', (req, res) => {
    try {
      // Optional ?role= overrides kind pin (legacy); default uses the provider's kind.
      const role = req.query.role;
      if (role) {
        if (!KINDS.includes(role) && role !== 'character') {
          return res.status(400).json({ error: `unknown kind "${role}", expected one of ${KINDS.join(', ')}` });
        }
        const kind = role === 'character' ? 'dialogue' : role;
        res.json(providerSettingsStore.setActiveForRole(kind, req.params.id));
      } else {
        res.json(providerSettingsStore.setActive(req.params.id));
      }
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post('/providers/:id/deactivate', (req, res) => {
    try {
      res.json(providerSettingsStore.deactivate(req.params.id));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get('/providers/active', (req, res) => {
    const role = req.query.role ?? 'dialogue';
    const kind = role === 'character' ? 'dialogue' : role;
    if (!KINDS.includes(kind)) {
      return res.status(400).json({ error: `unknown kind "${role}", expected one of ${KINDS.join(', ')}` });
    }
    const activeId = providerSettingsStore.getActiveIdForKind(kind);
    const active = activeId ? providerSettingsStore.getMasked(activeId) : null;
    res.json({ active, kind });
  });

  return router;
}
