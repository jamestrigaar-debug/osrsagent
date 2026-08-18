import { registerScript } from '../registry.js';

import type {
  ScriptContext,
  ScriptResult,
} from '../types.js';

import {
  createRsSdkAdapter,
} from '../../adapters/rs-sdk.js';

/* ================================================================
 * LOCATIONS
 * ================================================================ */

const DRAYNOR_BANK = {
  name: 'Draynor Bank',
  x: 3093,
  z: 3244,
  tolerance: 5,
};

const DRAYNOR_FISHING_SAFE_PATH = [
  { x: 3093, z: 3244 }, // bank
  { x: 3103, z: 3236 }, // safe waypoint avoiding dark wizards
  { x: 3087, z: 3227 }, // actual fishing spot
];

const DRAYNOR_FISHING_SPOT = {
  name: 'Draynor Fishing',
  x: 3087,
  z: 3227,
  tolerance: 3,
};

/* ================================================================
 * FISHING TOOL NAMES BY METHOD
 * ================================================================ */

const TOOL_NAMES_BY_METHOD: Record<string, string[]> = {
  net: ['Small fishing net', 'Fishing net'],
  bait: ['Fishing rod'],
  fly: ['Fly fishing rod'],
  lure: ['Fly fishing rod'],
  cage: ['Lobster pot'],
  harpoon: ['Harpoon'],
};

/* ================================================================
 * PROVISION FOOD
 * ================================================================ */

