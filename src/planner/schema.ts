import { ActivePlan, PlanStep, LoopCondition } from '../memory/types.js';

/**
 * Raw JSON schema for a plan as produced by the Planner LLM.
 */
export interface PlanJSON {
  plan_id: string;
  goal: string;
  steps: Array<{
    script: string;
    params: Record<string, unknown>;
    description?: string;
  }>;
  loop_until?: {
    skill?: string;
    level?: number;
    item_count?: Record<string, number>;
    custom?: string;
  };
  on_missing_capability: 'invoke_sdk_or_ask_user';
}

/**
 * Convert a raw PlanJSON (from LLM) to the internal ActivePlan representation.
 */
export function planFromJSON(raw: PlanJSON): ActivePlan {
  const steps: PlanStep[] = raw.steps.map(s => ({
    script: s.script,
    params: s.params,
    description: s.description,
  }));

  const loopUntil: LoopCondition | undefined = raw.loop_until
    ? {
        skill: raw.loop_until.skill,
        level: raw.loop_until.level,
        itemCount: raw.loop_until.item_count,
        custom: raw.loop_until.custom,
      }
    : undefined;

  return {
    planId: raw.plan_id,
    goal: raw.goal,
    steps,
    currentStepIndex: 0,
    loopUntil,
    onMissingCapability: raw.on_missing_capability,
    createdAt: Date.now(),
  };
}

/**
 * JSON Schema sent to the Planner so it knows exactly what to produce.
 */
export const PLAN_JSON_SCHEMA = {
  type: 'object',
  required: ['plan_id', 'goal', 'steps', 'on_missing_capability'],
  properties: {
    plan_id: { type: 'string' },
    goal: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['script', 'params'],
        properties: {
          script: { type: 'string' },
          params: { type: 'object' },
          description: { type: 'string' },
        },
      },
    },
    loop_until: {
      type: 'object',
      properties: {
        skill: { type: 'string' },
        level: { type: 'number' },
        item_count: { type: 'object' },
        custom: { type: 'string' },
      },
    },
    on_missing_capability: {
      type: 'string',
      enum: ['invoke_sdk_or_ask_user'],
    },
  },
};
