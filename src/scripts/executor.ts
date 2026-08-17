import { getScript } from './registry.js';
import { ScriptContext, ScriptResult } from './types.js';
import { logger } from '../logger.js';

/**
 * Execute a named script with the given parameters.
 * Returns a structured result; never throws — errors are captured in the result.
 */
export async function executeScript(
  scriptName: string,
  params: Record<string, unknown>,
  context: ScriptContext
): Promise<ScriptResult> {
  const entry = getScript(scriptName);
  if (!entry) {
    return {
      success: false,
      message: `Unknown script: ${scriptName}`,
    };
  }

  logger.info({ scriptName, params, accountId: context.accountId }, 'Executing script');

  try {
    const result = await entry.handler(params, context);
    logger.info({ scriptName, result }, 'Script completed');
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error, scriptName }, 'Script threw exception');
    return {
      success: false,
      message: `Script error: ${message}`,
    };
  }
}