registerScript(
  {
    name: 'provision_food',
    description:
      'Provisions a safe reserve of cooked food. Cooks existing raw food, then fishes for more if needed, cooks it, and banks the cooked food. Retreats to bank if HP drops below half.',
    params: {
      foodName: 'string — cooked food name (e.g., Shrimps)',
      rawFoodName: 'string — raw food name (e.g., Raw shrimps)',
      targetBankedFood: 'number — desired amount of cooked food in bank',
      fishingLocation: 'string — fishing location id',
      bank: 'string — bank location id',
      cookingLocation: 'string — cooking location id',
      maxFishingRuns: 'number — max fishing/cooking cycles',
      fishPerRun: 'number — raw fish to catch per run (max 26)',
      fishingMethod: 'string — net, bait, etc.',
    },
    preconditions: ['in_game'],
    postconditions: ['food_provisioned'],
    failureModes: [
      'bank_unreachable',
      'fishing_failed',
      'cooking_failed',
      'equipment_missing',
      'low_hp_retreat',
      'timeout',
      'cancelled',
    ],
    category: 'provisioning',
    verified: false,
    version: 6,
  },
  async (
    params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const adapter = createRsSdkAdapter(ctx);

    const foodName = String(params.foodName ?? 'Shrimps').trim();
    const rawFoodName = String(params.rawFoodName ?? 'Raw shrimps').trim();
    const targetBankedFood = Math.max(1, Number(params.targetBankedFood ?? 100));
    const maxFishingRuns = Math.max(1, Number(params.maxFishingRuns ?? 3));
    const fishPerRun = Math.min(26, Math.max(1, Number(params.fishPerRun ?? 26)));
    const fishingMethod = String(params.fishingMethod ?? 'net').trim().toLowerCase();

    try {
      await adapter.connect();

      console.log('================================');
      console.log('PHASE 2 FOOD PROVISIONING');
      console.log('================================');
      console.log(`[ProvisionFood] Target food: ${foodName}`);
      console.log(`[ProvisionFood] Target banked amount: ${targetBankedFood}`);

      // Helper: travel to coordinates if not already within tolerance
      const travelTo = async (loc: {x: number; z: number; tolerance: number; name?: string}) => {
        const player = adapter.getState()?.player as any;
        if (!player) return { success: false, message: 'No player state' };
        const dx = Number(player.worldX ?? player.x ?? 0);
        const dz = Number(player.worldZ ?? player.z ?? 0);
        const dist = Math.hypot(dx - loc.x, dz - loc.z);
        if (dist <= loc.tolerance) {
          console.log(`[ProvisionFood] Already at ${loc.name ?? 'destination'}.`);
          return { success: true };
        }
        console.log(`[ProvisionFood] Travelling to ${loc.name ?? `${loc.x},${loc.z}`}...`);
        const result = await adapter.walkTo(loc.x, loc.z, loc.tolerance);
        if (!result.success) return { success: false, message: result.message };
        console.log(`[ProvisionFood] Reached ${loc.name ?? 'destination'}.`);
        return { success: true };
      };

      // Helper: walk through a safe path
      const walkSafePath = async (path: Array<{x: number; z: number}>) => {
        for (const point of path) {
          console.log(`[ProvisionFood] Safe path waypoint: (${point.x}, ${point.z})`);
          const result = await adapter.walkTo(point.x, point.z, 2);
          if (!result.success) {
            return { success: false, message: `Safe path walk failed at (${point.x}, ${point.z}): ${result.message}` };
          }
        }
        return { success: true };
      };

      // Helper: withdraw fishing tool from bank
      const withdrawFishingTool = async (method: string): Promise<ScriptResult> => {
        const toolNames = TOOL_NAMES_BY_METHOD[method] ?? ['Small fishing net'];
        const bankItems = adapter.getBankItems?.() ?? [];
        const bankItem = bankItems.find((item: any) =>
          toolNames.some((name) =>
            String(item?.name ?? '').toLowerCase() === name.toLowerCase(),
          ),
        );
        if (!bankItem) {
          return {
            success: false,
            message: `No ${toolNames.join(' or ')} found in bank.`,
            data: { reason: 'tool_not_found' },
          };
        }

        // Attempt to withdraw using the exact name found
        const exactName = String(bankItem.name);
        const withdrawResult = await adapter.withdrawItem(exactName, 1);
        if (!withdrawResult.success) {
          // Fallback: try common names
          for (const name of toolNames) {
            const fallback = await adapter.withdrawItem(name, 1);
            if (fallback.success) {
              console.log(`[ProvisionFood] Withdrew ${name} successfully.`);
              return fallback;
            }
          }
          return {
            success: false,
            message: `Could not withdraw ${exactName}: ${withdrawResult.message}`,
            data: { reason: 'withdraw_failed' },
          };
        }
        console.log(`[ProvisionFood] Withdrew ${exactName}.`);
        return withdrawResult;
      };

      // Helper: get player HP
      const getHp = () => {
        const player = adapter.getState()?.player as any;
        return {
          current: Number(player?.hp ?? 0),
          max: Number(player?.maxHp ?? 1),
        };
      };

      // Helper: check if HP below half
      const isHpBelowHalf = () => {
        const { current, max } = getHp();
        return max > 0 && current / max < 0.5;
      };

      // Helper: check if HP recovered to 90% or more
      const isHpRecovered = () => {
        const { current, max } = getHp();
        return max > 0 && current / max >= 0.9;
      };

      // ---------- 1. TRAVEL TO BANK ----------
      const bankTravel = await travelTo(DRAYNOR_BANK);
      if (!bankTravel.success) {
        return { success: false, message: bankTravel.message, data: { reason: 'bank_unreachable' } };
      }

      // ---------- 2. OPEN BANK & DEPOSIT ALL ----------
      const bankOpen = await adapter.openBank();
      if (!bankOpen.success) {
        return { success: false, message: `Could not open bank: ${bankOpen.message}`, data: { reason: 'bank_open_failed' } };
      }

      const startingInventory = adapter.getInventory();
      if (startingInventory.length > 0) {
        console.log(`[ProvisionFood] Depositing current inventory (${startingInventory.length} slot(s))...`);
        const depositResult = await adapter.bankAll();
        if (!depositResult.success) {
          return { success: false, message: `Could not deposit inventory: ${depositResult.message}`, data: { reason: 'deposit_failed' } };
        }
      }

      // ---------- 3. READ BANK SUPPLIES ----------
      let bankItems = adapter.getBankItems?.() ?? [];
      let bankCooked = countItems(bankItems, foodName);
      let bankRaw = countItems(bankItems, rawFoodName);
      console.log(`[ProvisionFood] Bank inspection: cooked=${bankCooked}, raw=${bankRaw}`);

      // If already enough cooked, we are done.
      if (bankCooked >= targetBankedFood) {
        await adapter.closeBank();
        return { success: true, message: `Already have ${bankCooked} ${foodName} banked.`, data: { banked: bankCooked } };
      }

      // ---------- 4. COOK EXISTING RAW FOOD IF ANY ----------
      if (bankRaw > 0) {
        console.log(`[ProvisionFood] Found ${bankRaw} raw food already banked. Cooking it first.`);
        await adapter.closeBank();

        const cookAmount = Math.min(bankRaw, 26);
        const cookResult = await executeScript('cook_food', {
          rawFood: rawFoodName,
          cookedFood: foodName,
          amount: cookAmount,
          location: 'draynor-cooking',
        }, ctx);

        if (!cookResult.success) {
          return { success: false, message: `Cooking failed: ${cookResult.message}`, data: { phase: 'cooking', reason: cookResult.data?.reason } };
        }

        // Re-open bank and re-check
        await adapter.openBank();
        bankItems = adapter.getBankItems?.() ?? [];
        bankCooked = countItems(bankItems, foodName);
        bankRaw = countItems(bankItems, rawFoodName);
        console.log(`[ProvisionFood] After cooking: cooked=${bankCooked}, raw=${bankRaw}`);

        if (bankCooked >= targetBankedFood) {
          await adapter.closeBank();
          return { success: true, message: `Reached target: ${bankCooked} ${foodName} banked.`, data: { banked: bankCooked } };
        }
      }

      // ---------- 5. FISHING LOOP ----------
      let runs = 0;
      while (bankCooked < targetBankedFood && runs < maxFishingRuns) {
        runs++;
        console.log(`[ProvisionFood] Fishing run ${runs}/${maxFishingRuns}`);

        // Ensure bank is closed before leaving
        if (adapter.isBankOpen?.()) {
          await adapter.closeBank();
        }

        // Ensure fishing tool is in inventory
        const hasTool = checkToolInInventory(adapter, fishingMethod);
        if (!hasTool) {
          console.log(`[ProvisionFood] ${fishingMethod} tool missing. Withdrawing from bank.`);
          const bankOpenForTool = await adapter.openBank();
          if (!bankOpenForTool.success) {
            return { success: false, message: `Could not open bank for tool: ${bankOpenForTool.message}`, data: { reason: 'bank_open_failed' } };
          }
          const withdrawResult = await withdrawFishingTool(fishingMethod);
          if (!withdrawResult.success) {
            await adapter.closeBank();
            return { success: false, message: `Could not withdraw fishing tool: ${withdrawResult.message}`, data: { reason: 'equipment_missing' } };
          }
          await adapter.closeBank();
        } else {
          console.log(`[ProvisionFood] Fishing tool already in inventory.`);
        }

        // Walk safely to fishing spot
        console.log('[ProvisionFood] Walking safe path to fishing area...');
        const safeWalk = await walkSafePath(DRAYNOR_FISHING_SAFE_PATH);
        if (!safeWalk.success) {
          return { success: false, message: safeWalk.message, data: { reason: 'safe_path_failed' } };
        }

        // Fish until inventory full, fishPerRun caught, or HP below half
        console.log(`[ProvisionFood] Fishing at spot...`);
        let rawCaught = 0;
        const maxInventorySpace = 28 - adapter.getInventory().length;
        const targetRaw = Math.min(fishPerRun, maxInventorySpace);
        let attempts = 0;
        const maxAttempts = targetRaw * 4; // generous safety

        let lowHpRetreat = false;

        while (rawCaught < targetRaw && attempts < maxAttempts) {
          // Early break ONLY if inventory full or HP below half
          if (adapter.getInventory().length >= 28 || isHpBelowHalf()) {
            if (isHpBelowHalf()) {
              lowHpRetreat = true;
              console.log('[ProvisionFood] HP below half, retreating to bank.');
            } else {
              console.log('[ProvisionFood] Inventory full, stopping fishing.');
            }
            break;
          }

          attempts++;
          const fishResult = await adapter.fish(fishingMethod);
          if (!fishResult.success) {
            // If fish failed but raw fish count increased, continue
            const newRaw = countItems(adapter.getInventory(), rawFoodName);
            if (newRaw > rawCaught) {
              rawCaught = newRaw;
              continue;
            }
            // Otherwise, wait a bit and retry (even if in combat, keep trying)
            await waitForTicksSafe(adapter, 2);
            continue;
          }

          // Successful fish action; wait for catch
          await waitForTicksSafe(adapter, 3);
          const currentRaw = countItems(adapter.getInventory(), rawFoodName);
          rawCaught = currentRaw;

          // After a successful action, double-check inventory and HP
          if (adapter.getInventory().length >= 28) {
            console.log('[ProvisionFood] Inventory full after catch, stopping fishing.');
            break;
          }
          if (isHpBelowHalf()) {
            lowHpRetreat = true;
            console.log('[ProvisionFood] HP dropped below half, retreating to bank.');
            break;
          }
        }

        console.log(`[ProvisionFood] Caught ${rawCaught} raw ${rawFoodName}.`);

        // Walk back to bank (always)
        console.log('[ProvisionFood] Walking safely back to bank...');
        const reversePath = [...DRAYNOR_FISHING_SAFE_PATH].reverse();
        const safeBack = await walkSafePath(reversePath);
        if (!safeBack.success) {
          return { success: false, message: safeBack.message, data: { reason: 'safe_path_failed' } };
        }

        // Bank the raw fish
        const bankOpenAfterFishing = await adapter.openBank();
        if (!bankOpenAfterFishing.success) {
          return { success: false, message: `Could not open bank after fishing: ${bankOpenAfterFishing.message}`, data: { reason: 'bank_open_failed' } };
        }
        const fishingInventory = adapter.getInventory();
        if (fishingInventory.length > 0) {
          await adapter.bankAll();
        }
        await adapter.closeBank();

        // Update bank counts
        bankItems = adapter.getBankItems?.() ?? [];
        bankRaw = countItems(bankItems, rawFoodName);
        bankCooked = countItems(bankItems, foodName);
        console.log(`[ProvisionFood] After fishing: bank raw=${bankRaw}, cooked=${bankCooked}`);

        // If we retreated due to low HP, wait for recovery before next run
        if (lowHpRetreat) {
          console.log('[ProvisionFood] Waiting for HP to recover to 90% at bank...');
          let recoveryTicks = 0;
          while (!isHpRecovered() && recoveryTicks < 100) {
            await waitForTicksSafe(adapter, 5);
            recoveryTicks++;
          }
          if (!isHpRecovered()) {
            console.log('[ProvisionFood] HP did not recover sufficiently, ending provisioning for safety.');
            return {
              success: false,
              message: 'Retreated due to low HP and did not recover enough.',
              data: { reason: 'low_hp_retreat' },
            };
          }
          console.log('[ProvisionFood] HP recovered, resuming fishing if runs remain.');
        }

        // Cook the raw fish (if any)
        if (bankRaw > 0) {
          const cookAmount = Math.min(bankRaw, 26);
          const cookResult = await executeScript('cook_food', {
            rawFood: rawFoodName,
            cookedFood: foodName,
            amount: cookAmount,
            location: 'draynor-cooking',
          }, ctx);

          if (!cookResult.success) {
            return { success: false, message: `Cooking after fishing failed: ${cookResult.message}`, data: { phase: 'cooking', reason: cookResult.data?.reason } };
          }

          // Update bank cooked count
          await adapter.openBank();
          bankItems = adapter.getBankItems?.() ?? [];
          bankCooked = countItems(bankItems, foodName);
          bankRaw = countItems(bankItems, rawFoodName);
          console.log(`[ProvisionFood] After cooking: bank cooked=${bankCooked}, raw=${bankRaw}`);
          await adapter.closeBank();
        }
      }

      // ---------- 6. FINAL CHECK ----------
      if (adapter.isBankOpen?.()) {
        await adapter.closeBank();
      }
      await adapter.openBank();
      bankItems = adapter.getBankItems?.() ?? [];
      bankCooked = countItems(bankItems, foodName);
      await adapter.closeBank();

      return {
        success: bankCooked >= targetBankedFood,
        message: `Provisioning finished. ${bankCooked} ${foodName} banked.`,
        data: { banked: bankCooked, target: targetBankedFood },
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

/* ================================================================
 * HELPER FUNCTIONS
 * ================================================================ */

function countItems(items: any[], name: string): number {
  const wanted = name.trim().toLowerCase();
  let total = 0;
  for (const item of items) {
    const itemName = String(item?.name ?? '').trim().toLowerCase();
    if (itemName === wanted) {
      const qty = Number(item?.quantity ?? item?.count ?? 1);
      if (Number.isFinite(qty)) total += qty;
    }
  }
  return total;
}

function checkToolInInventory(adapter: any, method: string): boolean {
  const toolNames = TOOL_NAMES_BY_METHOD[method] ?? ['Small fishing net'];
  const inventory = adapter.getInventory?.() ?? [];
  return inventory.some((item: any) =>
    toolNames.some((name) =>
      String(item?.name ?? '').toLowerCase() === name.toLowerCase(),
    ),
  );
}

async function waitForTicksSafe(adapter: any, ticks: number): Promise<void> {
  const sdk = adapter?.sdk;
  if (sdk && typeof sdk.waitForTicks === 'function') {
    await sdk.waitForTicks(ticks);
  }
}

// Execute another script from this script.
async function executeScript(name: string, params: any, ctx: ScriptContext): Promise<ScriptResult> {
  if (typeof (ctx as any).executeScript === 'function') {
    return (ctx as any).executeScript(name, params);
  }

  const { getScript } = await import('../registry.js');
  const entry = getScript(name);
  if (!entry) {
    return {
      success: false,
      message: `Script ${name} not registered`,
      data: { reason: 'script_not_found' },
    };
  }
  return entry.handler(params, { ...ctx, adapter: ctx.adapter });
}
