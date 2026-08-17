import { SDKClient } from '../sdk/client.js';
import { AIAgent } from '../ai/agent.js';
import { AgentSession } from '../types/index.js';
import { config } from '../config/index.js';
import { logger } from '../logger.js';

/**
 * Agent Manager - Coordinates SDK client with AI Agent (legacy single-tier mode)
 * @deprecated Use Orchestrator for the two-tier Planner/Dispatcher architecture
 */
export class AgentManager {
  private sdkClient: SDKClient;
  private aiAgent: AIAgent;
  private session: AgentSession;
  private isRunning: boolean = false;

  constructor(botName?: string, botPassword?: string) {
    const name = botName || config.bot.name;
    const password = botPassword || config.bot.password;

    this.sdkClient = new SDKClient(name, password);
    this.aiAgent = new AIAgent({
      apiKey: config.ai.apiKey,
      apiProvider: config.ai.provider,
      model: config.ai.model,
      maxTokens: config.ai.maxTokens,
      temperature: config.ai.temperature,
      systemPrompt: '',
    });

    this.session = {
      id: `session-${Date.now()}`,
      botName: name,
      password,
      viewerUrl: config.bot.viewerUrl,
      startTime: new Date(),
      isActive: false,
      stats: {
        decisionsCount: 0,
        successfulActions: 0,
        failedActions: 0,
        totalRuntime: 0,
      },
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Agent already running');
      return;
    }

    this.isRunning = true;
    this.session.isActive = true;

    logger.info(
      { botName: this.session.botName, viewerUrl: this.session.viewerUrl },
      'Starting AI Agent (legacy mode)'
    );

    try {
      await this.mainLoop();
    } catch (error) {
      logger.error({ error }, 'Agent error');
      this.stop();
    }
  }

  private async mainLoop(): Promise<void> {
    const pollInterval = config.orchestrator.dispatchInterval;
    while (this.isRunning) {
      try {
        const gameState = await this.sdkClient.getGameState();

        if (!gameState) {
          logger.warn('No game state available');
          await this.sleep(pollInterval);
          continue;
        }

        const decision = await this.aiAgent.decide(gameState, {
          sessionId: this.session.id,
          viewerUrl: this.session.viewerUrl,
        });

        this.session.stats.decisionsCount++;

        logger.info(
          { action: decision.action.type, confidence: decision.confidence },
          'AI Decision'
        );

        if (decision.confidence > 0.6) {
          const success = await this.executeAction(decision.action);
          if (success) {
            this.session.stats.successfulActions++;
          } else {
            this.session.stats.failedActions++;
          }
        }

        this.session.stats.lastAction = decision.action;
        this.session.stats.lastActionTime = new Date();

        await this.sleep(pollInterval);
      } catch (error) {
        logger.error({ error }, 'Main loop error');
        await this.sleep(pollInterval);
      }
    }
  }

  private async executeAction(action: { type: string; parameters?: Record<string, unknown> }): Promise<boolean> {
    try {
      switch (action.type) {
        case 'movement':
          return await this.sdkClient.walkTo(
            (action.parameters?.['x'] as number) || 0,
            (action.parameters?.['z'] as number) || 0
          );
        case 'interaction':
          return await this.sdkClient.interact(
            (action.parameters?.['objectId'] as number) || 0,
            (action.parameters?.['action'] as string) || 'interact'
          );
        case 'wait':
          await this.sleep((action.parameters?.['duration'] as number) || 1000);
          return true;
        default:
          logger.warn({ actionType: action.type }, 'Unknown action type');
          return false;
      }
    } catch (error) {
      logger.error({ error, action }, 'Failed to execute action');
      return false;
    }
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.session.isActive = false;
    this.session.stats.totalRuntime = Date.now() - this.session.startTime.getTime();
    logger.info({ sessionId: this.session.id, stats: this.session.stats }, 'Agent stopped');
  }

  getSession(): AgentSession {
    return this.session;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
