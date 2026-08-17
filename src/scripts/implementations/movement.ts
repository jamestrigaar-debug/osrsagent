import axios from 'axios';
import { registerScript } from '../registry.js';
import { ScriptContext, ScriptResult } from '../types.js';

// ─── check_skill_level ────────────────────────────────────────────────────────

registerScript(
  {
    name: 'check_skill_level',
    description: 'Reads the current level and XP for the specified skill from the game state.',
    params: { skill: 'string — skill name (e.g. fishing, woodcutting)' },
    preconditions: ['in_game'],
    postconditions: ['skill_data_in_memory'],
    verified: true,
  },
  async (params: Record<string, unknown>, ctx: ScriptContext): Promise<ScriptResult> => {
    const skill = params['skill'] as string;
    try {
      const resp = await axios.get(`${ctx.sdkBaseUrl}/api/skills`, {
        params: { bot: ctx.sdkBotName, password: ctx.sdkBotPassword },
      });
      const skills = resp.data as Record<string, { level: number; xp: number }>;
      const data = skills[skill];
      if (!data) {
        return { success: false, message: `Skill '${skill}' not found in response` };
      }
      return {
        success: true,
        message: `${skill}: level ${data.level}, xp ${data.xp}`,
        data: { [skill]: data },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `SDK error: ${msg}` };
    }
  }
);

// ─── walk_to ─────────────────────────────────────────────────────────────────

registerScript(
  {
    name: 'walk_to',
    description: 'Walks the player to the specified location name or world coordinates.',
    params: {
      location: 'string — named location (e.g. draynor_fishing_spot) OR "x,z" coordinates',
    },
    preconditions: ['in_game'],
    postconditions: ['player_at_location'],
    verified: true,
  },
  async (params: Record<string, unknown>, ctx: ScriptContext): Promise<ScriptResult> => {
    const location = params['location'] as string;
    try {
      await axios.post(`${ctx.sdkBaseUrl}/api/action`, {
        bot: ctx.sdkBotName,
        password: ctx.sdkBotPassword,
        action: 'walk',
        params: { location },
      });
      return { success: true, message: `Walking to ${location}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `SDK error: ${msg}` };
    }
  }
);
