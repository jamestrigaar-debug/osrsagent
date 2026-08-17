import {
  loadMemory,
  updateMemory,
  storePlan,
  clearPlan,
  recordActionResult,
  appendHistory,
} from '../memory/store.js';

import {
  createSnapshot,
} from '../memory/snapshots.js';

import {
  AccountMemory,
  ActivePlan,
  ActionResult,
  PlanStep,
} from '../memory/types.js';

import {
  executeScript,
} from '../scripts/executor.js';

import {
  getAllManifests,
} from '../scripts/registry.js';

import type {
  ScriptContext,
} from '../scripts/types.js';

import {
  Planner,
} from '../planner/planner.js';

import {
  shouldEscalate,
  isGoalMet,
  EscalationEvent,
} from './escalation.js';

import {
  config,
} from '../config/index.js';

import {
  logger,
} from '../logger.js';

import {
  resolvePhase1Command,
} from '../commands/phase1-resolver.js';

import {
  buildPhase1Plan,
} from '../commands/phase1-executor.js';

import type {
  CommandQueue,
} from '../queue/command-queue.js';

import type {
  Command,
} from '../queue/types.js';

import type {
  AdapterPool,
} from '../adapters/adapter-pool.js';

export type DispatchResult =
  | {
      status: 'ok';
      message: string;
    }
  | {
      status: 'escalated';
      event: EscalationEvent;
    }
  | {
      status: 'goal_met';
      goal: string;
    }
  | {
      status: 'no_goal';
    };

interface RunningTask {
  accountId: string;
  planId: string;
  stepIndex: number;
  controller: AbortController;
  promise: Promise<void>;
}

export class Dispatcher {
  private consecutiveFailures:
    Map<string, number> =
      new Map();

  /**
   * Tracks the earliest timestamp (ms since epoch) at which each account
   * is allowed to start its next step after a failure.
   *
   * Backoff schedule: `min(500 * 2^consecutiveFailures, 30_000)` ms.
   * Reset to 0 on every successful step.
   */
  private nextRetryAfter:
    Map<string, number> =
      new Map();

  private runningTasks:
    Map<string, RunningTask> =
      new Map();

  private planner:
    Planner;

  /**
   * Optional command queue.
   *
   * When set, the dispatcher will dequeue and execute commands before
   * escalating to the LLM Planner when no active plan is present.
   */
  private commandQueue:
    CommandQueue | null;

  /**
   * Optional shared adapter pool.
   *
   * When set, script contexts are hydrated with a long-lived pooled
   * adapter so all scripts reuse the same WebSocket connection.
   */
  private adapterPool:
    AdapterPool | null;

  constructor(
    planner:
      Planner,

    commandQueue?:
      CommandQueue | null,

    adapterPool?:
      AdapterPool | null,
  ) {
    this.planner =
      planner;

    this.commandQueue =
      commandQueue ?? null;

    this.adapterPool =
      adapterPool ?? null;
  }

  /* ================================================================
   * MAIN TICK
   * ================================================================ */

