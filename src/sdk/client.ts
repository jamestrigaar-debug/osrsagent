import axios, { AxiosInstance } from 'axios';
import { config } from '../config/index.js';
import { GameState, InventoryItem } from '../types/index.js';
import { logger } from '../logger.js';

/**
 * Client for communicating with rs-sdk
 */
export class SDKClient {
  private client: AxiosInstance;
  private botName: string;
  private botPassword: string;

  constructor(botName?: string, botPassword?: string) {
    this.botName = botName || config.bot.name;
    this.botPassword = botPassword || config.bot.password;

    this.client = axios.create({
      baseURL: config.rs_sdk.baseUrl,
      timeout: 30000,
    });
  }

  /**
   * Get current game state
   */
  async getGameState(): Promise<GameState | null> {
    try {
      const response = await this.client.get('/api/state', {
        params: {
          bot: this.botName,
          password: this.botPassword,
        },
      });
      return response.data;
    } catch (error) {
      logger.error({ error, bot: this.botName }, 'Failed to get game state');
      return null;
    }
  }

  /**
   * Get player inventory
   */
  async getInventory(): Promise<InventoryItem[]> {
    try {
      const response = await this.client.get('/api/inventory', {
        params: {
          bot: this.botName,
          password: this.botPassword,
        },
      });
      return response.data || [];
    } catch (error) {
      logger.error({ error, bot: this.botName }, 'Failed to get inventory');
      return [];
    }
  }

  /**
   * Execute an action (walk, interact, etc)
   */
  async executeAction(actionType: string, params: Record<string, unknown>): Promise<boolean> {
    try {
      await this.client.post('/api/action', {
        bot: this.botName,
        password: this.botPassword,
        action: actionType,
        params,
      });
      return true;
    } catch (error) {
      logger.error({ error, bot: this.botName, actionType }, 'Failed to execute action');
      return false;
    }
  }

  /**
   * Walk to coordinates
   */
  async walkTo(x: number, z: number): Promise<boolean> {
    return this.executeAction('walk', { x, z });
  }

  /**
   * Interact with object
   */
  async interact(objectId: number, action: string): Promise<boolean> {
    return this.executeAction('interact', { objectId, action });
  }

  /**
   * Wait for condition to be met
   */
  async waitForCondition(
    condition: (state: GameState) => boolean,
    timeoutMs: number = 30000
  ): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
      const state = await this.getGameState();
      if (state && condition(state)) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return false;
  }
}
