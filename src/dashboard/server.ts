import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadMemory, updateMemory, listAccounts } from '../memory/store.js';
import { flagUserRequest } from '../dispatcher/escalation.js';
import { logger } from '../logger.js';
import type { CommandQueue } from '../queue/command-queue.js';
import type { AdapterPool } from '../adapters/adapter-pool.js';
import type { Command, CommandType } from '../queue/types.js';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createDashboardApp(
  queue?: CommandQueue | null,
  _adapterPool?: AdapterPool | null,
) {
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

  // ── Command queue ───────────────────────────────────────────────────────────

  if (queue) {
    /* GET /api/queue — list all pending commands */
    app.get('/api/queue', (_req: Request, res: Response) => {
      const commands = queue.list('pending');
      const state = queue.getState();
      res.json({ commands, state });
    });

    /* POST /api/queue/add — enqueue a new command */
    app.post('/api/queue/add', (req: Request, res: Response) => {
      const body = req.body as {
        type?: string;
        params?: Record<string, unknown>;
      };

      const type = (body.type ?? 'generic') as CommandType;
      const params = body.params ?? {};

      if (
        !['travel', 'gather', 'generic'].includes(type)
      ) {
        res.status(400).json({
          error: `Invalid command type: ${type}. Must be travel | gather | generic`,
        });
        return;
      }

      const command: Command = {
        id: randomUUID(),
        type,
        params,
        createdAt: Date.now(),
        status: 'pending',
      };

      queue.enqueue(command);

      logger.info(
        { id: command.id, type, params },
        'Dashboard: command enqueued',
      );

      res.status(201).json({ ok: true, command });
    });

    /* GET /api/queue/:id — get a single command */
    app.get('/api/queue/:id', (req: Request, res: Response) => {
      const command = queue.get(req.params['id'] as string);
      if (!command) {
        res.status(404).json({ error: 'Command not found' });
        return;
      }
      res.json(command);
    });

    /* PATCH /api/queue/:id — edit a pending command */
    app.patch('/api/queue/:id', (req: Request, res: Response) => {
      const id = req.params['id'] as string;
      const existing = queue.get(id);

      if (!existing) {
        res.status(404).json({ error: 'Command not found' });
        return;
      }

      if (existing.status !== 'pending') {
        res.status(409).json({
          error: `Cannot edit a command with status '${existing.status}'`,
        });
        return;
      }

      const updates = req.body as Partial<
        Pick<Command, 'type' | 'params'>
      >;

      queue.update(id, updates);

      const updated = queue.get(id);

      logger.info({ id, updates }, 'Dashboard: command updated');

      res.json({ ok: true, command: updated });
    });

    /* DELETE /api/queue/:id — remove a command */
    app.delete('/api/queue/:id', (req: Request, res: Response) => {
      const id = req.params['id'] as string;
      const existing = queue.get(id);

      if (!existing) {
        res.status(404).json({ error: 'Command not found' });
        return;
      }

      queue.remove(id);

      logger.info({ id }, 'Dashboard: command removed');

      res.json({ ok: true });
    });

    /* POST /api/queue/clear — remove all pending commands */
    app.post('/api/queue/clear', (_req: Request, res: Response) => {
      queue.clear();
      logger.info('Dashboard: queue cleared');
      res.json({ ok: true });
    });
  }

  // ── Plan re-planning ────────────────────────────────────────────────────────

  app.post('/api/plan/replan', (req: Request, res: Response) => {
    const { accountId } = req.body as { accountId: string };
    if (!accountId) {
      res.status(400).json({ error: 'accountId is required' });
      return;
    }

    /*
     * Force a re-plan by flagging a user request with the current goal.
     * The Dispatcher will clear the active plan and call the Planner on
     * the next tick.
     */
    const mem = loadMemory(accountId);
    const goal = mem.currentGoal;

    if (!goal) {
      res.status(400).json({ error: `No current goal for account ${accountId}` });
      return;
    }

    flagUserRequest(accountId, goal);

    logger.info({ accountId, goal }, 'Dashboard: re-plan requested');

    res.json({ ok: true, message: `Re-plan triggered for ${accountId}` });
  });

  // ── Adapter pool status ─────────────────────────────────────────────────────

  app.get('/api/pool', (_req: Request, res: Response) => {
    if (!_adapterPool) {
      res.json({ enabled: false });
      return;
    }
    res.json({
      enabled: true,
      size: _adapterPool.size(),
    });
  });

  // ── Serve frontend ──────────────────────────────────────────────────────────

  app.get('/', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

export function startDashboard(
  port: number = 4000,
  queue?: CommandQueue | null,
  adapterPool?: AdapterPool | null,
): void {
  const app = createDashboardApp(queue, adapterPool);
  app.listen(port, () => {
    logger.info({ port }, `Dashboard running at http://localhost:${port}`);
  });
}
