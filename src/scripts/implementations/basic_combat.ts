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

const COW_FIELD = {
  name: 'Lumbridge Cow Field',
  x: 3253,
  z: 3290,
  tolerance: 5,
};

const GOBLIN_FIELD = {
  name: 'Lumbridge Goblins',
  x: 3255,
  z: 3230,
  tolerance: 6,
};

/* ================================================================
 * DEFAULT FOOD / GEAR / COOKING
 * ================================================================ */

const DEFAULT_FOOD = 'Shrimps';
const RAW_MEAT_NAME = 'Raw beef';
const COOKED_MEAT_NAME = 'Cooked meat';
const LOGS_NAME = 'Logs';
const TINDERBOX_NAME = 'Tinderbox';

const WEAPON_PATTERNS = [
  /sword/i,
  /scimitar/i,
  /mace/i,
  /axe/i,
  /warhammer/i,
  /dagger/i,
  /spear/i,
  /halberd/i,
  /2h sword/i,
  /longsword/i,
  /shortsword/i,
  /battleaxe/i,
  /claws/i,
];

const ARMOR_SLOT_PATTERNS: Record<string, RegExp[]> = {
  head: [/helm/i, /hood/i, /hat/i, /coif/i, /cowl/i],
  body: [/platebody/i, /chestplate/i, /chainbody/i, /torso/i, /robe top/i, /leather body/i],
  legs: [/platelegs/i, /plateskirt/i, /chainlegs/i, /legs/i, /robe bottom/i, /leather chaps/i],
  shield: [/shield/i, /defender/i, /book/i],
  cape: [/cape/i, /cloak/i],
  amulet: [/amulet/i, /necklace/i],
  gloves: [/gloves/i, /vambraces/i],
  boots: [/boots/i],
  ring: [/ring/i],
};

/* ================================================================
 * PATROL POINTS GENERATION
 * ================================================================ */

function generatePatrolPoints(
  centerX: number,
  centerZ: number,
  radius: number,
  step: number,
): Array<{ x: number; z: number }> {
  const points: Array<{ x: number; z: number }> = [];
  for (let dx = -radius; dx <= radius; dx += step) {
    for (let dz = -radius; dz <= radius; dz += step) {
      if (dx === 0 && dz === 0) continue;
      points.push({ x: centerX + dx, z: centerZ + dz });
    }
  }
  // Sort by distance from center (spiral-ish)
  points.sort((a, b) => {
    const da = Math.hypot(a.x - centerX, a.z - centerZ);
    const db = Math.hypot(b.x - centerX, b.z - centerZ);
    return da - db;
  });
  return points;
}

/* ================================================================
 * TARGET AREA RESOLVER
 * ================================================================ */

function getCombatArea(target: string): { name: string; x: number; z: number; tolerance: number } {
  const lower = target.toLowerCase();
  if (lower.includes('cow')) {
    return COW_FIELD;
  }
  if (lower.includes('goblin')) {
    return GOBLIN_FIELD;
  }
  // Default to cow field for unknown targets
  return COW_FIELD;
}

/* ================================================================
 * BASIC COMBAT SCRIPT
 * ================================================================ */

