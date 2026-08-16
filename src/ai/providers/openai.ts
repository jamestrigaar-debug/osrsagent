import axios from 'axios';
import { AIAgentConfig } from '../../types/index.js';
import { logger } from '../../logger.js';

/**
 * OpenAI API provider for AI decisions
 */
export const openaiProvider = {
  async complete(prompt: string, config: AIAgentConfig): Promise<string> {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: config.model,
          messages: [
            {
              role: 'system',
              content: config.systemPrompt,
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          max_tokens: config.maxTokens || 1000,
          temperature: config.temperature || 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const content = response.data.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      return content;
    } catch (error) {
      logger.error({ error }, 'OpenAI API error');
      throw error;
    }
  },
};
