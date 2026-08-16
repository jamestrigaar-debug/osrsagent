import dotenv from 'dotenv';
import { AIAgentConfig } from '../types/index.js';

dotenv.config();

export const config = {
  // RS-SDK Configuration
  rs_sdk: {
    baseUrl: process.env.RS_SDK_URL || 'http://localhost:3000',
    wsUrl: process.env.RS_SDK_WS || 'ws://localhost:3001',
  },

  // Bot Configuration
  bot: {
    name: process.env.BOT_NAME || 'trigaarbot8',
    password: process.env.BOT_PASSWORD || 'iMAThClkHhE8',
    viewerUrl: process.env.BOT_VIEWER_URL || 'https://rs-sdk-demo.fly.dev/bot?bot=trigaarbot8&password=iMAThClkHhE8',
  },

  // AI API Configuration
  ai: {
    provider: (process.env.AI_PROVIDER || 'openai') as 'openai' | 'anthropic' | 'custom',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4',
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '1000'),
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
  },

  // Agent Configuration
  agent: {
    pollInterval: parseInt(process.env.AGENT_POLL_INTERVAL || '1000'),
    maxActionsPerMinute: parseInt(process.env.AGENT_MAX_ACTIONS || '30'),
    enableMonitoring: process.env.ENABLE_MONITORING === 'true',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
};

export function getAIAgentConfig(): AIAgentConfig {
  return {
    apiKey: config.ai.apiKey,
    apiProvider: config.ai.provider,
    model: config.ai.model,
    maxTokens: config.ai.maxTokens,
    temperature: config.ai.temperature,
    systemPrompt: getSystemPrompt(),
  };
}

function getSystemPrompt(): string {
  return `You are an AI agent controlling a character in Old School RuneScape (OSRS) on a specialized automation server.

Your role is to:
1. Analyze the current game state and player position
2. Understand the player's inventory and available resources
3. Make optimal decisions about the next action to take
4. Provide reasoning for your decisions

You have access to the following action types:
- movement: Move to specific coordinates
- interaction: Interact with objects (trees, banks, NPCs)
- skill: Use a specific skill
- banking: Deposit/withdraw items
- wait: Wait for a condition

Always prioritize safety and efficiency. When uncertain, request more information about the game state.
Provide your decisions in JSON format with the action type, parameters, and reasoning.`;
}
