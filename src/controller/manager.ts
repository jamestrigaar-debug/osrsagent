import { SDKClient } from '../sdk/client.js';
import { AIAgent } from '../ai/agent.js';
import { GameState, AgentSession, AgentStats } from '../types/index.js';
import { config, getAIAgentConfig } from '../config/index.js';
import { logger } from '../logger.js';

/**
 * Agent Manager - Coordinates SDK client with AI Agent
 */
export class AgentManager {
  private sdkClient: SDKClient;
  private aiAgent: AIAgent;
  private session: AgentSession;
  private isRunning: boolean = false;
  private actionQueue: Array<() => Promise<boolean>> = [];

  constructor(botName?: string, botPassword?: string) {
    const name = botName || config.bot.name;
    const password = botPassword || config.bot.password;

    this.sdkClient = new SDKClient(name, password);
    this.aiAgent = new AIAgent(getAIAgentConfig());

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

  /**
   * Start the agent loop
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Agent already running');
      return;
    }

    this.isRunning = true;
    this.session.isActive = true;

    logger.info(
      {
        botName: this.session.botName,
        viewerUrl: this.session.viewerUrl,
      },
      'Starting AI Agent'
    );

    try {
      await this.mainLoop();
    } catch (error) {
      logger.error({ error }, 'Agent error');
      this.stop();
    }
  }

  /**
   * Main agent loop
   */
  private async mainLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // Get current game state
        const gameState = await this.sdkClient.getGameState();

        if (!gameState) {
          logger.warn('No game state available');
          await this.sleep(config.agent.pollInterval);
          continue;
        }

        // Get AI decision
        const decision = await this.aiAgent.decide(gameState, {
          sessionId: this.session.id,
          viewerUrl: this.session.viewerUrl,
        });

        this.session.stats.decisionsCount++;

        logger.info(
          {
            action: decision.action.type,
            confidence: decision.confidence,
            reasoning: decision.action.reasoning,
          },
          'AI Decision'
        );

        // Execute action if confidence is high enough
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

        await this.sleep(config.agent.pollInterval);
      } catch (error) {
        logger.error({ error }, 'Main loop error');
        await this.sleep(config.agent.pollInterval);
      }
    }
  }

  /**
   * Execute an action from AI decision
   */
  private async executeAction(action: Parameters<any>[0]): Promise<boolean> {
    try {
      switch (action.type) {
        case 'movement':
          return await this.sdkClient.walkTo(
            action.parameters?.x || 0,
            action.parameters?.z || 0
          );

        case 'interaction':
          return await this.sdkClient.interact(
            action.parameters?.objectId || 0,
            action.parameters?.action || 'interact'
          );

        case 'wait':
          await this.sleep(action.parameters?.duration || 1000);
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

  /**
   * Stop the agent
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    this.session.isActive = false;
    this.session.stats.totalRuntime = Date.now() - this.session.startTime.getTime();

    logger.info(
      {
        sessionId: this.session.id,
        stats: this.session.stats,
      },
      'Agent stopped'
    );
  }

  /**
   * Get current session
   */
  getSession(): AgentSession {
    return this.session;
  }

  /**
   * Utility sleep function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
