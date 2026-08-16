/**
 * Core type definitions for OSRS AI Agent
 */

export interface GameState {
  inGame: boolean;
  player?: {
    worldX: number;
    worldZ: number;
    health: number;
    maxHealth: number;
    level: number;
  };
  inventory?: InventoryItem[];
}

export interface InventoryItem {
  name: string;
  count: number;
  slot: number;
}

export interface AgentAction {
  type: 'movement' | 'interaction' | 'skill' | 'banking' | 'wait';
  description: string;
  parameters?: Record<string, unknown>;
  reasoning?: string;
}

export interface AgentDecision {
  action: AgentAction;
  confidence: number; // 0-1
  alternatives: AgentAction[];
}

export interface AIAgentConfig {
  apiKey: string;
  apiProvider: 'openai' | 'anthropic' | 'custom';
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt: string;
}

export interface AgentSession {
  id: string;
  botName: string;
  password: string;
  viewerUrl: string;
  startTime: Date;
  isActive: boolean;
  stats: AgentStats;
}

export interface AgentStats {
  decisionsCount: number;
  successfulActions: number;
  failedActions: number;
  totalRuntime: number;
  lastAction?: AgentAction;
  lastActionTime?: Date;
}

export interface BotInstance {
  name: string;
  password: string;
  apiUrl: string;
  wsUrl?: string;
}
