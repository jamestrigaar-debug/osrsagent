import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { MemorySnapshot } from '../memory/types.js';
import { ScriptManifest } from '../scripts/types.js';
import { ActivePlan } from '../memory/types.js';
import { PlanJSON, planFromJSON } from './schema.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';
import { config } from '../config/index.js';
import { logger } from '../logger.js';

/**
 * Tier 1 Planner — calls an expensive LLM to generate a structured plan.
 * Called infrequently: on new goal, plan completion, or unrecoverable error.
 */
export class Planner {
  private callCount = 0;

  /**
   * Generate a new plan for the given goal.
   */
  async generatePlan(
    snapshot: MemorySnapshot,
    manifests: ScriptManifest[],
    goal: string
  ): Promise<ActivePlan> {
    this.callCount++;
    logger.info({ goal, callCount: this.callCount }, 'Planner: generating plan');

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(snapshot, manifests, goal);

    const rawJson = await this.callLLM(systemPrompt, userPrompt);
    const planJson = this.parseResponse(rawJson);
    const plan = planFromJSON(planJson);

    logger.info({ planId: plan.planId, steps: plan.steps.length }, 'Planner: plan generated');
    return plan;
  }

  private async callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
    const provider = config.ai.provider;

    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey: config.ai.apiKey });
      const msg = await client.messages.create({
        model: config.ai.model || 'claude-3-5-sonnet-20241022',
        max_tokens: config.ai.maxTokens || 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const block = msg.content[0];
      if (block.type !== 'text') throw new Error('Unexpected Anthropic response type');
      return block.text;
    }

    // Default: OpenAI
    const client = new OpenAI({ apiKey: config.ai.apiKey });
    const completion = await client.chat.completions.create({
      model: config.ai.model || 'gpt-4',
      max_tokens: config.ai.maxTokens || 2048,
      temperature: config.ai.temperature ?? 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    return completion.choices[0]?.message?.content ?? '';
  }

  private parseResponse(raw: string): PlanJSON {
    const text = raw.trim();
    // Strip optional markdown fences
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    try {
      return JSON.parse(stripped) as PlanJSON;
    } catch {
      throw new Error(`Planner returned invalid JSON: ${stripped.slice(0, 200)}`);
    }
  }

  getCallCount(): number {
    return this.callCount;
  }
}
