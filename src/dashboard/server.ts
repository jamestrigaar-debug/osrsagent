import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadMemory, updateMemory, listAccounts } from '../memory/store.js';
import { flagUserRequest } from '../dispatcher/escalation.js';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createDashboardApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // ── Memory API ──────────────────────────────────────────────────────────────

  app.get('/api/accounts', (_req: Request, res: Response) => {
    res.json(listAccounts());
  });

  app.get('/api/memory/:accountId', (req: Request, res: Response) => {
    const mem = loadMemory(req.params['accountId'] as string);
    res.json(mem);
  });

  // ── Goal injection ──────────────────────────────────────────────────────────

  app.post('/api/goal', (req: Request, res: Response) => {
    const { accountId, goal } = req.body as { accountId: string; goal: string };
    if (!accountId || !goal) {
      res.status(400).json({ error: 'accountId and goal are required' });
      return;
    }
    flagUserRequest(accountId, goal);
    logger.info({ accountId, goal }, 'Dashboard: goal injected');
    res.json({ ok: true, message: `Goal set for ${accountId}: ${goal}` });
  });

  // ── Manual memory patch ─────────────────────────────────────────────────────

  app.patch('/api/memory/:accountId', (req: Request, res: Response) => {
    const updates = req.body as Record<string, unknown>;
    const mem = updateMemory(req.params['accountId'] as string, updates);
    res.json(mem);
  });

  // ── Serve frontend ──────────────────────────────────────────────────────────

  app.get('/', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

export function startDashboard(port: number = 4000): void {
  const app = createDashboardApp();
  app.listen(port, () => {
    logger.info({ port }, `Dashboard running at http://localhost:${port}`);
  });
}
