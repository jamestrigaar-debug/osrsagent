import { GameState, AgentAction, AgentDecision, AIAgentConfig } from '../types/index.js';
import { logger } from '../logger.js';
import { openaiProvider } from './providers/openai.js';
import { anthropicProvider } from './providers/anthropic.js';

/**
 * Main AI Agent class - decides what actions to take based on game state
 */
export class AIAgent {
  private config: AIAgentConfig;
  private actionHistory: AgentAction[] = [];
  private lastDecisionTime: number = 0;
  private minActionInterval: number = 1000; // Min 1 second between actions

  constructor(config: AIAgentConfig) {
    this.config = config;
    if (!config.apiKey) {
      throw new Error('AI API key not configured');
    }
  }

  /**
   * Get the next action to take based on game state
   */
  async decide(gameState: GameState, context: Record<string, unknown> = {}): Promise<AgentDecision> {
    try {
      // Rate limiting
      const now = Date.now();
      const timeSinceLastDecision = now - this.lastDecisionTime;
      if (timeSinceLastDecision < this.minActionInterval) {
        return {
          action: { type: 'wait', description: 'Rate limiting' },
          confidence: 1,
          alternatives: [],
        };
      }

      logger.debug({ gameState, context }, 'Making AI decision');

      const prompt = this.buildPrompt(gameState, context);
      const response = await this.callAI(prompt);
      const decision = this.parseResponse(response);

      this.lastDecisionTime = now;
      this.actionHistory.push(decision.action);

      return decision;
    } catch (error) {
      logger.error({ error }, 'Failed to make decision');
      return {
        action: { type: 'wait', description: 'Error in decision making' },
        confidence: 0,
        alternatives: [],
      };
    }
  }

  /**
   * Build the prompt for the AI model
   */
  private buildPrompt(gameState: GameState, context: Record<string, unknown>): string {
    const stateJson = JSON.stringify(gameState, null, 2);
    const contextJson = JSON.stringify(context, null, 2);

    return `Current Game State:
${stateJson}

Context:
${contextJson}

Based on the current game state and context, decide the next action to take.

Respond with a JSON object containing:
{
  "action": {
    "type": "movement" | "interaction" | "skill" | "banking" | "wait",
    "description": "Human readable description",
    "parameters": { /* action specific parameters */ }
  },
  "confidence": 0-1,
  "reasoning": "Explain your decision"
}`;
  }

  /**
   * Call the configured AI provider
   */
  private async callAI(prompt: string): Promise<string> {
    switch (this.config.apiProvider) {
      case 'openai':
        return openaiProvider.complete(prompt, this.config);
      case 'anthropic':
        return anthropicProvider.complete(prompt, this.config);
      default:
        throw new Error(`Unsupported AI provider: ${this.config.apiProvider}`);
    }
  }

  /**
   * Parse AI response into AgentDecision
   */
  private parseResponse(response: string): AgentDecision {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        action: {
          type: parsed.action.type,
          description: parsed.action.description,
          parameters: parsed.action.parameters,
          reasoning: parsed.reasoning,
        },
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
        alternatives: parsed.alternatives || [],
      };
    } catch (error) {
      logger.error({ error, response }, 'Failed to parse AI response');
      return {
        action: { type: 'wait', description: 'Failed to parse response' },
        confidence: 0,
        alternatives: [],
      };
    }
  }

  /**
   * Get action history
   */
  getActionHistory(): AgentAction[] {
    return this.actionHistory;
  }
}
