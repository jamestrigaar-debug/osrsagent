import { MemorySnapshot } from '../memory/types.js';
import { ScriptManifest } from '../scripts/types.js';
import { PLAN_JSON_SCHEMA } from './schema.js';

/**
 * Build the Planner system prompt.
 */
export function buildSystemPrompt(): string {
  return `You are a strategic planner for an OSRS (Old School RuneScape) automation agent.
Your job is to produce a structured execution plan — JSON only, no prose — given the current game state, available scripts, and the player's goal.

Rules:
1. Only use scripts from the provided "available_scripts" list.
2. If a required capability is missing, set "on_missing_capability": "invoke_sdk_or_ask_user".
3. Use "loop_until" whenever the goal is level- or quantity-based.
4. Keep the plan minimal: only include steps necessary to make progress toward the goal.
5. Output ONLY valid JSON matching the provided schema. No markdown fences, no explanations.

Schema:
${JSON.stringify(PLAN_JSON_SCHEMA, null, 2)}`;
}

/**
 * Build the Planner user prompt for a single API call.
 */
export function buildUserPrompt(
  snapshot: MemorySnapshot,
  manifests: ScriptManifest[],
  goal: string
): string {
  return JSON.stringify(
    {
      memory_snapshot: snapshot,
      available_scripts: manifests,
      goal,
    },
    null,
    2
  );
}
