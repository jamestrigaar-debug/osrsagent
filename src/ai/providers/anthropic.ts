import axios from 'axios';
import { AIAgentConfig } from '../../types/index.js';
import { logger } from '../../logger.js';

/**
 * Anthropic Claude API provider for AI decisions
 */
export const anthropicProvider = {
  async complete(prompt: string, config: AIAgentConfig): Promise<string> {
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: config.model,
          max_tokens: config.maxTokens || 1000,
          system: config.systemPrompt,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        },
        {
          headers: {
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
        }
      );

      const content = response.data.content[0]?.text;
      if (!content) {
        throw new Error('No content in Anthropic response');
      }

      return content;
    } catch (error) {
      logger.error({ error }, 'Anthropic API error');
      throw error;
    }
  },
};
