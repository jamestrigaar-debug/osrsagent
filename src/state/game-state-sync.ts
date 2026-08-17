import { RsSdkAdapter } from '../adapters/rs-sdk.js';
import { updateGameState } from '../memory/store.js';
import { InventorySlot, EquipmentSlot, Skills, Location } from '../memory/types.js';
import { logger } from '../logger.js';

/**
 * Reads live state from the adapter and persists it to SQLite AccountMemory.
 *
 * Safe to call after every gather cycle — idempotent and non-blocking.
 * If any adapter value is null / empty the corresponding field is skipped.
 */
export async function updateAccountMemoryFromAdapter(
  adapter: RsSdkAdapter,
  accountId: string,
): Promise<void> {
  try {
    const rawState = adapter.getState() as Record<string, unknown> | null;
    const rawInventory = adapter.getInventory() as unknown[];
    const rawEquipment = adapter.getEquipment() as unknown[];

    const update: {
      skills?: Skills;
      inventory?: InventorySlot[];
      equipment?: EquipmentSlot[];
      location?: Location;
    } = {};

    // ---------- skills ----------
    const skillNames = [
      'attack', 'strength', 'defence', 'ranged', 'prayer', 'magic',
      'runecraft', 'hitpoints', 'crafting', 'mining', 'smithing',
      'fishing', 'cooking', 'firemaking', 'woodcutting', 'agility',
      'herblore', 'thieving', 'fletching', 'slayer', 'farming',
      'construction', 'hunter',
    ];

    const skills: Skills = {};
    let anySkill = false;
    for (const name of skillNames) {
      const raw = adapter.getSkill(name) as Record<string, unknown> | null;
      if (raw && typeof raw.level === 'number') {
        skills[name] = {
          level: raw.level as number,
          xp: typeof raw.xp === 'number' ? raw.xp as number : 0,
        };
        anySkill = true;
      }
    }
    if (anySkill) {
      update.skills = skills;
    }

    // ---------- inventory ----------
    if (rawInventory.length > 0) {
      update.inventory = rawInventory.map((slot, i) => {
        const s = slot as Record<string, unknown>;
        return {
          slot: typeof s.slot === 'number' ? s.slot as number : i,
          name: typeof s.name === 'string' ? s.name as string : String(s.id ?? ''),
          quantity: typeof s.quantity === 'number' ? s.quantity as number : 1,
        } satisfies InventorySlot;
      });
    }

    // ---------- equipment ----------
    if (rawEquipment.length > 0) {
      update.equipment = rawEquipment.map((slot) => {
        const s = slot as Record<string, unknown>;
        return {
          slot: typeof s.slot === 'string' ? s.slot as string : String(s.slot ?? ''),
          name: typeof s.name === 'string' ? s.name as string : String(s.id ?? ''),
        } satisfies EquipmentSlot;
      });
    }

    // ---------- location ----------
    if (rawState) {
      const x = rawState.worldX ?? rawState.x;
      const z = rawState.worldZ ?? rawState.z;
      if (typeof x === 'number' && typeof z === 'number') {
        update.location = {
          worldX: x,
          worldZ: z,
          ...(typeof rawState.plane === 'number' ? { plane: rawState.plane as number } : {}),
        } as Location;
      }
    }

    if (Object.keys(update).length === 0) {
      if (process.env.SYNC_STATE_DEBUG === 'true') {
        logger.debug({ accountId }, '[StateSync] No live state available; skipping sync');
      }
      return;
    }

    updateGameState(accountId, update);

    if (process.env.SYNC_STATE_DEBUG === 'true') {
      logger.debug(
        { accountId, fields: Object.keys(update) },
        '[StateSync] AccountMemory updated from adapter',
      );
    }
  } catch (err) {
    // State sync is best-effort — never block the gather loop
    logger.warn(
      { accountId, err },
      '[StateSync] Failed to update AccountMemory from adapter; continuing',
    );
  }
}