  async tick(
    accountId:
      string,
  ): Promise<DispatchResult> {
    const memory =
      loadMemory(
        accountId,
      );

    /*
     * ------------------------------------------------------------
     * NEW USER REQUEST
     * ------------------------------------------------------------
     */
    if (
      memory.userRequest
    ) {
      return this.handleUserRequest(
        memory,
      );
    }

    /*
     * ------------------------------------------------------------
     * NO GOAL
     * ------------------------------------------------------------
     */
    if (
      !memory.currentGoal
    ) {
      return {
        status:
          'no_goal',
      };
    }

    /*
     * ------------------------------------------------------------
     * RESOLVE DETERMINISTIC PHASE 1 COMMAND
     * ------------------------------------------------------------
     *
     * This happens BEFORE the no-plan/Planner branch.
     *
     * Therefore:
     *
     *   gather:mine-al-kharid
     *
     * can never accidentally fall through to the AI Planner.
     */
    const phase1Command =
      resolvePhase1Command(
        memory.currentGoal,
      );

    /*
     * ------------------------------------------------------------
     * ACTIVE RUNNING TASK
     * ------------------------------------------------------------
     */
    const running =
      this.runningTasks.get(
        accountId,
      );

    if (
      running
    ) {
      /*
       * If a new plan replaced the old plan, cancel the stale task.
       */
      if (
        !memory.activePlan ||
        memory.activePlan.planId !==
          running.planId ||
        memory.activePlan.currentStepIndex !==
          running.stepIndex
      ) {
        logger.info(
          {
            accountId,

            planId:
              running.planId,

            stepIndex:
              running.stepIndex,
          },
          'Dispatcher: cancelling stale running task',
        );

        running.controller.abort();

        this.runningTasks.delete(
          accountId,
        );

        return {
          status:
            'ok',

          message:
            'Previous task cancelled',
        };
      }

      return {
        status:
          'ok',

        message:
          `Step ${running.stepIndex + 1} is still running`,
      };
    }

    /*
     * ------------------------------------------------------------
     * DETERMINISTIC PLAN MISSING
     * ------------------------------------------------------------
     *
     * This is the key fix.
     *
     * If the current goal is a known Phase 1 command but its plan
     * disappeared, rebuild it.
     *
     * DO NOT escalate to the Planner.
     */
    if (
      phase1Command &&
      phase1Command.type !==
        'stop' &&
      !memory.activePlan
    ) {
      const rebuiltPlan =
        buildPhase1Plan(
          phase1Command,
        );

      if (
        rebuiltPlan
      ) {
        storePlan(
          accountId,
          rebuiltPlan,
        );

        logger.info(
          {
            accountId,

            goal:
              memory.currentGoal,

            planId:
              rebuiltPlan.planId,
          },
          'Dispatcher: rebuilt missing Phase 1 plan',
        );

        return {
          status:
            'ok',

          message:
            `Rebuilt Phase 1 plan: ${rebuiltPlan.planId}`,
        };
      }

      return {
        status:
          'ok',

        message:
          'Could not rebuild Phase 1 plan',
      };
    }

    /*
     * ------------------------------------------------------------
     * PHASE 1 STOP
     * ------------------------------------------------------------
     */
    if (
      phase1Command?.type ===
      'stop'
    ) {
      this.cancelRunningTask(
        accountId,
        'stop command',
      );

      clearPlan(
        accountId,
      );

      return {
        status:
          'ok',

        message:
          'Task stopped',
      };
    }

    /*
     * ------------------------------------------------------------
     * NO PLAN -> CHECK QUEUE BEFORE PHASE 2
     * ------------------------------------------------------------
     *
     * When there is no active plan, pull from the command queue
     * before invoking the LLM Planner.  This keeps user-provided
     * tasks fast and avoids unnecessary AI round-trips.
     */
    if (
      !memory.activePlan
    ) {
      if (
        this.commandQueue
      ) {
        const command =
          this.commandQueue.dequeue();

        if (
          command
        ) {
          let step:
            PlanStep;

          try {
            step =
              commandToStep(
                command,
              );
          } catch (
            err
          ) {
            logger.warn(
              {
                accountId,

                command,

                err,
              },
              'Dispatcher: skipping malformed queued command',
            );

            return {
              status:
                'ok',

              message:
                'Skipped malformed queued command',
            };
          }

          const queuedPlan:
            ActivePlan = {
            planId:
              `queue-${command.id}`,

            goal:
              memory.currentGoal ||
              `queue-${command.type}`,

            steps: [step],

            currentStepIndex:
              0,

            onMissingCapability:
              'invoke_sdk_or_ask_user',

            createdAt:
              Date.now(),
          };

          storePlan(
            accountId,
            queuedPlan,
          );

          logger.info(
            {
              accountId,

              commandId:
                command.id,

              commandType:
                command.type,

              script:
                step.script,
            },
            'Dispatcher: queued command loaded as plan step',
          );

          return {
            status:
              'ok',

            message:
              `Queued command '${step.script}' loaded`,
          };
        }
      }

      return this.escalateToPlanner(
        memory,
        'no_plan',
        'No active plan',
      );
    }

    const plan =
      memory.activePlan;

    /*
     * ------------------------------------------------------------
     * GOAL MET
     * ------------------------------------------------------------
     */
    if (
      isGoalMet(
        memory,
        plan,
      )
    ) {
      clearPlan(
        accountId,
      );

      appendHistory(
        accountId,
        `Goal met: ${plan.goal}`,
      );

      return {
        status:
          'goal_met',

        goal:
          plan.goal,
      };
    }

    /*
     * ------------------------------------------------------------
     * PLAN EXHAUSTED
     * ------------------------------------------------------------
     */
    if (
      plan.currentStepIndex >=
      plan.steps.length
    ) {
      if (
        plan.loopUntil
      ) {
        const reset:
          ActivePlan = {
          ...plan,

          currentStepIndex:
            0,
        };

        storePlan(
          accountId,
          reset,
        );

        return {
          status:
            'ok',

          message:
            'Plan loop reset',
        };
      }

      clearPlan(
        accountId,
      );

      if (
        phase1Command
      ) {
        return {
          status:
            'goal_met',

          goal:
            plan.goal,
        };
      }

      return this.escalateToPlanner(
        loadMemory(
          accountId,
        ),
        'plan_complete',
        'Plan finished without loop condition',
      );
    }

    const step =
      plan.steps[
        plan.currentStepIndex
      ];

    if (
      !step
    ) {
      clearPlan(
        accountId,
      );

      return {
        status:
          'ok',

        message:
          'Plan contained no executable step',
      };
    }

    /*
     * ------------------------------------------------------------
     * START STEP
     * ------------------------------------------------------------
     */

    /*
     * Exponential backoff guard.
     *
     * If the previous step failed we may be in a back-off window.
     * Skip this tick and let the timer run down rather than
     * hammering the SDK on every 500 ms tick.
     */
    const nextRetry =
      this.nextRetryAfter.get(
        accountId,
      ) ?? 0;

    if (
      Date.now() < nextRetry
    ) {
      return {
        status:
          'ok',

        message:
          `Backing off after failure — retrying in ${Math.ceil((nextRetry - Date.now()) / 1000)}s`,
      };
    }

    this.startStep(
      memory,
      plan,
      plan.currentStepIndex,
      step,
    );

    return {
      status:
        'ok',

      message:
        `Started step '${step.script}'`,
    };
  }

