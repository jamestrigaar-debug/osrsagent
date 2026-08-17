import axios from 'axios';
import { registerScript } from '../registry.js';
import { ScriptContext, ScriptResult } from '../types.js';

// ─── use_fishing_script ───────────────────────────────────────────────────────

registerScript(
  {
    name: 'use_fishing_script',
    description: 'Fishes at the current location using the appropriate tool for the spot type.',
    params: { spot_type: 'string — shrimp | trout | lobster | shark' },
    preconditions: ['correct_tool_in_inventory', 'at_fishing_spot'],
    postconditions: ['fish_added_to_inventory', 'xp_gained:fishing'],
    verified: true,
  },
  async (params: Record<string, unknown>, ctx: ScriptContext): Promise<ScriptResult> => {
    const spotType = params['spot_type'] as string;
    try {
      await axios.post(`${ctx.sdkBaseUrl}/api/action`, {
        bot: ctx.sdkBotName,
        password: ctx.sdkBotPassword,
        action: 'fish',
        params: { spot_type: spotType },
      });
      return { success: true, message: `Started fishing (${spotType})` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `SDK error: ${msg}` };
    }
  }
);
