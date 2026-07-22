import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';

function avatarStorage(personasDir) {
  return multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(personasDir, req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      cb(null, `avatar${path.extname(file.originalname) || '.png'}`);
    },
  });
}

export function personasRouter(personaStore, { personasDir }) {
  const router = Router();
  const upload = multer({ storage: avatarStorage(personasDir), limits: { fileSize: 8 * 1024 * 1024 } });

  router.get('/', (req, res) => {
    res.json({ personas: personaStore.list() });
  });

  router.post('/', (req, res) => {
    const { name } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    res.status(201).json(personaStore.create(req.body));
  });

  router.put('/:id', (req, res) => {
    try {
      res.json(personaStore.update(req.params.id, req.body ?? {}));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  router.delete('/:id', (req, res) => {
    personaStore.remove(req.params.id);
    res.status(204).end();
  });

  router.post('/:id/avatar', upload.single('avatar'), (req, res) => {
    if (!personaStore.get(req.params.id)) {
      return res.status(404).json({ error: `no persona "${req.params.id}"` });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'avatar file is required (multipart field "avatar")' });
    }
    res.json(personaStore.setAvatar(req.params.id, req.file.filename));
  });

  return router;
}
