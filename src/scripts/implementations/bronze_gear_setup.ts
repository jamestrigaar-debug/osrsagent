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

const VARROCK_WEST_BANK = {
  name: 'Varrock West Bank',
  x: 3185,
  z: 3436,
  tolerance: 5,
};

const VARROCK_FURNACE = {
  name: 'Varrock Furnace',
  x: 3275,
  z: 3186,
  tolerance: 5,
};

const VARROCK_ANVIL = {
  name: 'Varrock Anvil',
  x: 3272,
  z: 3188,
  tolerance: 5,
};

/* ================================================================
 * ITEMS REQUIRED
 * ================================================================ */

const REQUIRED_ITEMS = [
  { product: 'bronze helm', bars: 1 },
  { product: 'bronze platebody', bars: 5 },
  { product: 'bronze platelegs', bars: 3 },
  { product: 'bronze kiteshield', bars: 3 },
  { product: 'bronze sword', bars: 1 },
];

const TOTAL_BRONZE_BARS = REQUIRED_ITEMS.reduce((sum, item) => sum + item.bars, 0);

// Required ores per bronze bar = 1 copper + 1 tin
const REQUIRED_COPPER = TOTAL_BRONZE_BARS;
const REQUIRED_TIN = TOTAL_BRONZE_BARS;

/* ================================================================
 * BRONZE GEAR SETUP SCRIPT
 * ================================================================ */

