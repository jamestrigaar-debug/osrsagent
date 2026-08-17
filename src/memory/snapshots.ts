import { AccountMemory, MemorySnapshot } from './types.js';

/**
 * Create a compact snapshot of account memory suitable for sending to the Planner LLM.
 * Keeps the payload small by limiting history to the last 10 entries.
 */
export function createSnapshot(memory: AccountMemory): MemorySnapshot {
  return {
    accountId: memory.accountId,
    skills: memory.skills,
    inventory: memory.inventory,
    equipment: memory.equipment,
    location: memory.location,
    currentGoal: memory.currentGoal,
    lastActionResult: memory.lastActionResult,
    historyRecent: memory.history.slice(-10),
  };
}
