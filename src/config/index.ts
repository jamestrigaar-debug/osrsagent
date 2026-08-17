import dotenv from 'dotenv';

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
    password: process.env.BOT_PASSWORD || '',
    viewerUrl: process.env.BOT_VIEWER_URL || '',
  },

  // AI API Configuration (Planner / Tier-1 LLM)
  ai: {
    provider: (process.env.AI_PROVIDER || 'openai') as 'openai' | 'anthropic' | 'custom',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4',
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '2048'),
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.2'),
  },

  // Orchestrator Configuration
  orchestrator: {
    dispatchInterval: parseInt(process.env.DISPATCH_INTERVAL || '500'),
    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '4000'),
    maxActionsPerMinute: parseInt(process.env.AGENT_MAX_ACTIONS || '30'),
    logLevel: process.env.LOG_LEVEL || 'info',
  },
};
