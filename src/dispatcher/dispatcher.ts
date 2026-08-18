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

interface ProvisionCommand {
  type: 'provision_food';

  foodName: string;

  rawFoodName: string;

  targetBankedFood: number;

  fishingLocation: string;

  bank: string;

  cookingLocation: string;

  maxFishingRuns: number;

  fishPerRun: number;

  fishingMethod: string;
}

interface CombatCommand {
  type: 'combat';

  target: string;
}

interface GearCommand {
  type: 'bronze_gear' | 'bronze_weapon';
}

/* ================================================================
 * DISPATCHER
 * ================================================================ */

export class Dispatcher {
  private consecutiveFailures:
    Map<string, number> =
      new Map();

  private nextRetryAfter:
    Map<string, number> =
      new Map();

  private runningTasks:
    Map<string, RunningTask> =
      new Map();

  private planner:
    Planner;

  private commandQueue:
    CommandQueue | null;

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
   * EXTERNAL USER-REQUEST INTERRUPT
   * ================================================================ */

  async interruptPendingRequest(
    accountId:
      string,
  ): Promise<DispatchResult | null> {
    const memory =
      loadMemory(
        accountId,
      );

    if (
      !memory.userRequest
    ) {
      return null;
    }

    logger.info(
      {
        accountId,

        request:
          memory.userRequest,
      },
      'Dispatcher: immediate user-request interrupt detected',
    );

    return this.handleUserRequest(
      memory,
    );
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
     * HIGHEST PRIORITY: USER REQUEST / INTERRUPT
     */
    if (
      memory.userRequest
    ) {
      return this.handleUserRequest(
        memory,
      );
    }

    /*
     * NO GOAL
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
     * COMMAND RESOLUTION
     */
    const phase1Command =
      resolvePhase1Command(
        memory.currentGoal,
      );

    const provisionCommand =
      resolveProvisionCommand(
        memory.currentGoal,
      );

    const combatCommand =
      resolveCombatCommand(
        memory.currentGoal,
      );

    const gearCommand =
      resolveGearCommand(
        memory.currentGoal,
      );

    /*
     * ACTIVE RUNNING TASK
     */
    const running =
      this.runningTasks.get(
        accountId,
      );

    if (
      running
    ) {
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
     * DETERMINISTIC PROVISION PLAN MISSING
     */
    if (
      provisionCommand &&
      !memory.activePlan
    ) {
      const provisionPlan =
        buildProvisionPlan(
          provisionCommand,
        );

      storePlan(
        accountId,
        provisionPlan,
      );

      logger.info(
        {
          accountId,

          planId:
            provisionPlan.planId,

          goal:
            provisionPlan.goal,

          steps:
            provisionPlan.steps,
        },
        'Dispatcher: rebuilt missing food provisioning plan',
      );

      return {
        status:
          'ok',

        message:
          `Food provisioning plan created: ${provisionPlan.planId}`,
      };
    }

    /*
     * DETERMINISTIC COMBAT PLAN MISSING
     */
    if (
      combatCommand &&
      !memory.activePlan
    ) {
      const combatPlan =
        buildCombatPlan(
          combatCommand,
        );

      storePlan(
        accountId,
        combatPlan,
      );

      logger.info(
        {
          accountId,

          planId:
            combatPlan.planId,

          goal:
            combatPlan.goal,

          steps:
            combatPlan.steps,
        },
        'Dispatcher: rebuilt missing combat plan',
      );

      return {
        status:
          'ok',

        message:
          `Combat plan created: ${combatPlan.planId}`,
      };
    }

    /*
     * DETERMINISTIC GEAR PLAN MISSING
     */
    if (
      gearCommand &&
      !memory.activePlan
    ) {
      const gearPlan =
        buildGearPlan(
          gearCommand,
        );

      storePlan(
        accountId,
        gearPlan,
      );

      logger.info(
        {
          accountId,

          planId:
            gearPlan.planId,

          goal:
            gearPlan.goal,

          steps:
            gearPlan.steps,
        },
        'Dispatcher: rebuilt missing gear plan',
      );

      return {
        status:
          'ok',

        message:
          `Gear plan created: ${gearPlan.planId}`,
      };
    }

    /*
     * DETERMINISTIC PHASE 1 PLAN MISSING
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
     * STOP
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

      updateMemory(
        accountId,
        {
          currentGoal:
            '',

          userRequest:
            undefined,
        },
      );

      return {
        status:
          'ok',

        message:
          'Task stopped',
      };
    }

    /*
     * NO PLAN
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

            steps: [
              step,
            ],

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

      /*
       * Deterministic Phase 2 provisioning
       */
      if (
        provisionCommand
      ) {
        const provisionPlan =
          buildProvisionPlan(
            provisionCommand,
          );

        storePlan(
          accountId,
          provisionPlan,
        );

        return {
          status:
            'ok',

          message:
            `Food provisioning plan created: ${provisionPlan.planId}`,
        };
      }

      /*
       * Deterministic combat
       */
      if (
        combatCommand
      ) {
        const combatPlan =
          buildCombatPlan(
            combatCommand,
          );

        storePlan(
          accountId,
          combatPlan,
        );

        return {
          status:
            'ok',

          message:
            `Combat plan created: ${combatPlan.planId}`,
        };
      }

      /*
       * Deterministic gear
       */
      if (
        gearCommand
      ) {
        const gearPlan =
          buildGearPlan(
            gearCommand,
          );

        storePlan(
          accountId,
          gearPlan,
        );

        return {
          status:
            'ok',

          message:
            `Gear plan created: ${gearPlan.planId}`,
        };
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
     * GOAL MET
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
     * PLAN EXHAUSTED
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

      /*
       * Deterministic plan types
       */
      if (
        provisionCommand ||
        phase1Command ||
        combatCommand ||
        gearCommand
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
     * FAILURE BACKOFF
     */
    const nextRetry =
      this.nextRetryAfter.get(
        accountId,
      ) ?? 0;

    if (
      Date.now() <
      nextRetry
    ) {
      return {
        status:
          'ok',

        message:
          `Backing off after failure — retrying in ${Math.ceil(
            (nextRetry - Date.now()) /
              1000,
          )}s`,
      };
    }

    /*
     * START STEP
     */
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

    this.cancelRunningTask(
      memory.accountId,
      'new user request',
    );

    this.consecutiveFailures.delete(
      memory.accountId,
    );

    this.nextRetryAfter.delete(
      memory.accountId,
    );

    updateMemory(
      memory.accountId,
      {
        userRequest:
          undefined,

        currentGoal:
          request,
      },
    );

    clearPlan(
      memory.accountId,
    );

    const phase1Command =
      resolvePhase1Command(
        request,
      );

    if (
      phase1Command?.type ===
      'stop'
    ) {
      updateMemory(
        memory.accountId,
        {
          currentGoal:
            '',

          userRequest:
            undefined,
        },
      );

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

    const provisionCommand =
      resolveProvisionCommand(
        request,
      );

    if (
      provisionCommand
    ) {
      const provisionPlan =
        buildProvisionPlan(
          provisionCommand,
        );

      storePlan(
        memory.accountId,
        provisionPlan,
      );

      logger.info(
        {
          accountId:
            memory.accountId,

          planId:
            provisionPlan.planId,

          goal:
            provisionPlan.goal,

          steps:
            provisionPlan.steps,
        },
        'Dispatcher: food provisioning plan created',
      );

      return {
        status:
          'ok',

        message:
          `Food provisioning plan created: ${provisionPlan.planId}`,
      };
    }

    const combatCommand =
      resolveCombatCommand(
        request,
      );

    if (
      combatCommand
    ) {
      const combatPlan =
        buildCombatPlan(
          combatCommand,
        );

      storePlan(
        memory.accountId,
        combatPlan,
      );

      logger.info(
        {
          accountId:
            memory.accountId,

          planId:
            combatPlan.planId,

          goal:
            combatPlan.goal,

          steps:
            combatPlan.steps,
        },
        'Dispatcher: combat plan created',
      );

      return {
        status:
          'ok',

        message:
          `Combat plan created: ${combatPlan.planId}`,
      };
    }

    const gearCommand =
      resolveGearCommand(
        request,
      );

    if (
      gearCommand
    ) {
      const gearPlan =
        buildGearPlan(
          gearCommand,
        );

      storePlan(
        memory.accountId,
        gearPlan,
      );

      logger.info(
        {
          accountId:
            memory.accountId,

          planId:
            gearPlan.planId,

          goal:
            gearPlan.goal,

          steps:
            gearPlan.steps,
        },
        'Dispatcher: gear plan created',
      );

      return {
        status:
          'ok',

        message:
          `Gear plan created: ${gearPlan.planId}`,
      };
    }

    if (
      phase1Command
    ) {
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

        if (
          controller.signal.aborted
        ) {
          logger.info(
            {
              accountId,

              planId:
                plan.planId,

              stepIndex,

              script:
                step.script,
            },
            'Dispatcher: step cancelled',
          );

          return;
        }

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

          const backoffMs =
            Math.min(
              500 *
                Math.pow(
                  2,
                  failures,
                ),
              30_000,
            );

          this.nextRetryAfter.set(
            accountId,
            Date.now() +
              backoffMs,
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

          const latestMemory =
            loadMemory(
              accountId,
            );

          const latestPhase1 =
            resolvePhase1Command(
              latestMemory.currentGoal ??
                '',
            );

          const latestProvision =
            resolveProvisionCommand(
              latestMemory.currentGoal ??
                '',
            );

          const latestCombat =
            resolveCombatCommand(
              latestMemory.currentGoal ??
                '',
            );

          const latestGear =
            resolveGearCommand(
              latestMemory.currentGoal ??
                '',
            );

          /*
           * Deterministic tasks remain deterministic.
           */
          if (
            latestPhase1 ||
            latestProvision ||
            latestCombat ||
            latestGear
          ) {
            appendHistory(
              accountId,
              `Deterministic step '${step.script}' failed: ${result.message}`,
            );

            return;
          }

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

        this.consecutiveFailures.set(
          accountId,
          0,
        );

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

        if (
          latest.userRequest
        ) {
          logger.info(
            {
              accountId,

              request:
                latest.userRequest,
            },
            'Dispatcher: user request detected before plan advancement',
          );

          return;
        }

        if (
          latest.currentGoal !==
          memory.currentGoal
        ) {
          logger.info(
            {
              accountId,

              oldGoal:
                memory.currentGoal,

              newGoal:
                latest.currentGoal,
            },
            'Dispatcher: goal changed before plan advancement',
          );

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

          if (
            controller.signal.aborted
          ) {
            logger.info(
              {
                accountId,

                planId:
                  plan.planId,

                stepIndex,

                script:
                  step.script,
              },
              'Dispatcher: cancelled step exited with exception',
            );

            return;
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

    this.nextRetryAfter.delete(
      accountId,
    );

    this.consecutiveFailures.delete(
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
 * PROVISION COMMAND RESOLVER
 * ================================================================ */

function resolveProvisionCommand(
  goal:
    string,
): ProvisionCommand | null {
  const normalized =
    goal
      .trim()
      .toLowerCase();

  if (
    normalized ===
      'provision:food-shrimp' ||
    normalized ===
      'provision:shrimp' ||
    normalized ===
      'provision:food-shrimps'
  ) {
    return {
      type:
        'provision_food',

      foodName:
        'Shrimps',

      rawFoodName:
        'Raw shrimps',

      targetBankedFood:
        100,

      fishingLocation:
        'draynor-fishing',

      bank:
        'draynor-bank',

      cookingLocation:
        'draynor-cooking',

      maxFishingRuns:
        3,

      fishPerRun:
        26,

      fishingMethod:
        'net',
    };
  }

  return null;
}

/* ================================================================
 * COMBAT COMMAND RESOLVER
 * ================================================================ */

function resolveCombatCommand(
  goal:
    string,
): CombatCommand | null {
  const normalized =
    goal
      .trim()
      .toLowerCase();

  const prefix =
    'combat:';

  if (
    normalized.startsWith(
      prefix,
    )
  ) {
    const target =
      normalized
        .slice(
          prefix.length,
        )
        .trim();

    if (
      !target
    ) {
      return null;
    }

    const targetDisplay =
      target.charAt(
        0,
      )
        .toUpperCase() +
      target.slice(
        1,
      );

    return {
      type:
        'combat',

      target:
        targetDisplay,
    };
  }

  return null;
}

/* ================================================================
 * GEAR COMMAND RESOLVER
 * ================================================================ */

function resolveGearCommand(
  goal:
    string,
): GearCommand | null {
  const normalized =
    goal
      .trim()
      .toLowerCase();

  if (
    normalized ===
      'gear:bronze' ||
    normalized ===
      'bronze:gear'
  ) {
    return {
      type:
        'bronze_gear',
    };
  }

  if (
    normalized ===
      'gear:bronze-weapon' ||
    normalized ===
      'bronze:weapon'
  ) {
    return {
      type:
        'bronze_weapon',
    };
  }

  return null;
}

/* ================================================================
 * COMBAT PLAN BUILDER
 * ================================================================ */

function buildCombatPlan(
  command:
    CombatCommand,
): ActivePlan {
  return {
    planId:
      `combat-${Date.now()}`,

    goal:
      `Combat — ${command.target}`,

    currentStepIndex:
      0,

    onMissingCapability:
      'invoke_sdk_or_ask_user',

    createdAt:
      Date.now(),

    steps: [
      {
        script:
          'basic_combat',

        params: {
          target:
            command.target,

          foodName:
            'Shrimps',

          rawFoodName:
            'Raw shrimps',

          weaponName:
            '',

          armorNames:
            [],

          foodWithdraw:
            14,

          buryBones:
            true,

          maxTrips:
            0,
        },

        description:
          `Fight ${command.target} until stopped`,
      },
    ],
  };
}

/* ================================================================
 * GEAR PLAN BUILDER
 * ================================================================ */

function buildGearPlan(
  command:
    GearCommand,
): ActivePlan {
  if (
    command.type ===
    'bronze_weapon'
  ) {
    return {
      planId:
        `gear-bronze-weapon-${Date.now()}`,

      goal:
        'Obtain bronze weapon',

      currentStepIndex:
        0,

      onMissingCapability:
        'invoke_sdk_or_ask_user',

      createdAt:
        Date.now(),

      steps: [
        {
          script:
            'bronze_weapon_setup',

          params: {},

          description:
            'Mine copper/tin, smelt bronze bar, smith and equip bronze sword',
        },
      ],
    };
  }

  return {
    planId:
      `gear-bronze-${Date.now()}`,

    goal:
      'Obtain full bronze gear',

    currentStepIndex:
      0,

    onMissingCapability:
      'invoke_sdk_or_ask_user',

    createdAt:
      Date.now(),

    steps: [
      {
        script:
          'bronze_gear_setup',

        params: {},

        description:
          'Mine copper/tin, smelt bronze bars, smith and equip full bronze set',
      },
    ],
  };
}

/* ================================================================
 * PROVISION PLAN BUILDER
 * ================================================================ */

function buildProvisionPlan(
  command:
    ProvisionCommand,
): ActivePlan {
  return {
    planId:
      `phase2-provision-food-${Date.now()}`,

    goal:
      'Provision food — Shrimps',

    currentStepIndex:
      0,

    onMissingCapability:
      'invoke_sdk_or_ask_user',

    createdAt:
      Date.now(),

    steps: [
      {
        script:
          'provision_food',

        params: {
          foodName:
            command.foodName,

          rawFoodName:
            command.rawFoodName,

          targetBankedFood:
            command.targetBankedFood,

          fishingLocation:
            command.fishingLocation,

          bank:
            command.bank,

          cookingLocation:
            command.cookingLocation,

          maxFishingRuns:
            command.maxFishingRuns,

          fishPerRun:
            command.fishPerRun,

          fishingMethod:
            command.fishingMethod,
        },

        description:
          'Provision a safe reserve of cooked shrimp for future combat/recovery tasks',
      },
    ],
  };
}

/* ================================================================
 * COMMAND → PLAN STEP
 * ================================================================ */

function commandToStep(
  command:
    Command,
): PlanStep {
  const {
    type,
    params,
  } =
    command;

  switch (
    type
  ) {
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
        typeof params.script ===
          'string' &&
        params.script
          ? params.script
          : 'walk_to';

      return {
        script,

        params: {
          x,

          z,

          tolerance:
            params.tolerance ??
            3,
        },

        description:
          `Travel to (${x}, ${z})`,
      };
    }

    case 'gather': {
      const profession =
        String(
          params.profession ??
            '',
        );

      const resource =
        String(
          params.resource ??
            '',
        );

      const script =
        typeof params.script ===
          'string' &&
        params.script
          ? params.script
          : profession ||
            'gather';

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
        typeof params.script ===
          'string'
          ? params.script
          : '';

      if (
        !script
      ) {
        throw new Error(
          `generic command requires 'script' field in params`,
        );
      }

      const {
        script:
          _ignored,
        ...rest
      } =
        params;

      return {
        script,

        params:
          rest,

        description:
          `Run ${script}`,
      };
    }
  }
}