registerScript(
  {
    name: 'basic_combat',
    description:
      'Provisions food if needed, withdraws food/gear and (for cow targets) cooking supplies, then fights the target. Loots only the killed mob tile, buries bones, cooks raw beef when out of shrimps (cows only), heals to full HP, patrols if no target found, and returns to Draynor bank when all food exhausted or inventory full.',
    params: {
      target: 'string — NPC name to fight (default "Cow", also supports "Goblin")',
      foodName: 'string — cooked food name (default "Shrimps")',
      rawFoodName: 'string — raw food name (default "Raw shrimps")',
      weaponName: 'string — optional weapon to withdraw/equip (leave empty for auto)',
      armorNames: 'string[] — optional armor pieces to withdraw/equip (leave empty for auto)',
      foodWithdraw: 'number — amount of food to carry (default 14)',
      buryBones: 'boolean — bury regular bones (default true)',
      maxTrips: 'number — max bank trips (0 = infinite)',
    },
    preconditions: ['in_game'],
    postconditions: ['combat_finished'],
    failureModes: [
      'bank_unreachable',
      'provisioning_failed',
      'gear_missing',
      'target_not_found',
      'died',
      'timeout',
      'cancelled',
    ],
    category: 'combat',
    verified: false,
    version: 9,
  },
  async (
    params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const adapter = createRsSdkAdapter(ctx);

    // Normalize target name
    const rawTarget = String(params.target ?? 'Cow').trim();
    const target = rawTarget.charAt(0).toUpperCase() + rawTarget.slice(1).toLowerCase();

    const foodName = String(params.foodName ?? DEFAULT_FOOD).trim();
    const rawFoodName = String(params.rawFoodName ?? 'Raw shrimps').trim();
    const weaponName = String(params.weaponName ?? '').trim();
    const armorNames = Array.isArray(params.armorNames)
      ? (params.armorNames as string[]).map((s: string) => s.trim()).filter(Boolean)
      : [];
    const foodWithdraw = Math.max(1, Number(params.foodWithdraw ?? 14));
    const buryBones = params.buryBones !== false;
    const maxTrips = Math.max(0, Number(params.maxTrips ?? 0));

    // Determine combat area and cow-specific raw meat cooking.
    const combatArea = getCombatArea(target);
    const isCowTarget = target.toLowerCase().includes('cow');

    // Generate patrol points for the chosen area.
    const patrolPoints = generatePatrolPoints(combatArea.x, combatArea.z, 12, 4);

    try {
      await adapter.connect();

      console.log('================================');
      console.log('BASIC COMBAT CONTROLLER');
      console.log('================================');
      console.log(`[Combat] Target: ${target}`);
      console.log(`[Combat] Combat area: ${combatArea.name}`);
      console.log(`[Combat] Food: ${foodName}, carry ${foodWithdraw}`);
      console.log(`[Combat] Bury bones: ${buryBones}`);
      if (isCowTarget) {
        console.log(`[Combat] Cow target detected — will cook ${RAW_MEAT_NAME} as backup food.`);
      }

      let bot = (adapter as any).bot;
      let sdk = (adapter as any).sdk;

      if (!bot || !sdk) {
        return {
          success: false,
          message: 'Bot SDK not available on adapter.',
          data: { reason: 'sdk_missing' },
        };
      }

      // -------------------------------------------------------------
      // Helper: travel to Draynor bank
      // -------------------------------------------------------------
      const travelToBank = async () => {
        console.log(`[Combat] Travelling to Draynor Bank...`);
        const result = await executeScript('travel_to', {
          location: `${DRAYNOR_BANK.x},${DRAYNOR_BANK.z}`,
          tolerance: DRAYNOR_BANK.tolerance,
          announce: false,
        }, ctx);
        if (!result.success) {
          return { success: false, message: result.message };
        }
        return { success: true };
      };

      // Helper: travel to arbitrary coords
      const travelTo = async (loc: {x: number; z: number; tolerance: number; name?: string}) => {
        const player = adapter.getState()?.player as any;
        if (!player) return { success: false, message: 'No player state' };
        const dx = Number(player.worldX ?? player.x ?? 0);
        const dz = Number(player.worldZ ?? player.z ?? 0);
        const dist = Math.hypot(dx - loc.x, dz - loc.z);
        if (dist <= loc.tolerance) {
          console.log(`[Combat] Already at ${loc.name ?? 'destination'}.`);
          return { success: true };
        }
        console.log(`[Combat] Travelling to ${loc.name ?? `${loc.x},${loc.z}`}...`);
        const result = await executeScript('travel_to', {
          location: `${loc.x},${loc.z}`,
          tolerance: loc.tolerance,
          announce: false,
        }, ctx);
        if (!result.success) return { success: false, message: result.message };
        console.log(`[Combat] Reached ${loc.name ?? 'destination'}.`);
        return { success: true };
      };

      const findInventoryItem = (pattern: string | RegExp) => {
        return sdk.findInventoryItem?.(pattern) ?? null;
      };

      const countInventoryItems = (pattern: string | RegExp) => {
        return sdk.countInventoryItems?.(pattern) ??
          (adapter.getInventory().filter((i: any) => new RegExp(pattern, 'i').test(i.name)).reduce((sum: number, i: any) => sum + (i.count ?? 1), 0));
      };

      const eatFood = async (pattern: RegExp) => {
        const foodItem = findInventoryItem(pattern);
        if (!foodItem) return false;
        console.log(`[Combat] Eating ${foodItem.name}.`);
        const beforeHp = Number(sdk.getState()?.player?.hp ?? 0);
        const result = await bot.eatFood?.(foodItem);
        if (result?.success) {
          await sdk.waitForTicks?.(2);
          const afterHp = Number(sdk.getState()?.player?.hp ?? 0);
          return afterHp > beforeHp;
        }
        return false;
      };

      const getHp = () => {
        const player = sdk.getState()?.player as any;
        return {
          current: Number(player?.hp ?? 0),
          max: Number(player?.maxHp ?? 1),
        };
      };

      const isHpBelowFull = () => {
        const { current, max } = getHp();
        return max > 0 && current < max;
      };

      const isInventoryFull = () => adapter.getInventory().length >= 28;

      const buryBonesInInventory = async () => {
        if (!buryBones) return;
        const bones = findInventoryItem(/bones/i);
        if (!bones) return;
        console.log('[Combat] Burying bones.');
        const inventory = adapter.getInventory();
        const slot = inventory.findIndex((i: any) => /bones/i.test(i.name ?? ''));
        if (slot === -1) return;
        const item = inventory[slot];
        let buryOptionIndex = -1;
        const options = item.options ?? item.actions ?? [];
        if (Array.isArray(options)) {
          buryOptionIndex = options.findIndex((opt: string) => /bury/i.test(opt));
        }
        if (buryOptionIndex === -1) buryOptionIndex = 0;
        try {
          await sdk.sendUseItem(slot, buryOptionIndex + 1);
          await sdk.waitForTicks?.(2);
        } catch (e) {
          console.log(`[Combat] Failed to bury bones: ${e}`);
        }
      };

      // Loot only the exact tile
      const lootAtTile = async (x: number, z: number) => {
        const groundItems = sdk.getGroundItems?.() ?? [];
        const itemsAtTile = groundItems.filter((g: any) => {
          const gx = Number(g?.x ?? g?.worldX ?? 0);
          const gz = Number(g?.z ?? g?.worldZ ?? 0);
          return gx === x && gz === z;
        });

        for (const ground of itemsAtTile) {
          const name = ground?.name?.toLowerCase() ?? '';
          if (name === 'coins' || name === 'bones' || (isCowTarget && name === RAW_MEAT_NAME.toLowerCase())) {
            console.log(`[Combat] Looting ${name} from kill tile.`);
            const result = await bot.pickupItem?.(ground);
            if (result?.success) {
              console.log(`[Combat] Picked up ${name}.`);
            }
          }
        }
      };

      // -------------------------------------------------------------
      // Cooking helpers (for raw beef when cow target)
      // -------------------------------------------------------------
      const makeFire = async (): Promise<boolean> => {
        if (typeof bot.burnLogs !== 'function') {
          console.log('[Combat] Firemaking not available via bot.burnLogs');
          return false;
        }
        try {
          console.log('[Combat] Lighting a fire...');
          const result = await bot.burnLogs(LOGS_NAME);
          if (result?.success) {
            console.log('[Combat] Fire created.');
            await sdk.waitForTicks?.(2);
            return true;
          }
          return false;
        } catch (error) {
          console.log(`[Combat] makeFire error: ${error instanceof Error ? error.message : String(error)}`);
          return false;
        }
      };

      const cookRawMeat = async (): Promise<boolean> => {
        const rawMeat = findInventoryItem(new RegExp(`^${escapeRegex(RAW_MEAT_NAME)}$`, 'i'));
        if (!rawMeat) return false; // nothing to cook

        // Check if we have tinderbox and logs
        const tinderbox = findInventoryItem(new RegExp(`^${escapeRegex(TINDERBOX_NAME)}$`, 'i'));
        if (!tinderbox) {
          console.log('[Combat] No tinderbox, cannot cook raw beef.');
          return false;
        }

        // Find or create fire
        let fire = sdk.findNearbyLoc?.(/fire/i) ?? null;
        if (!fire && typeof sdk.scanFindNearbyLoc === 'function') {
          fire = await sdk.scanFindNearbyLoc(/fire/i, 10);
        }

        if (!fire) {
          // Try to light fire if we have logs
          const logs = findInventoryItem(new RegExp(`^${escapeRegex(LOGS_NAME)}$`, 'i'));
          if (!logs) {
            console.log('[Combat] No logs to light fire, cannot cook raw beef.');
            return false;
          }
          if (!(await makeFire())) {
            return false;
          }
          // After lighting, find fire again
          fire = sdk.findNearbyLoc?.(/fire/i) ?? null;
          if (!fire && typeof sdk.scanFindNearbyLoc === 'function') {
            fire = await sdk.scanFindNearbyLoc(/fire/i, 10);
          }
          if (!fire) return false;
        }

        // Use raw meat on fire
        console.log('[Combat] Cooking raw beef on fire...');
        const result = await bot.useItemOnLoc?.(rawMeat, fire, { timeout: 8000 });
        if (result?.success) {
          await sdk.waitForTicks?.(3);
          // Check if cooked meat appears
          const cookedCount = countInventoryItems(new RegExp(`^${escapeRegex(COOKED_MEAT_NAME)}$`, 'i'));
          return cookedCount > 0;
        }
        return false;
      };

      // -------------------------------------------------------------
      // Banking function (deposit all, withdraw food/gear/supplies)
      // -------------------------------------------------------------
      const doBanking = async (): Promise<ScriptResult> => {
        // 1. Travel to bank
        const bankTravel = await travelToBank();
        if (!bankTravel.success) return bankTravel;

        // 2. Open bank
        const bankOpen = await adapter.openBank();
        if (!bankOpen.success) return bankOpen;

        // 3. Deposit all inventory
        const inv = adapter.getInventory();
        if (inv.length > 0) {
          console.log('[Combat] Depositing current inventory...');
          const deposit = await adapter.bankAll();
          if (!deposit.success) return deposit;
        }

        // 4. Check food supply
        const bankItems = adapter.getBankItems?.() ?? [];
        const bankFood = countItems(bankItems, foodName);
        if (bankFood < foodWithdraw) {
          console.log(`[Combat] Bank has only ${bankFood} ${foodName}, need ${foodWithdraw}. Running provisioning...`);
          await adapter.closeBank();
          const provisionResult = await executeScript('provision_food', {
            foodName,
            rawFoodName,
            targetBankedFood: foodWithdraw,
            fishingLocation: 'draynor-fishing',
            bank: 'draynor-bank',
            cookingLocation: 'draynor-cooking',
            maxFishingRuns: 1,
            fishPerRun: 26,
            fishingMethod: 'net',
          }, ctx);
          if (!provisionResult.success) {
            return {
              success: false,
              message: `Provisioning failed: ${provisionResult.message}`,
              data: { reason: 'provisioning_failed' },
            };
          }
          // Reopen bank and refresh bot/sdk references
          const reopen = await adapter.openBank();
          if (!reopen.success) return reopen;
          bot = (adapter as any).bot;
          sdk = (adapter as any).sdk;
        }

        // 5. Withdraw food
        console.log(`[Combat] Withdrawing ${foodWithdraw} ${foodName}...`);
        let withdrawn = 0;
        for (let i = 0; i < foodWithdraw && !isInventoryFull(); i++) {
          const before = countInventoryItems(new RegExp(`^${escapeRegex(foodName)}$`, 'i'));
          const result = await adapter.withdrawItem(foodName, 1);
          if (!result.success) break;
          await sdk.waitForTicks?.(1);
          const after = countInventoryItems(new RegExp(`^${escapeRegex(foodName)}$`, 'i'));
          if (after > before) withdrawn++;
          else break;
        }
        if (withdrawn <= 0) {
          await adapter.closeBank();
          return { success: false, message: `Could not withdraw any ${foodName}.`, data: { reason: 'food_withdraw_failed' } };
        }

        // 6. Withdraw weapon and armor
        const findBankItem = (pattern: RegExp | string) => {
          return (adapter.getBankItems?.() ?? []).find((item: any) => {
            const name = String(item?.name ?? '').toLowerCase();
            if (typeof pattern === 'string') {
              return name === pattern.toLowerCase();
            }
            return pattern.test(name);
          }) ?? null;
        };

        let weaponItem = null;
        if (weaponName) {
          weaponItem = findBankItem(weaponName);
        } else {
          for (const pattern of WEAPON_PATTERNS) {
            weaponItem = findBankItem(pattern);
            if (weaponItem) break;
          }
        }

        if (weaponItem) {
          console.log(`[Combat] Withdrawing weapon: ${weaponItem.name}`);
          const wd = await adapter.withdrawItem(weaponItem.name, 1);
          if (wd.success) {
            const invWeapon = sdk.findInventoryItem(new RegExp(`^${escapeRegex(weaponItem.name)}$`, 'i'));
            if (invWeapon) {
              console.log(`[Combat] Equipping weapon: ${weaponItem.name}`);
              await bot.equipItem?.(invWeapon);
            }
          }
        } else {
          console.log('[Combat] No weapon found in bank, fighting unarmed.');
        }

        const armorToEquip: string[] = [];
        if (armorNames.length > 0) {
          armorToEquip.push(...armorNames);
        } else {
          for (const [slot, patterns] of Object.entries(ARMOR_SLOT_PATTERNS)) {
            for (const pattern of patterns) {
              const item = findBankItem(pattern);
              if (item) {
                armorToEquip.push(item.name);
                break;
              }
            }
          }
        }

        for (const pieceName of armorToEquip) {
          const bankItem = findBankItem(pieceName);
          if (!bankItem) continue;
          console.log(`[Combat] Withdrawing armor: ${bankItem.name}`);
          const wd = await adapter.withdrawItem(bankItem.name, 1);
          if (wd.success) {
            const invPiece = sdk.findInventoryItem(new RegExp(`^${escapeRegex(bankItem.name)}$`, 'i'));
            if (invPiece) {
              console.log(`[Combat] Equipping armor: ${bankItem.name}`);
              await bot.equipItem?.(invPiece);
            }
          }
        }

        // 7. If cow target, withdraw tinderbox and logs (if available)
        if (isCowTarget) {
          const tinderboxBankItem = findBankItem(TINDERBOX_NAME);
          if (tinderboxBankItem) {
            console.log(`[Combat] Withdrawing tinderbox.`);
            await adapter.withdrawItem(TINDERBOX_NAME, 1);
          }

          const logsBankItem = findBankItem(LOGS_NAME);
          if (logsBankItem) {
            let logCount = 0;
            while (logCount < 5 && !isInventoryFull()) {
              const before = countInventoryItems(new RegExp(`^${escapeRegex(LOGS_NAME)}$`, 'i'));
              const result = await adapter.withdrawItem(LOGS_NAME, 1);
              if (!result.success) break;
              await sdk.waitForTicks?.(1);
              const after = countInventoryItems(new RegExp(`^${escapeRegex(LOGS_NAME)}$`, 'i'));
              if (after > before) logCount++;
              else break;
            }
            console.log(`[Combat] Withdrew ${logCount} logs.`);
          }
        }

        // 8. Close bank
        await adapter.closeBank();
        return { success: true, message: 'Banking complete' };
      };

      // -------------------------------------------------------------
      // Patrol / target search
      // -------------------------------------------------------------
      let lastSuccessTile: { x: number; z: number } | null = null;

      const scoutForTarget = async (): Promise<any | null> => {
        // First, check if last success tile has target
        if (lastSuccessTile) {
          const player = adapter.getState()?.player as any;
          if (player) {
            const dist = Math.hypot(
              Number(player.worldX ?? 0) - lastSuccessTile.x,
              Number(player.worldZ ?? 0) - lastSuccessTile.z,
            );
            if (dist <= 10) {
              const npc = sdk.findNearbyNpc?.(new RegExp(`^${escapeRegex(target)}$`, 'i'));
              if (npc) return npc;
            }
          }
        }

        console.log('[Combat] Starting patrol to find target...');
        for (const point of patrolPoints) {
          // If in combat, stop and attack
          if (sdk.getState()?.player?.combat?.inCombat) return null;

          // Travel to point
          const travel = await travelTo({ x: point.x, z: point.z, tolerance: 2 });
          if (!travel.success) continue;

          // Wait a moment for state update
          await sdk.waitForTicks?.(2);

          // Check for target
          const npc = sdk.findNearbyNpc?.(new RegExp(`^${escapeRegex(target)}$`, 'i'));
          if (npc) {
            console.log(`[Combat] Found ${target} at patrol point (${point.x},${point.z}).`);
            return npc;
          }
        }

        console.log('[Combat] Patrol complete, no target found.');
        return null;
      };

      // Bone sweep: pick up and bury bones within a radius
      const sweepBones = async () => {
        if (!buryBones) return;
        console.log('[Combat] Performing bone sweep...');
        const player = adapter.getState()?.player as any;
        if (!player) return;
        const px = Number(player.worldX ?? player.x ?? 0);
        const pz = Number(player.worldZ ?? player.z ?? 0);

        const groundItems = sdk.getGroundItems?.() ?? [];
        const bonesItems = groundItems.filter((g: any) => {
          const name = g?.name?.toLowerCase() ?? '';
          const dist = Math.hypot(Number(g?.x ?? 0) - px, Number(g?.z ?? 0) - pz);
          return name === 'bones' && dist <= 10;
        });

        for (const bones of bonesItems) {
          if (isInventoryFull()) break;
          console.log('[Combat] Bone sweep: picking up bones.');
          const pickup = await bot.pickupItem?.(bones);
          if (pickup?.success) {
            console.log('[Combat] Bone sweep: burying bones.');
            await buryBonesInInventory();
          }
        }
        console.log('[Combat] Bone sweep complete.');
      };

      // -------------------------------------------------------------
      // MAIN FLOW
      // -------------------------------------------------------------

      // Initial banking
      const initialBanking = await doBanking();
      if (!initialBanking.success) {
        return { success: false, message: initialBanking.message, data: initialBanking.data };
      }

      // Travel to combat area
      const areaTravel = await travelTo(combatArea);
      if (!areaTravel.success) {
        return { success: false, message: areaTravel.message, data: { reason: 'travel_failed' } };
      }

      // Main combat loop
      let trips = 0;
      while (maxTrips === 0 || trips < maxTrips) {
        trips++;
        console.log(`[Combat] Trip ${trips}`);

        // Determine food available (shrimps + cooked meat for cows)
        const foodPattern = isCowTarget
          ? new RegExp(`^(Shrimps|${escapeRegex(COOKED_MEAT_NAME)})$`, 'i')
          : new RegExp(`^${escapeRegex(foodName)}$`, 'i');

        const foodLeft = countInventoryItems(foodPattern);

        // If out of food, try to cook raw meat first (if cow target and raw meat present)
        if (foodLeft <= 0 && isCowTarget) {
          const rawMeatCount = countInventoryItems(new RegExp(`^${escapeRegex(RAW_MEAT_NAME)}$`, 'i'));
          if (rawMeatCount > 0) {
            console.log('[Combat] Out of shrimps but have raw beef, attempting to cook.');
            const cooked = await cookRawMeat();
            if (cooked) {
              const newFoodLeft = countInventoryItems(foodPattern);
              if (newFoodLeft > 0) {
                continue; // continue loop, we now have food
              }
            }
          }
        }

        // If still out of food, bank
        if (foodLeft <= 0) {
          console.log('[Combat] Out of food, banking and restocking.');
          const bankResult = await doBanking();
          if (!bankResult.success) return bankResult;
          const backToArea = await travelTo(combatArea);
          if (!backToArea.success) return backToArea;
          continue;
        }

        // Eat until full HP
        while (isHpBelowFull() && countInventoryItems(foodPattern) > 0) {
          const ate = await eatFood(foodPattern);
          if (!ate) break;
        }

        // Bury any bones in inventory
        await buryBonesInInventory();

        // If inventory full, bank
        if (isInventoryFull()) {
          console.log('[Combat] Inventory full, banking.');
          const bankResult = await doBanking();
          if (!bankResult.success) return bankResult;
          const backToArea = await travelTo(combatArea);
          if (!backToArea.success) return backToArea;
          continue;
        }

        // Find and attack a target
        let npcTarget = sdk.findNearbyNpc?.(new RegExp(`^${escapeRegex(target)}$`, 'i'));
        if (!npcTarget) {
          console.log(`[Combat] No ${target} found nearby. Starting patrol...`);
          npcTarget = await scoutForTarget();
          if (!npcTarget) {
            console.log('[Combat] No target found after patrol. Doing bone sweep...');
            await sweepBones();
            continue;
          }
        }

        // Record tile of target for looting
        const targetX = Number(npcTarget.worldX ?? npcTarget.x ?? 0);
        const targetZ = Number(npcTarget.worldZ ?? npcTarget.z ?? 0);

        console.log(`[Combat] Attacking ${target} at (${targetX},${targetZ}).`);
        const attackResult = await bot.attack?.(npcTarget);
        if (!attackResult?.success) {
          console.log(`[Combat] Attack failed: ${attackResult?.message}.`);
          await sdk.waitForTicks?.(3);
          continue;
        }

        // Remember successful location
        lastSuccessTile = { x: targetX, z: targetZ };

        // Wait for combat to end
        let combatTimeout = 0;
        while (sdk.getState()?.player?.combat?.inCombat && combatTimeout < 100) {
          await sdk.waitForTicks?.(2);
          combatTimeout++;
          if (isHpBelowFull() && countInventoryItems(foodPattern) > 0) {
            await eatFood(foodPattern);
          }
        }

        // Loot only the exact tile where the mob died
        await lootAtTile(targetX, targetZ);
        // Bury any bones picked up
        await buryBonesInInventory();
      }

      console.log(`[Combat] Finished ${trips} trips.`);
      return {
        success: true,
        message: `Combat completed after ${trips} trips.`,
        data: { trips },
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
