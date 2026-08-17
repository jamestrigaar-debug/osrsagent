import { listAccounts, loadMemory, updateMemory, closeMemoryStore } from '../memory/store.js';
import { Dispatcher } from '../dispatcher/dispatcher.js';
import { Planner } from '../planner/planner.js';
import { startDashboard } from '../dashboard/server.js';
import { logger } from '../logger.js';

export interface OrchestratorOptions {
  dispatchInterval?: number; // ms between dispatcher ticks (default 500)
  dashboardPort?: number;    // set 0 to disable
  accountIds?: string[];     // explicit accounts; defaults to all in memory store
}

/**
 * Main orchestrator — starts the Dispatcher loop over all accounts and optionally
 * starts the local dashboard.
 */
export class Orchestrator {
  private options: Required<OrchestratorOptions>;
  private dispatcher: Dispatcher;
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: OrchestratorOptions = {}) {
    this.options = {
      dispatchInterval: options.dispatchInterval ?? 500,
      dashboardPort: options.dashboardPort ?? 4000,
      accountIds: options.accountIds ?? [],
    };
    this.dispatcher = new Dispatcher(new Planner());
  }

  /**
   * Ensure at least one account exists in the store.
   */
  private ensureAccounts(botName: string): string[] {
    let ids = this.options.accountIds.length > 0
      ? this.options.accountIds
      : listAccounts();

    if (ids.length === 0) {
      // Bootstrap default account from config
      loadMemory(botName);
      ids = [botName];
    }
    return ids;
  }

  /**
   * Start the orchestration loop.
   */
  start(botName: string, goal?: string): void {
    if (this.running) return;
    this.running = true;

    const accountIds = this.ensureAccounts(botName);

    // Inject initial goal if provided
    if (goal) {
      for (const id of accountIds) {
        updateMemory(id, { currentGoal: goal });
        logger.info({ accountId: id, goal }, 'Orchestrator: initial goal set');
      }
    }

    // Start dashboard
    if (this.options.dashboardPort > 0) {
      startDashboard(this.options.dashboardPort);
    }

    logger.info({ accounts: accountIds, interval: this.options.dispatchInterval }, 'Orchestrator started');

    this.timer = setInterval(async () => {
      for (const accountId of accountIds) {
        try {
          const result = await this.dispatcher.tick(accountId);
          if (result.status !== 'ok' && result.status !== 'no_goal') {
            logger.info({ accountId, result }, 'Dispatcher tick result');
          }
        } catch (err) {
          logger.error({ err, accountId }, 'Dispatcher tick error');
        }
      }
    }, this.options.dispatchInterval);
  }

  /**
   * Stop the orchestration loop and close resources.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    closeMemoryStore();
    logger.info('Orchestrator stopped');
  }
}