  /* ================================================================
   * USER REQUEST
   * ================================================================ */

  private async handleUserRequest(
    memory:
      AccountMemory,
  ): Promise<DispatchResult> {
    const request =
      memory.userRequest!;

    logger.info(
      {
        accountId:
          memory.accountId,

        request,
      },
      'Dispatcher: handling user request',
    );

    /*
     * Cancel current long-running task.
     */
    this.cancelRunningTask(
      memory.accountId,
      'new user request',
    );

    /*
     * Clear the one-shot request and make it the new goal.
     */
    updateMemory(
      memory.accountId,
      {
        userRequest:
          undefined,

        currentGoal:
          request,
      },
    );

    /*
     * Remove old plan immediately.
     */
    clearPlan(
      memory.accountId,
    );

    /*
     * ------------------------------------------------------------
     * PHASE 1
     * ------------------------------------------------------------
     */
    const phase1Command =
      resolvePhase1Command(
        request,
      );

    if (
      phase1Command
    ) {
      if (
        phase1Command.type ===
        'stop'
      ) {
        appendHistory(
          memory.accountId,
          'Phase 1 task stopped',
        );

        return {
          status:
            'ok',

          message:
            'Task stopped',
        };
      }

      const phase1Plan =
        buildPhase1Plan(
          phase1Command,
        );

      if (
        !phase1Plan
      ) {
        return {
          status:
            'ok',

          message:
            'Could not create deterministic Phase 1 plan',
        };
      }

      storePlan(
        memory.accountId,
        phase1Plan,
      );

      logger.info(
        {
          accountId:
            memory.accountId,

          planId:
            phase1Plan.planId,

          goal:
            phase1Plan.goal,

          steps:
            phase1Plan.steps,
        },
        'Dispatcher: Phase 1 plan created',
      );

      return {
        status:
          'ok',

        message:
          `Phase 1 plan created: ${phase1Plan.planId}`,
      };
    }

    /*
     * ------------------------------------------------------------
     * PHASE 2
     * ------------------------------------------------------------
     */
    return this.escalateToPlanner(
      loadMemory(
        memory.accountId,
      ),
      'user_request',
      request,
    );
  }

  /* ================================================================
   * START STEP
   * ================================================================ */

