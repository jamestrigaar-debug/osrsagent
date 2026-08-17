import { AccountMemory, ActivePlan } from '../memory/types.js';
import { loadMemory, updateMemory } from '../memory/store.js';
import { logger } from '../logger.js';

const MAX_RETRIES = 3;

export type EscalationReason =
  | 'no_plan'
  | 'plan_complete'
  | 'repeated_failure'
  | 'missing_capability'
  | 'user_request';

export interface EscalationEvent {
  accountId: string;
  reason: EscalationReason;
  context: string;
  memory: AccountMemory;
}

/**
 * Check whether a plan step should be retried or escalated.
 */
export function shouldEscalate(
  accountId: string,
  plan: ActivePlan,
  consecutiveFailures: number
): boolean {
  if (consecutiveFailures >= MAX_RETRIES) {
    logger.warn({ accountId, planId: plan.planId, consecutiveFailures }, 'Max retries reached — escalating');
    return true;
  }
  return false;
}

/**
 * Check if the loop_until condition is satisfied in memory.
 */
export function isGoalMet(memory: AccountMemory, plan: ActivePlan): boolean {
  const cond = plan.loopUntil;
  if (!cond) return false;

  if (cond.skill && cond.level !== undefined) {
    const skillData = memory.skills[cond.skill];
    if (skillData && skillData.level >= cond.level) {
      logger.info(
        { accountId: memory.accountId, skill: cond.skill, level: skillData.level, target: cond.level },
        'Goal condition met'
      );
      return true;
    }
  }

  if (cond.itemCount) {
    for (const [item, required] of Object.entries(cond.itemCount)) {
      const slot = memory.inventory.find(i => i.name === item);
      if (!slot || slot.quantity < required) return false;
    }
    return true;
  }

  return false;
}

/**
 * Mark a user request in memory so the orchestrator can handle it.
 */
export function flagUserRequest(accountId: string, request: string): void {
  loadMemory(accountId); // ensure account exists
  updateMemory(accountId, { userRequest: request });
  logger.info({ accountId, request }, 'User request flagged');
}