registerScript(
  {
    name: 'bronze_gear_setup',
    description:
      'Automates the full process to obtain a bronze melee set: mines copper/tin, smelts bronze bars, smiths and equips helm, platebody, platelegs, kiteshield, and sword.',
    params: {
      // Currently no configurable params; the script has fixed goals.
    },
    preconditions: ['in_game'],
    postconditions: ['bronze_gear_equipped'],
    failureModes: [
      'bank_unreachable',
      'gathering_failed',
      'smelting_failed',
      'smithing_failed',
      'equipment_missing',
      'timeout',
      'cancelled',
    ],
    category: 'progression',
    verified: false,
    version: 4,
  },
  async (
    _params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const adapter = createRsSdkAdapter(ctx);

    try {
      await adapter.connect();

      console.log('================================');
      console.log('BRONZE GEAR SETUP');
      console.log('================================');
      console.log(`[Bronze] Need ${TOTAL_BRONZE_BARS} bronze bars`);
      console.log(`[Bronze] Required ores: ${REQUIRED_COPPER} copper, ${REQUIRED_TIN} tin`);

      const bot = (adapter as any).bot;
      const sdk = (adapter as any).sdk;

      if (!bot || !sdk) {
        return {
          success: false,
          message: 'Bot SDK not available on adapter.',
          data: { reason: 'sdk_missing' },
        };
      }

      // -------------------------------------------------------------
      // Helpers
      // -------------------------------------------------------------

      const travelTo = async (loc: {x: number; z: number; tolerance: number; name?: string}) => {
        const player = adapter.getState()?.player as any;
        if (!player) return { success: false, message: 'No player state' };
        const dx = Number(player.worldX ?? player.x ?? 0);
        const dz = Number(player.worldZ ?? player.z ?? 0);
        const dist = Math.hypot(dx - loc.x, dz - loc.z);
        if (dist <= loc.tolerance) {
          console.log(`[Bronze] Already at ${loc.name ?? 'destination'}.`);
          return { success: true };
        }
        console.log(`[Bronze] Travelling to ${loc.name ?? `${loc.x},${loc.z}`}...`);
        const result = await executeScript('travel_to', {
          location: `${loc.x},${loc.z}`,
          tolerance: loc.tolerance,
          announce: false,
        }, ctx);
        if (!result.success) return { success: false, message: result.message };
        console.log(`[Bronze] Reached ${loc.name ?? 'destination'}.`);
        return { success: true };
      };

      const countInventoryItems = (pattern: string | RegExp) => {
        return sdk.countInventoryItems?.(pattern) ??
          (adapter.getInventory().filter((i: any) => new RegExp(pattern, 'i').test(i.name)).reduce((sum: number, i: any) => sum + (i.count ?? 1), 0));
      };

      const findInventoryItem = (pattern: string | RegExp) => {
        return sdk.findInventoryItem?.(pattern) ?? null;
      };

      const countBankItems = (pattern: string | RegExp) => {
        const bankItems = adapter.getBankItems?.() ?? [];
        return bankItems.reduce((sum, item: any) => {
          if (new RegExp(pattern, 'i').test(item.name ?? '')) {
            return sum + (item.quantity ?? item.count ?? 1);
          }
          return sum;
        }, 0);
      };

      // -------------------------------------------------------------
      // Banking: deposit all, ensure hammer and pickaxe
      // -------------------------------------------------------------
      const prepareBank = async (): Promise<ScriptResult> => {
        // Travel to Varrock West Bank
        const bankTravel = await travelTo(VARROCK_WEST_BANK);
        if (!bankTravel.success) return bankTravel;

        const bankOpen = await adapter.openBank();
        if (!bankOpen.success) return bankOpen;

        // Deposit all
        const inv = adapter.getInventory();
        if (inv.length > 0) {
          console.log('[Bronze] Depositing current inventory...');
          const deposit = await adapter.bankAll();
          if (!deposit.success) return deposit;
        }

        // Ensure pickaxe is in bank or inventory
        const pickaxe = findInventoryItem(/pickaxe/i) ??
          (adapter.getBankItems?.() ?? []).find((item: any) => /pickaxe/i.test(item.name ?? ''));
        if (!pickaxe) {
          console.log('[Bronze] No pickaxe found. Will rely on ensure_mining_tool to buy one.');
        } else if (!findInventoryItem(/pickaxe/i)) {
          // Withdraw pickaxe if in bank
          const pickaxeBank = (adapter.getBankItems?.() ?? []).find((item: any) => /pickaxe/i.test(item.name ?? ''));
          if (pickaxeBank) {
            console.log(`[Bronze] Withdrawing pickaxe: ${pickaxeBank.name}`);
            await adapter.withdrawItem(pickaxeBank.name, 1);
          }
        }

        // Ensure hammer is in inventory (needed for smithing)
        const hammerInInv = findInventoryItem(/hammer/i);
        if (!hammerInInv) {
          const hammerBank = (adapter.getBankItems?.() ?? []).find((item: any) => /hammer/i.test(item.name ?? ''));
          if (hammerBank) {
            console.log(`[Bronze] Withdrawing hammer: ${hammerBank.name}`);
            await adapter.withdrawItem(hammerBank.name, 1);
          } else {
            console.log('[Bronze] No hammer found. Buying from general store...');
            // Buy hammer from Lumbridge General Store
            const shop = { name: 'Lumbridge General Store', x: 3212, z: 3247, tolerance: 6 };
            const shopTravel = await travelTo(shop);
            if (!shopTravel.success) return shopTravel;
            const shopOpen = await adapter.openShop();
            if (shopOpen.success) {
              const buyResult = await adapter.buyFromShop('Hammer', 1);
              if (!buyResult.success) {
                await adapter.closeShop();
                return { success: false, message: 'Could not buy hammer', data: { reason: 'equipment_missing' } };
              }
              await adapter.closeShop();
            } else {
              return { success: false, message: 'Could not open shop to buy hammer', data: { reason: 'shop_open_failed' } };
            }
            // Return to Varrock West Bank and keep hammer in inventory
            const backToBank = await travelTo(VARROCK_WEST_BANK);
            if (!backToBank.success) return backToBank;
            // Reopen bank so we can deposit loot later but keep hammer
            const reopen = await adapter.openBank();
            if (reopen.success) {
              // Deposit all except hammer? We'll just close; next gather will use bankAll which deposits hammer too, but we'll re-withdraw later.
              await adapter.closeBank();
            }
          }
        }

        await adapter.closeBank();
        return { success: true, message: 'Bank prepared' };
      };

      // -------------------------------------------------------------
      // Gather ores until required amount is banked
      // -------------------------------------------------------------
      const gatherOreUntil = async (resource: 'copper' | 'tin', needed: number): Promise<ScriptResult> => {
        console.log(`[Bronze] Ensuring ${needed} ${resource} ore in bank...`);

        const bankPattern = resource === 'copper' ? /^Copper ore$/i : /^Tin ore$/i;

        // Loop until bank has enough
        while (true) {
          // Travel to Varrock West Bank and check current bank count
          const bankTravel = await travelTo(VARROCK_WEST_BANK);
          if (!bankTravel.success) return bankTravel;

          const bankOpen = await adapter.openBank();
          if (!bankOpen.success) return bankOpen;
          const banked = countBankItems(bankPattern);
          await adapter.closeBank();

          if (banked >= needed) {
            console.log(`[Bronze] Already have ${banked} ${resource} ore.`);
            return { success: true, message: `Have enough ${resource} ore` };
          }

          console.log(`[Bronze] Mining ${resource} ore (banked ${banked}/${needed})...`);

          // Call gather with maxCycles high enough to fill inventory and bank
          const result = await executeScript('gather', {
            profession: 'mining',
            location: 'varrock-east',
            resource: resource,
            maxCycles: 30, // enough to fill a full inventory and bank
          }, ctx);

          if (!result.success) {
            if (result.data?.reason === 'low_hp') {
              console.log('[Bronze] Low HP during mining, waiting for regen...');
              await sdk.waitForTicks?.(10);
              continue;
            }
            return {
              success: false,
              message: `Gathering ${resource} failed: ${result.message}`,
              data: { reason: 'gathering_failed', resource },
            };
          }

          // After gather, travel to bank and deposit any remaining ores (should already be banked, but just in case)
          const bankAfterGather = await travelTo(VARROCK_WEST_BANK);
          if (!bankAfterGather.success) return bankAfterGather;
          const bankOpenAfter = await adapter.openBank();
          if (!bankOpenAfter.success) return bankOpenAfter;
          await adapter.bankAll();
          await adapter.closeBank();

          console.log('[Bronze] Deposited ores. Re-checking bank count...');
          // Loop will re-check count on next iteration
        }
      };

      // -------------------------------------------------------------
      // Smelting bronze bars
      // -------------------------------------------------------------
      const smeltBronzeBars = async (): Promise<ScriptResult> => {
        console.log('[Bronze] Smelting bronze bars...');

        // Travel to Varrock West Bank to withdraw ores
        const bankTravel = await travelTo(VARROCK_WEST_BANK);
        if (!bankTravel.success) return bankTravel;

        const bankOpen = await adapter.openBank();
        if (!bankOpen.success) return bankOpen;

        // Withdraw required copper and tin
        console.log(`[Bronze] Withdrawing ${TOTAL_BRONZE_BARS} copper and ${TOTAL_BRONZE_BARS} tin ores...`);
        for (let i = 0; i < TOTAL_BRONZE_BARS; i++) {
          const copperWithdraw = await adapter.withdrawItem('Copper ore', 1);
          if (!copperWithdraw.success) {
            await adapter.closeBank();
            return { success: false, message: 'Could not withdraw copper ore', data: { reason: 'smelting_failed' } };
          }
          const tinWithdraw = await adapter.withdrawItem('Tin ore', 1);
          if (!tinWithdraw.success) {
            await adapter.closeBank();
            return { success: false, message: 'Could not withdraw tin ore', data: { reason: 'smelting_failed' } };
          }
        }
        await adapter.closeBank();

        // Travel to furnace
        const furnaceTravel = await travelTo(VARROCK_FURNACE);
        if (!furnaceTravel.success) return furnaceTravel;

        // Smelt each pair
        for (let i = 0; i < TOTAL_BRONZE_BARS; i++) {
          const copperOre = findInventoryItem(/^Copper ore$/i);
          if (!copperOre) {
            return { success: false, message: 'Missing copper ore for smelting', data: { reason: 'smelting_failed' } };
          }
          console.log(`[Bronze] Smelting bar ${i + 1}/${TOTAL_BRONZE_BARS}...`);
          const useResult = await bot.useItemOnLoc?.(copperOre, VARROCK_FURNACE, { timeout: 8000 });
          if (!useResult?.success) {
            return { success: false, message: `Could not use copper on furnace: ${useResult?.message}`, data: { reason: 'smelting_failed' } };
          }
          await sdk.waitForTicks?.(2);
          const clicked = await sdk.clickDialogByText?.(/bronze bar/i) ?? false;
          if (!clicked) {
            return { success: false, message: 'Could not find Bronze Bar option in smelting interface', data: { reason: 'smelting_failed' } };
          }
          // Wait for bar to appear
          let waitTicks = 0;
          while (countInventoryItems(/^Bronze bar$/i) < i + 1 && waitTicks < 20) {
            await sdk.waitForTicks?.(2);
            waitTicks++;
          }
          if (countInventoryItems(/^Bronze bar$/i) < i + 1) {
            return { success: false, message: 'Bronze bar not created', data: { reason: 'smelting_failed' } };
          }
        }

        console.log(`[Bronze] Smelted ${TOTAL_BRONZE_BARS} bronze bars.`);
        return { success: true, message: 'Smelting complete' };
      };

      // -------------------------------------------------------------
      // Smithing items
      // -------------------------------------------------------------
      const smithItems = async (): Promise<ScriptResult> => {
        console.log('[Bronze] Smithing bronze items...');

        // Ensure hammer is in inventory
        const hammer = findInventoryItem(/hammer/i);
        if (!hammer) {
          // Need to withdraw from bank
          const bankTravel = await travelTo(VARROCK_WEST_BANK);
          if (!bankTravel.success) return bankTravel;
          const bankOpen = await adapter.openBank();
          if (!bankOpen.success) return bankOpen;
          const hammerBank = (adapter.getBankItems?.() ?? []).find((item: any) => /hammer/i.test(item.name ?? ''));
          if (hammerBank) {
            await adapter.withdrawItem(hammerBank.name, 1);
          } else {
            await adapter.closeBank();
            return { success: false, message: 'No hammer available for smithing', data: { reason: 'equipment_missing' } };
          }
          await adapter.closeBank();
        }

        // Travel to anvil
        const anvilTravel = await travelTo(VARROCK_ANVIL);
        if (!anvilTravel.success) return anvilTravel;

        // Loop through each required item
        for (const item of REQUIRED_ITEMS) {
          const currentBars = countInventoryItems(/^Bronze bar$/i);
          if (currentBars < item.bars) {
            return { success: false, message: `Not enough bronze bars for ${item.product}`, data: { reason: 'smithing_failed' } };
          }
          console.log(`[Bronze] Smithing ${item.product}...`);
          const smithResult = await bot.smithAtAnvil?.(item.product, { timeout: 10000 });
          if (!smithResult?.success) {
            return { success: false, message: `Smithing ${item.product} failed: ${smithResult?.message}`, data: { reason: 'smithing_failed' } };
          }
          // Equip the item
          const smithedItem = findInventoryItem(new RegExp(`^${escapeRegex(item.product)}$`, 'i'));
          if (smithedItem) {
            console.log(`[Bronze] Equipping ${item.product}.`);
            await bot.equipItem?.(smithedItem);
          }
          await sdk.waitForTicks?.(2);
        }
        return { success: true, message: 'Smithing complete' };
      };

      // -------------------------------------------------------------
      // Main execution
      // -------------------------------------------------------------

      // 1. Prepare bank and tools
      const prepResult = await prepareBank();
      if (!prepResult.success) return prepResult;

      // 2. Gather copper and tin until enough
      const copperGather = await gatherOreUntil('copper', REQUIRED_COPPER);
      if (!copperGather.success) return copperGather;
      const tinGather = await gatherOreUntil('tin', REQUIRED_TIN);
      if (!tinGather.success) return tinGather;

      // 3. Smelt bronze bars
      const smeltResult = await smeltBronzeBars();
      if (!smeltResult.success) return smeltResult;

      // 4. Smith and equip items
      const smithResult = await smithItems();
      if (!smithResult.success) return smithResult;

      // 5. Bank any leftover bars/ores
      const finalBankTravel = await travelTo(VARROCK_WEST_BANK);
      if (finalBankTravel.success) {
        const finalBank = await adapter.openBank();
        if (finalBank.success) {
          await adapter.bankAll();
          await adapter.closeBank();
        }
      }

      console.log('[Bronze] Full bronze set obtained and equipped!');
      return {
        success: true,
        message: 'Full bronze set obtained and equipped.',
        data: { items: REQUIRED_ITEMS.map(i => i.product) },
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
