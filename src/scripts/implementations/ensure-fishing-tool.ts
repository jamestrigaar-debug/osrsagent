import { registerScript } from '../registry.js';

import type {
  ScriptContext,
  ScriptResult,
} from '../types.js';

import {
  createRsSdkAdapter,
} from '../../adapters/rs-sdk.js';

/* ================================================================
 * FISHING TOOL CONFIGURATION
 * ================================================================ */

const TOOL_BY_METHOD: Record<string, string> = {
  net: 'Small fishing net',
  bait: 'Fishing rod',
  fly: 'Fly fishing rod',
  lure: 'Fly fishing rod',
  cage: 'Lobster pot',
  harpoon: 'Harpoon',
};

const DEFAULT_BANK = {
  name: 'Draynor Bank',
  x: 3093,
  z: 3244,
  tolerance: 5,
};

registerScript(
  {
    name: 'ensure_fishing_tool',
    description:
      'Ensures the player has the correct fishing tool for the requested method. Withdraws it from the bank if missing.',
    params: {
      method: 'string — fishing method: net, bait, fly, lure, cage, harpoon',
      location: 'string — optional fishing location id (used for return travel)',
    },
    preconditions: ['in_game'],
    postconditions: ['tool_in_inventory'],
    failureModes: ['tool_not_found', 'bank_unreachable', 'inventory_full', 'timeout', 'cancelled'],
    category: 'preparation',
    verified: false,
    version: 1,
  },
  async (
    params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const adapter = createRsSdkAdapter(ctx);

    const method = String(params.method ?? 'net').trim().toLowerCase();
    const toolName = TOOL_BY_METHOD[method];

    if (!toolName) {
      return {
        success: false,
        message: `Unknown fishing method: ${method}`,
        data: { reason: 'invalid_method' },
      };
    }

    try {
      await adapter.connect();

      console.log(`[EnsureFishingTool] Ensuring tool for ${method}: ${toolName}`);

      // Check inventory first.
      const inventory = adapter.getInventory();
      const hasTool = inventory.some((item: any) =>
        item?.name?.toLowerCase() === toolName.toLowerCase(),
      );

      if (hasTool) {
        console.log(`[EnsureFishingTool] ${toolName} already in inventory.`);
        return {
          success: true,
          message: `${toolName} already in inventory.`,
          data: { tool: toolName },
        };
      }

      // Tool missing – we need the bank.
      // First travel to bank.
      const bankTravel = await adapter.walkTo(
        DEFAULT_BANK.x,
        DEFAULT_BANK.z,
        DEFAULT_BANK.tolerance,
      );
      if (!bankTravel.success) {
        return {
          success: false,
          message: `Could not reach bank: ${bankTravel.message}`,
          data: { reason: 'bank_unreachable' },
        };
      }

      // Open bank.
      const bankOpen = await adapter.openBank();
      if (!bankOpen.success) {
        return {
          success: false,
          message: `Could not open bank: ${bankOpen.message}`,
          data: { reason: 'bank_open_failed' },
        };
      }

      // Check if tool exists in bank.
      const bankItems = adapter.getBankItems?.() ?? [];
      const bankItem = bankItems.find((item: any) =>
        item?.name?.toLowerCase() === toolName.toLowerCase(),
      );

      if (!bankItem) {
        await adapter.closeBank();
        return {
          success: false,
          message: `${toolName} not found in bank.`,
          data: { reason: 'tool_not_found' },
        };
      }

      // Withdraw one tool.
      const withdrawResult = await adapter.withdrawItem(toolName, 1);
      if (!withdrawResult.success) {
        await adapter.closeBank();
        return {
          success: false,
          message: `Could not withdraw ${toolName}: ${withdrawResult.message}`,
          data: { reason: 'withdraw_failed' },
        };
      }

      console.log(`[EnsureFishingTool] Withdrew ${toolName}.`);
      await adapter.closeBank();

      // Return to fishing location (if provided, otherwise just return success).
      // The gathering core will handle walking to the spot afterwards.
      const locationId = String(params.location ?? '').trim().toLowerCase();
      if (locationId === 'draynor-fishing') {
        // Use safe path to avoid dark wizards.
        const safePath = [
          { x: 3093, z: 3244 }, // bank
          { x: 3104, z: 3244 }, // east
          { x: 3104, z: 3230 }, // south
          { x: 3098, z: 3230 }, // west to fishing area
        ];

        console.log('[EnsureFishingTool] Walking safe path back to fishing area.');
        for (const point of safePath) {
          const walkResult = await adapter.walkTo(point.x, point.z, 2);
          if (!walkResult.success) {
            return {
              success: false,
              message: `Safe path walk failed: ${walkResult.message}`,
              data: { reason: 'safe_path_failed' },
            };
          }
        }
      }

      return {
        success: true,
        message: `${toolName} is now in inventory.`,
        data: { tool: toolName },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
        data: { reason: 'exception' },
      };
    } finally {
      try {
        await adapter.disconnect();
      } catch {
        // Ignore cleanup.
      }
    }
  },
);
