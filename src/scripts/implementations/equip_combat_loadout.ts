// ================================================================
// equip_combat_loadout.ts
// Place at: src/scripts/implementations/equip_combat_loadout.ts
// Replaces existing file.
// Description: Fixed to use only Draynor Bank.
// ================================================================

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

/* ================================================================
 * EQUIPMENT DETECTION PATTERNS
 * ================================================================ */

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
 * GEAR EQUIPPING SCRIPT
 * ================================================================ */

registerScript(
  {
    name: 'equip_combat_loadout',
    description:
      'Withdraws and equips the best available weapon and armor from Draynor Bank. If specific names are provided, uses those; otherwise auto-detects.',
    params: {
      weaponName: 'string — optional specific weapon name',
      armorNames: 'string[] — optional specific armor piece names',
    },
    preconditions: ['in_game'],
    postconditions: ['gear_equipped'],
    failureModes: ['bank_unreachable', 'no_gear_found', 'timeout', 'cancelled'],
    category: 'preparation',
    verified: false,
    version: 3,
  },
  async (
    params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const adapter = createRsSdkAdapter(ctx);

    const weaponName = String(params.weaponName ?? '').trim();
    const armorNames = Array.isArray(params.armorNames)
      ? (params.armorNames as string[]).map((s: string) => s.trim()).filter(Boolean)
      : [];

    try {
      await adapter.connect();

      const bot = (adapter as any).bot;
      const sdk = (adapter as any).sdk;

      if (!bot || !sdk) {
        return {
          success: false,
          message: 'Bot SDK not available on adapter.',
          data: { reason: 'sdk_missing' },
        };
      }

      // Travel to Draynor bank
      const travelResult = await executeScript('travel_to', {
        location: `${DRAYNOR_BANK.x},${DRAYNOR_BANK.z}`,
        tolerance: DRAYNOR_BANK.tolerance,
        announce: false,
      }, ctx);

      if (!travelResult.success) {
        return { success: false, message: `Could not reach bank: ${travelResult.message}`, data: { reason: 'bank_unreachable' } };
      }

      // Open bank
      const bankOpen = await adapter.openBank();
      if (!bankOpen.success) {
        return { success: false, message: `Could not open bank: ${bankOpen.message}`, data: { reason: 'bank_open_failed' } };
      }

      // Deposit current inventory to make room
      const inv = adapter.getInventory();
      if (inv.length > 0) {
        await adapter.bankAll();
      }

      const bankItems = adapter.getBankItems?.() ?? [];

      const findBankItem = (pattern: RegExp | string) => {
        return bankItems.find((item: any) => {
          const name = String(item?.name ?? '').toLowerCase();
          if (typeof pattern === 'string') {
            return name === pattern.toLowerCase();
          }
          return pattern.test(name);
        }) ?? null;
      };

      // =============== WEAPON ===============
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
        console.log(`[Loadout] Withdrawing weapon: ${weaponItem.name}`);
        const withdraw = await adapter.withdrawItem(weaponItem.name, 1);
        if (withdraw.success) {
          const invWeapon = sdk.findInventoryItem(new RegExp(`^${escapeRegex(weaponItem.name)}$`, 'i'));
          if (invWeapon) {
            console.log(`[Loadout] Equipping weapon: ${weaponItem.name}`);
            await bot.equipItem?.(invWeapon);
          }
        }
      } else {
        console.log('[Loadout] No weapon found in bank, continuing unarmed.');
      }

      // =============== ARMOR ===============
      const armorToEquip: string[] = [];
      if (armorNames.length > 0) {
        armorToEquip.push(...armorNames);
      } else {
        // Auto-detect one item per slot
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

      // Withdraw and equip each armor piece
      for (const pieceName of armorToEquip) {
        const bankItem = findBankItem(pieceName);
        if (!bankItem) continue;
        console.log(`[Loadout] Withdrawing armor: ${bankItem.name}`);
        const withdraw = await adapter.withdrawItem(bankItem.name, 1);
        if (withdraw.success) {
          const invPiece = sdk.findInventoryItem(new RegExp(`^${escapeRegex(bankItem.name)}$`, 'i'));
          if (invPiece) {
            console.log(`[Loadout] Equipping armor: ${bankItem.name}`);
            await bot.equipItem?.(invPiece);
          }
        }
      }

      // Close bank
      await adapter.closeBank();

      return {
        success: true,
        message: 'Combat loadout equipped.',
        data: { weapon: weaponItem?.name ?? null, armor: armorToEquip },
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
