import {
  loadMemory,
  updateMemory,
  storePlan,
  clearPlan,
  recordActionResult,
  appendHistory,
} from '../memory/store.js';
import { createSnapshot } from '../memory/snapshots.js';
import { AccountMemory, ActivePlan, ActionResult } from '../memory/types.js';
import { executeScript } from '../scripts/executor.js';
import { getAllManifests } from '../scripts/registry.js';
import { ScriptContext } from '../scripts/types.js';
import { Planner } from '../planner/planner.js';
import { shouldEscalate, isGoalMet, EscalationEvent } from './escalation.js';
import { config } from '../config/index.js';
import { logger } from '../logger.js';

export type DispatchResult =
  | { status: 'ok'; message: string }
  | { status: 'escalated'; event: EscalationEvent }
  | { status: 'goal_met'; goal: string }
  | { status: 'no_goal' };

/**
 * Dispatcher — Tier 2 executor.
 * Reads the current plan step, checks preconditions (via Memory), runs the script,
 * updates Memory, and advances the plan pointer. Escalates to Planner when needed.
 */
export class Dispatcher {
  private consecutiveFailures: Map<string, number> = new Map();
  private planner: Planner;

  constructor(planner: Planner) {
    this.planner = planner;
  }

  /**
   * Execute one tick for a given account.
   */
  async tick(accountId: string): Promise<DispatchResult> {
    const memory = loadMemory(accountId);

    // User request short-circuits everything
    if (memory.userRequest) {
      return this.handleUserRequest(memory);
    }

    // No goal — nothing to do
    if (!memory.currentGoal) {
      return { status: 'no_goal' };
    }

    // No plan — escalate to Planner
    if (!memory.activePlan) {
      return this.escalateToPlanner(memory, 'no_plan', 'No active plan');
    }

    const plan = memory.activePlan;

    // Goal already met?
    if (isGoalMet(memory, plan)) {
      clearPlan(accountId);
      appendHistory(accountId, `Goal met: ${plan.goal}`);
      return { status: 'goal_met', goal: plan.goal };
    }

    // Plan exhausted — loop or escalate
    if (plan.currentStepIndex >= plan.steps.length) {
      if (plan.loopUntil) {
        // Reset to start of plan for looping
        const reset: ActivePlan = { ...plan, currentStepIndex: 0 };
        storePlan(accountId, reset);
        return { status: 'ok', message: 'Plan loop reset' };
      }
      clearPlan(accountId);
      return this.escalateToPlanner(loadMemory(accountId), 'plan_complete', 'Plan finished without loop condition');
    }

    const step = plan.steps[plan.currentStepIndex];
    const ctx = this.buildContext(memory);

    const scriptResult = await executeScript(step.script, step.params, ctx);
    const actionResult: ActionResult = {
      success: scriptResult.success,
      message: scriptResult.message,
      timestamp: Date.now(),
      data: scriptResult.data,
    };
    recordActionResult(accountId, actionResult);

    if (!scriptResult.success) {
      const failures = (this.consecutiveFailures.get(accountId) ?? 0) + 1;
      this.consecutiveFailures.set(accountId, failures);

      if (shouldEscalate(accountId, plan, failures)) {
        this.consecutiveFailures.set(accountId, 0);
        return this.escalateToPlanner(
          loadMemory(accountId),
          'repeated_failure',
          `Step '${step.script}' failed ${failures} times: ${scriptResult.message}`
        );
      }

      return { status: 'ok', message: `Step failed, will retry: ${scriptResult.message}` };
    }

    // Success — advance plan pointer
    this.consecutiveFailures.set(accountId, 0);
    const advanced: ActivePlan = { ...plan, currentStepIndex: plan.currentStepIndex + 1 };
    storePlan(accountId, advanced);

    return { status: 'ok', message: `Step '${step.script}' succeeded` };
  }

  private async handleUserRequest(memory: AccountMemory): Promise<DispatchResult> {
    const request = memory.userRequest!;
    logger.info({ accountId: memory.accountId, request }, 'Dispatcher: handling user request');
    // Clear the request flag, update goal, then let Planner handle it
    updateMemory(memory.accountId, { userRequest: undefined, currentGoal: request });
    clearPlan(memory.accountId);
    return this.escalateToPlanner(loadMemory(memory.accountId), 'user_request', request);
  }

  private async escalateToPlanner(
    memory: AccountMemory,
    reason: EscalationEvent['reason'],
    context: string
  ): Promise<DispatchResult> {
    logger.info({ accountId: memory.accountId, reason, context }, 'Dispatcher: escalating to Planner');

    const event: EscalationEvent = { accountId: memory.accountId, reason, context, memory };

    try {
      const snapshot = createSnapshot(memory);
      const manifests = getAllManifests();
      const plan = await this.planner.generatePlan(snapshot, manifests, memory.currentGoal);
      storePlan(memory.accountId, plan);
      return { status: 'ok', message: `New plan created: ${plan.planId}` };
    } catch (err) {
      logger.error({ err, accountId: memory.accountId }, 'Planner failed');
      return { status: 'escalated', event };
    }
  }

  private buildContext(memory: AccountMemory): ScriptContext {
    return {
      accountId: memory.accountId,
      sdkBaseUrl: config.rs_sdk.baseUrl,
      sdkBotName: config.bot.name,
      sdkBotPassword: config.bot.password,
    };
  }
}
