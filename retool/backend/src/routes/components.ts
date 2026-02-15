import { Router, Request, Response } from 'express';
import { componentRegistry } from '../services/componentRegistry.js';

const router = Router();

// GET /api/components - Get all component definitions
router.get('/', (_req: Request, res: Response) => {
  res.json({ components: componentRegistry });
});

// GET /api/components/:type - Get a specific component definition
router.get('/:type', (req: Request, res: Response) => {
  const component = componentRegistry.find((c) => c.type === req.params.type);
  if (!component) {
    res.status(404).json({ error: 'Component type not found' });
    return;
  }
  res.json({ component });
});

export default router;
