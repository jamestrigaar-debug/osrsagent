import {
  listAccounts,
  loadMemory,
  updateMemory,
  clearPlan,
  closeMemoryStore,
} from '../memory/store.js';

import {
  Dispatcher,
} from '../dispatcher/dispatcher.js';

import {
  Planner,
} from '../planner/planner.js';

import {
  startDashboard,
} from '../dashboard/server.js';

import {
  AdapterPool,
} from '../adapters/adapter-pool.js';

import {
  CommandQueue,
} from '../queue/command-queue.js';

import {
  config,
} from '../config/index.js';

import {
  logger,
} from '../logger.js';

export interface OrchestratorOptions {
  dispatchInterval?: number;

  dashboardPort?: number;

  accountIds?: string[];
}

/**
 * Main orchestrator.
 *
 * Phase 1 testing behaviour:
 *
 *   - Start with an explicit --goal:
 *       execute that goal.
 *
 *   - Start without --goal:
 *       do not automatically resurrect an old Phase 1 plan.
 *       The orchestrator waits for a new CLI `goal` command.
 *
 * This prevents an old mining/travel task from taking control after
 * restarting the development server.
 */
export class Orchestrator {
  private options:
    Required<OrchestratorOptions>;

  private dispatcher:
    Dispatcher;

  private adapterPool:
    AdapterPool;

  private commandQueue:
    CommandQueue;

  private running =
    false;

  private timer:
    ReturnType<typeof setInterval> |
    null =
      null;

  private tickInProgress =
    false;

  constructor(
    options:
      OrchestratorOptions = {},
  ) {
    this.options = {
      dispatchInterval:
        options.dispatchInterval ??
        500,

      dashboardPort:
        options.dashboardPort ??
        4000,

      accountIds:
        options.accountIds ??
        [],
    };

    this.adapterPool =
      new AdapterPool();

    this.commandQueue =
      new CommandQueue();

    this.dispatcher =
      new Dispatcher(
        new Planner(),
        this.commandQueue,
        this.adapterPool,
      );
  }

  /* ================================================================
   * ACCOUNT SETUP
   * ================================================================ */

  private ensureAccounts(
    botName:
      string,
  ): string[] {
    let ids =
      this.options
        .accountIds
        .length > 0
        ? [
            ...this.options
              .accountIds,
          ]
        : listAccounts();

    if (
      ids.length ===
      0
    ) {
      loadMemory(
        botName,
      );

      ids = [
        botName,
      ];
    }

    return ids;
  }

  /* ================================================================
   * START
   * ================================================================ */

  start(
    botName:
      string,

    goal?:
      string,
  ): void {
    if (
      this.running
    ) {
      return;
    }

    this.running =
      true;

    const accountIds =
      this.ensureAccounts(
        botName,
      );

    /*
     * ------------------------------------------------------------
     * ADAPTER POOL — pre-register connection options per account
     * ------------------------------------------------------------
     *
     * The pool will connect lazily on first use, but having the options
     * registered here means `getAdapter()` can be called without
     * passing options every time.
     */
    for (
      const accountId of
        accountIds
    ) {
      this.adapterPool.registerOptions(
        accountId,
        {
          server:
            config.rs_sdk.baseUrl,

          botName:
            config.bot.name,

          password:
            config.bot.password,
        },
      );
    }

    /*
     * ------------------------------------------------------------
     * INITIAL GOAL
     * ------------------------------------------------------------
     *
     * If the user supplied a goal on startup, explicitly replace
     * whatever was previously saved.
     */
    if (
      goal
    ) {
      for (
        const accountId of
          accountIds
      ) {
        clearPlan(
          accountId,
        );

        updateMemory(
          accountId,
          {
            currentGoal:
              goal,

            userRequest:
              goal,
          },
        );

        logger.info(
          {
            accountId,

            goal,
          },
          'Orchestrator: initial Phase 1 goal set',
        );
      }
    } else {
      /*
       * ----------------------------------------------------------
       * CLEAN START FOR PHASE 1 TESTING
       * ----------------------------------------------------------
       *
       * Do not resume a previously saved plan just because the
       * process was restarted.
       *
       * We deliberately leave currentGoal visible for status/debug,
       * but remove the stale active plan. A new `goal` command will
       * create the next plan.
       */
      for (
        const accountId of
          accountIds
      ) {
        const memory =
          loadMemory(
            accountId,
          );

        if (
          memory.activePlan
        ) {
          logger.info(
            {
              accountId,

              planId:
                memory.activePlan
                  .planId,
            },
            'Orchestrator: clearing stale plan on fresh start',
          );

          clearPlan(
            accountId,
          );
        }

        /*
         * A previous user request should also not survive a restart
         * unexpectedly.
         */
        if (
          memory.userRequest
        ) {
          updateMemory(
            accountId,
            {
              userRequest:
                undefined,
            },
          );
        }
      }
    }

    /* ==============================================================
     * DASHBOARD
     * ============================================================== */

    if (
      this.options
        .dashboardPort >
      0
    ) {
      startDashboard(
        this.options
          .dashboardPort,
        this.commandQueue,
        this.adapterPool,
      );
    }

    logger.info(
      {
        accounts:
          accountIds,

        interval:
          this.options
            .dispatchInterval,
      },
      'Orchestrator started',
    );

    /*
     * Execute immediately.
     */
    void this.dispatchAccounts(
      accountIds,
    );

    /*
     * Continue polling.
     */
    this.timer =
      setInterval(
        () => {
          void this.dispatchAccounts(
            accountIds,
          );
        },
        this.options
          .dispatchInterval,
      );
  }

  /* ================================================================
   * DISPATCH LOOP
   * ================================================================ */

  private async dispatchAccounts(
    accountIds:
      string[],
  ): Promise<void> {
    if (
      !this.running
    ) {
      return;
    }

    if (
      this.tickInProgress
    ) {
      return;
    }

    this.tickInProgress =
      true;

    try {
      for (
        const accountId of
          accountIds
      ) {
        if (
          !this.running
        ) {
          break;
        }

        try {
          const result =
            await this.dispatcher.tick(
              accountId,
            );

          if (
            result.status !==
              'ok' &&
            result.status !==
              'no_goal'
          ) {
            logger.info(
              {
                accountId,

                result,
              },
              'Dispatcher tick result',
            );
          }
        } catch (
          error
        ) {
          logger.error(
            {
              err:
                error,

              accountId,
            },
            'Dispatcher tick error',
          );
        }
      }
    } finally {
      this.tickInProgress =
        false;
    }
  }

  /* ================================================================
   * STOP
   * ================================================================ */

  stop(): void {
    if (
      this.timer
    ) {
      clearInterval(
        this.timer,
      );

      this.timer =
        null;
    }

    this.running =
      false;

    this.tickInProgress =
      false;

    /*
     * Destroy the shared adapter pool — this closes all long-lived
     * WebSocket connections gracefully.
     */
    void this.adapterPool.destroy();

    closeMemoryStore();

    logger.info(
      'Orchestrator stopped',
    );
  }
}