  private startStep(
    memory:
      AccountMemory,

    plan:
      ActivePlan,

    stepIndex:
      number,

    step:
      ActivePlan['steps'][number],
  ): void {
    const accountId =
      memory.accountId;

    const controller =
      new AbortController();

    logger.info(
      {
        accountId,

        planId:
          plan.planId,

        stepIndex,

        script:
          step.script,

        params:
          step.params,
      },
      'Dispatcher: starting plan step',
    );

    const promise =
      (async () => {
        /*
         * Pre-fetch the pooled adapter so all scripts in this step
         * share the same long-lived WebSocket connection.
         */
        let pooledAdapter:
          unknown;

        if (
          this.adapterPool
        ) {
          try {
            pooledAdapter =
              await this.adapterPool.getAdapter(
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
          } catch (
            poolErr
          ) {
            logger.warn(
              {
                accountId,

                err:
                  poolErr,
              },
              'Dispatcher: adapter pool unavailable; falling back to fresh adapter',
            );
          }
        }

        const context =
          this.buildContext(
            memory,
            controller.signal,
            pooledAdapter,
          );

        const result =
          await executeScript(
            step.script,
            step.params,
            context,
          );

        const actionResult:
          ActionResult = {
          success:
            result.success,

          message:
            result.message,

          timestamp:
            Date.now(),

          data:
            result.data,
        };

        recordActionResult(
          accountId,
          actionResult,
        );

        const current =
          this.runningTasks.get(
            accountId,
          );

        /*
         * Ignore stale completions.
         */
        if (
          !current ||
          current.planId !==
            plan.planId ||
          current.stepIndex !==
            stepIndex
        ) {
          return;
        }

        this.runningTasks.delete(
          accountId,
        );

        /*
         * ----------------------------------------------------------
         * STEP FAILED
         * ----------------------------------------------------------
         */
        if (
          !result.success
        ) {
          const failures =
            (
              this
                .consecutiveFailures
                .get(
                  accountId,
                ) ??
              0
            ) + 1;

          this.consecutiveFailures.set(
            accountId,
            failures,
          );

          /*
           * Apply exponential back-off so a broken step doesn't
           * hammer the SDK on every 500 ms tick.
           *
           * Schedule: min(500 * 2^failures, 30_000) ms.
           */
          const backoffMs =
            Math.min(
              500 * Math.pow(
                2,
                failures,
              ),
              30_000,
            );

          this.nextRetryAfter.set(
            accountId,
            Date.now() + backoffMs,
          );

          logger.warn(
            {
              accountId,

              planId:
                plan.planId,

              stepIndex,

              script:
                step.script,

              failures,

              backoffMs,

              message:
                result.message,

              data:
                result.data,
            },
            'Dispatcher: plan step failed',
          );

          /*
           * IMPORTANT:
           *
           * Phase 1 failures stay inside Phase 1.
           * They do not go to OpenAI.
           *
           * The plan remains at the same step so the next tick can
           * retry it or a new CLI goal can replace it.
           */
          if (
            resolvePhase1Command(
              loadMemory(
                accountId,
              ).currentGoal ??
                '',
            )
          ) {
            appendHistory(
              accountId,
              `Phase 1 step '${step.script}' failed: ${result.message}`,
            );

            return;
          }

          /*
           * Only Phase 2 plans can escalate after repeated failure.
           */
          if (
            shouldEscalate(
              accountId,
              plan,
              failures,
            )
          ) {
            this.consecutiveFailures.set(
              accountId,
              0,
            );

            // A new plan is about to be created; clear any backoff
            // so the first step of the fresh plan can start immediately.
            this.nextRetryAfter.delete(
              accountId,
            );

            await this.escalateToPlanner(
              loadMemory(
                accountId,
              ),
              'repeated_failure',
              `Step '${step.script}' failed ${failures} times: ${result.message}`,
            );
          }

          return;
        }

        /*
         * ----------------------------------------------------------
         * SUCCESS
         * ----------------------------------------------------------
         */
        this.consecutiveFailures.set(
          accountId,
          0,
        );

        // Reset backoff — this step succeeded so the next one may
        // start without delay.
        this.nextRetryAfter.delete(
          accountId,
        );

        const latest =
          loadMemory(
            accountId,
          );

        if (
          !latest.activePlan ||
          latest.activePlan.planId !==
            plan.planId
        ) {
          return;
        }

        const advanced:
          ActivePlan = {
          ...latest.activePlan,

          currentStepIndex:
            stepIndex +
            1,
        };

        storePlan(
          accountId,
          advanced,
        );

        appendHistory(
          accountId,
          `Plan step '${step.script}' succeeded`,
        );

        logger.info(
          {
            accountId,

            planId:
              plan.planId,

            completedStep:
              step.script,

            nextStep:
              advanced.currentStepIndex,
          },
          'Dispatcher: plan step completed',
        );
      })().catch(
        (
          error,
        ) => {
          const current =
            this.runningTasks.get(
              accountId,
            );

          if (
            current &&
            current.planId ===
              plan.planId &&
            current.stepIndex ===
              stepIndex
          ) {
            this.runningTasks.delete(
              accountId,
            );
          }

          logger.error(
            {
              err:
                error,

              accountId,

              planId:
                plan.planId,

              stepIndex,

              script:
                step.script,
            },
            'Dispatcher: plan step exception',
          );

          recordActionResult(
            accountId,
            {
              success:
                false,

              message:
                error instanceof Error
                  ? error.message
                  : String(
                      error,
                    ),

              timestamp:
                Date.now(),

              data: {
                reason:
                  'dispatcher_step_exception',
              },
            },
          );
        },
      );

    this.runningTasks.set(
      accountId,
      {
        accountId,

        planId:
          plan.planId,

        stepIndex,

        controller,

        promise,
      },
    );
  }

  /* ================================================================
   * CANCEL
   * ================================================================ */

  private cancelRunningTask(
    accountId:
      string,

    reason:
      string,
  ): void {
    const running =
      this.runningTasks.get(
        accountId,
      );

    if (
      !running
    ) {
      return;
    }

    logger.info(
      {
        accountId,

        planId:
          running.planId,

        stepIndex:
          running.stepIndex,

        reason,
      },
      'Dispatcher: cancelling running task',
    );

    running.controller.abort();

    this.runningTasks.delete(
      accountId,
    );

    // A cancelled task means a new goal or stop command arrived.
    // Clear any pending backoff so the fresh goal can start immediately.
    this.nextRetryAfter.delete(
      accountId,
    );
  }

  /* ================================================================
   * PLANNER
   * ================================================================ */

  private async escalateToPlanner(
    memory:
      AccountMemory,

    reason:
      EscalationEvent['reason'],

    context:
      string,
  ): Promise<DispatchResult> {
    logger.info(
      {
        accountId:
          memory.accountId,

        reason,

        context,
      },
      'Dispatcher: escalating to Planner',
    );

    const event:
      EscalationEvent = {
      accountId:
        memory.accountId,

      reason,

      context,

      memory,
    };

    try {
      const snapshot =
        createSnapshot(
          memory,
        );

      const manifests =
        getAllManifests();

      const plan =
        await this.planner.generatePlan(
          snapshot,
          manifests,
          memory.currentGoal,
        );

      storePlan(
        memory.accountId,
        plan,
      );

      return {
        status:
          'ok',

        message:
          `New plan created: ${plan.planId}`,
      };
    } catch (
      err
    ) {
      logger.error(
        {
          err,

          accountId:
            memory.accountId,
        },
        'Planner failed',
      );

      return {
        status:
          'escalated',

        event,
      };
    }
  }

  /* ================================================================
   * CONTEXT
   * ================================================================ */

  private buildContext(
    memory:
      AccountMemory,

    cancelSignal?:
      AbortSignal,

    adapter?:
      unknown,
  ): ScriptContext {
    return {
      accountId:
        memory.accountId,

      sdkBaseUrl:
        config.rs_sdk.baseUrl,

      sdkBotName:
        config.bot.name,

      sdkBotPassword:
        config.bot.password,

      cancelSignal,

      adapter,

      adapterPool:
        this.adapterPool ??
        undefined,
    } as ScriptContext;
  }
}

/* ================================================================
 * COMMAND → PLAN STEP CONVERSION
 * ================================================================ */

/**
 * Convert a queued {@link Command} to a single {@link PlanStep} that
 * the Dispatcher can execute using the standard plan machinery.
 *
 * Convention
 * ----------
 * - `travel`  — expects `params.x` and `params.z`; runs `walk_to`.
 * - `gather`  — expects `params.profession` and `params.resource`; uses
 *               `params.script` when supplied, else the profession name.
 * - `generic` — requires `params.script`; all other params are forwarded
 *               as-is.
 *
 * @throws {Error} when the command lacks the required fields.
 */
function commandToStep(
  command:
    Command,
): PlanStep {
  const { type, params } = command;

  switch (type) {
    case 'travel': {
      const x =
        params.x ??
        params.destX ??
        params.worldX;

      const z =
        params.z ??
        params.destZ ??
        params.worldZ;

      if (
        x === undefined ||
        z === undefined
      ) {
        throw new Error(
          `travel command requires 'x' and 'z' in params`,
        );
      }

      const script =
        typeof params.script === 'string' &&
        params.script
          ? params.script
          : 'walk_to';

      return {
        script,

        params: {
          x,
          z,
          tolerance:
            params.tolerance ?? 3,
        },

        description:
          `Travel to (${x}, ${z})`,
      };
    }

    case 'gather': {
      const profession =
        String(
          params.profession ?? '',
        );

      const resource =
        String(
          params.resource ?? '',
        );

      const script =
        typeof params.script === 'string' &&
        params.script
          ? params.script
          : profession || 'gather';

      return {
        script,

        params: {
          ...params,
          profession,
          resource,
        },

        description:
          `Gather ${resource} (${profession})`,
      };
    }

    case 'generic':
    default: {
      const script =
        typeof params.script === 'string'
          ? params.script
          : '';

      if (!script) {
        throw new Error(
          `generic command requires 'script' field in params`,
        );
      }

      /*
       * Forward every field except 'script' as script params.
       */
      const { script: _ignored, ...rest } = params;

      return {
        script,

        params: rest,

        description:
          `Run ${script}`,
      };
    }
  }
}
