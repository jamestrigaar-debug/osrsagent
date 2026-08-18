import { registerScript } from "../registry.js";

import type {
  ScriptContext,
  ScriptResult,
} from "../types.js";

import {
  createRsSdkAdapter,
} from "../../adapters/rs-sdk.js";

const DEFAULT_RAW_FOOD = "Raw shrimps";
const DEFAULT_COOKED_FOOD = "Shrimps";
const DEFAULT_LOGS = "Logs";
const DEFAULT_TINDERBOX = "Tinderbox";

const DEFAULT_BANK = {
  name: "Draynor Bank",
  x: 3093,
  z: 3244,
  tolerance: 5,
};

// FIX: Distinct cooking location away from the bank building, on open ground.
const DEFAULT_COOKING_LOCATION = {
  name: "Draynor Firemaking Area",
  x: 3093,
  z: 3252,
  tolerance: 2,
};

const DEFAULT_SHOP_LOCATION = {
  name: "Lumbridge General Store",
  x: 3212,
  z: 3247,
  tolerance: 6,
};

registerScript(
  {
    name: "cook_food",
    description:
      "Cook raw food safely. Returns to the bank, checks supplies, obtains a tinderbox/logs if necessary, closes the bank BEFORE firemaking, walks to the cooking area, lights a fire, cooks the food, then returns to the bank and deposits the cooked food.",
    params: {
      item: "string — raw food item",
      rawFood: "string — raw food item",
      cookedFood: "string — expected cooked food item",
      amount: "number — target amount to cook",
      location: "string — cooking location id",
    },
    preconditions: ["in_game", "at_bank_or_reachable"],
    postconditions: ["food_cooked", "cooked_food_banked"],
    failureModes: [
      "bank_unreachable",
      "bank_open_failed",
      "raw_food_missing",
      "tinderbox_missing",
      "logs_missing",
      "shopping_failed",
      "fire_failed",
      "cooking_failed",
      "inventory_full",
      "timeout",
      "cancelled",
    ],
    category: "recovery",
    verified: false,
    version: 4,
  },
  async (
    params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const adapter = createRsSdkAdapter(ctx);

    const rawFood = String(
      params.rawFood ?? params.item ?? DEFAULT_RAW_FOOD,
    ).trim();

    const cookedFood = String(
      params.cookedFood ?? DEFAULT_COOKED_FOOD,
    ).trim();

    const requestedAmount = Math.max(
      1,
      Number(params.amount ?? 1),
    );

    const cookingLocation = resolveCookingLocation(
      String(params.location ?? ""),
    );

    try {
      await adapter.connect();

      console.log("================================");
      console.log("[CookFood] COOKING CONTROLLER");
      console.log("================================");

      console.log(`[CookFood] Raw food: ${rawFood}`);
      console.log(`[CookFood] Cooked food: ${cookedFood}`);

      /*
       * ------------------------------------------------------------
       * GO TO BANK
       * ------------------------------------------------------------
       */

      const bankTravel = await travelTo(adapter, DEFAULT_BANK);
      if (!bankTravel.success) {
        return bankTravel;
      }

      /*
       * ------------------------------------------------------------
       * OPEN BANK
       * ------------------------------------------------------------
       */

      const bankOpen = await adapter.openBank();
      if (!bankOpen.success) {
        return {
          success: false,
          message: `Could not open bank: ${bankOpen.message}`,
          data: { reason: "bank_open_failed" },
        };
      }

      /*
       * ------------------------------------------------------------
       * DEPOSIT EVERYTHING CURRENTLY IN INVENTORY FIRST.
       * ------------------------------------------------------------
       */

      const startingInventory = adapter.getInventory();
      if (startingInventory.length > 0) {
        console.log(
          `[CookFood] Depositing existing inventory (${startingInventory.length} slot(s))...`,
        );

        const deposit = await adapter.bankAll();
        if (!deposit.success) {
          return {
            success: false,
            message: `Could not deposit existing inventory: ${deposit.message}`,
            data: { reason: "deposit_before_cooking_failed" },
          };
        }
      }

      /*
       * ------------------------------------------------------------
       * READ BANK
       * ------------------------------------------------------------
       */

      let bankItems = readBankItems(adapter);
      let bankRawFood = countNamedItems(bankItems, rawFood);
      let bankLogs = countNamedItems(bankItems, DEFAULT_LOGS);
      let bankTinderboxes = countNamedItems(bankItems, DEFAULT_TINDERBOX);

      console.log(
        `[CookFood] Bank supplies: raw=${bankRawFood}, logs=${bankLogs}, tinderboxes=${bankTinderboxes}`,
      );

      if (bankRawFood <= 0) {
        try {
          await adapter.closeBank();
        } catch {
          // Ignore cleanup.
        }

        return {
          success: false,
          message: `No ${rawFood} found in bank.`,
          data: { reason: "raw_food_missing", rawFood },
        };
      }

      const cookAmount = Math.min(requestedAmount, bankRawFood, 26);

      /*
       * ------------------------------------------------------------
       * TINDERBOX
       * ------------------------------------------------------------
       */

      if (bankTinderboxes <= 0) {
        console.log(
          "[CookFood] No tinderbox in bank. Closing bank and travelling to shop.",
        );

        try {
          await adapter.closeBank();
        } catch {
          // Ignore cleanup.
        }

        const shopTravel = await travelTo(adapter, DEFAULT_SHOP_LOCATION);
        if (!shopTravel.success) {
          return shopTravel;
        }

        const bought = await buyTinderbox(adapter);
        if (!bought.success) {
          return bought;
        }

        const returnBankTravel = await travelTo(adapter, DEFAULT_BANK);
        if (!returnBankTravel.success) {
          return returnBankTravel;
        }

        const reopen = await adapter.openBank();
        if (!reopen.success) {
          return {
            success: false,
            message: `Could not reopen bank after shopping: ${reopen.message}`,
            data: { reason: "bank_reopen_failed" },
          };
        }

        const shoppingInventory = adapter.getInventory();
        if (shoppingInventory.length > 0) {
          const deposit = await adapter.bankAll();
          if (!deposit.success) {
            return {
              success: false,
              message: `Could not deposit shopping inventory: ${deposit.message}`,
              data: { reason: "shopping_inventory_deposit_failed" },
            };
          }
        }

        bankItems = readBankItems(adapter);
        bankTinderboxes = countNamedItems(bankItems, DEFAULT_TINDERBOX);

        if (bankTinderboxes <= 0) {
          return {
            success: false,
            message:
              "Tinderbox purchase completed but no Tinderbox is visible in bank.",
            data: { reason: "tinderbox_not_found_after_purchase" },
          };
        }
      }

      /*
       * ------------------------------------------------------------
       * LOGS
       * ------------------------------------------------------------
       */

      bankItems = readBankItems(adapter);
      bankLogs = countNamedItems(bankItems, DEFAULT_LOGS);

      if (bankLogs <= 0) {
        console.log(
          "[CookFood] No logs in bank. Closing bank and gathering emergency wood.",
        );

        try {
          await adapter.closeBank();
        } catch {
          // Ignore cleanup.
        }

        const woodResult = await gatherEmergencyLogs(adapter, ctx);
        if (!woodResult.success) {
          return woodResult;
        }

        const woodBankTravel = await travelTo(adapter, DEFAULT_BANK);
        if (!woodBankTravel.success) {
          return woodBankTravel;
        }

        const woodBankOpen = await adapter.openBank();
        if (!woodBankOpen.success) {
          return {
            success: false,
            message: `Could not reopen bank after emergency wood gathering: ${woodBankOpen.message}`,
            data: { reason: "bank_reopen_after_wood_failed" },
          };
        }

        const woodInventory = adapter.getInventory();
        if (woodInventory.length > 0) {
          const depositWood = await adapter.bankAll();
          if (!depositWood.success) {
            return {
              success: false,
              message: `Could not deposit emergency logs: ${depositWood.message}`,
              data: { reason: "deposit_emergency_logs_failed" },
            };
          }
        }

        bankItems = readBankItems(adapter);
        bankLogs = countNamedItems(bankItems, DEFAULT_LOGS);

        if (bankLogs <= 0) {
          return {
            success: false,
            message:
              "Emergency wood gathering completed but no Logs were found in bank.",
            data: { reason: "logs_missing" },
          };
        }
      }

      /*
       * ------------------------------------------------------------
       * FINAL RESOURCE WITHDRAWAL
       * ------------------------------------------------------------
       */

      const beforeWithdraw = adapter.getInventory();
      if (beforeWithdraw.length > 0) {
        const deposit = await adapter.bankAll();
        if (!deposit.success) {
          return {
            success: false,
            message: `Could not clear inventory before final withdrawal: ${deposit.message}`,
            data: { reason: "final_deposit_failed" },
          };
        }
      }

      console.log(`[CookFood] Withdrawing Tinderbox...`);

      const tinderWithdraw = await adapter.withdrawItem(DEFAULT_TINDERBOX, 1);
      if (!tinderWithdraw.success) {
        return {
          success: false,
          message: `Could not withdraw Tinderbox: ${tinderWithdraw.message}`,
          data: { reason: "tinderbox_withdraw_failed" },
        };
      }

      console.log(`[CookFood] Withdrawing one Log...`);

      const logWithdraw = await adapter.withdrawItem(DEFAULT_LOGS, 1);
      if (!logWithdraw.success) {
        return {
          success: false,
          message: `Could not withdraw Logs: ${logWithdraw.message}`,
          data: { reason: "logs_withdraw_failed" },
        };
      }

      console.log(`[CookFood] Withdrawing ${cookAmount}x ${rawFood}...`);

      const foodWithdraw = await adapter.withdrawItem(rawFood, cookAmount);
      if (!foodWithdraw.success) {
        return {
          success: false,
          message: `Could not withdraw ${cookAmount}x ${rawFood}: ${foodWithdraw.message}`,
          data: { reason: "raw_food_withdraw_failed" },
        };
      }

      /*
       * ------------------------------------------------------------
       * CLOSE BANK BEFORE FIREMAKING
       * ------------------------------------------------------------
       */

      console.log("[CookFood] Closing bank before leaving for firemaking.");

      try {
        await adapter.closeBank();
      } catch {
        // Ignore cleanup.
      }

      // Verify bank is actually closed where the SDK exposes state.
      const bankState = (adapter as any).getState?.();
      const bankStillOpen = Boolean(
        bankState?.bank?.isOpen ?? bankState?.bankOpen ?? false,
      );

      if (bankStillOpen) {
        await waitForTicksSafe(adapter, 1);
        try {
          await adapter.closeBank();
        } catch {
          // Ignore retry cleanup.
        }
      }

      /*
       * ------------------------------------------------------------
       * LEAVE BANK / GO TO COOKING AREA
       * ------------------------------------------------------------
       */

      console.log(
        `[CookFood] Leaving bank and travelling to ${cookingLocation.name}.`,
      );

      const cookingTravel = await travelTo(adapter, cookingLocation);
      if (!cookingTravel.success) {
        return cookingTravel;
      }

      await waitForTicksSafe(adapter, 1);

      /*
       * ------------------------------------------------------------
       * FIREMAKING
       * ------------------------------------------------------------
       */

      console.log("[CookFood] Bank is closed. Lighting cooking fire now.");

      const fire = await makeFire(adapter);
      if (!fire.success) {
        return fire;
      }

      await waitForTicksSafe(adapter, 2);

      /*
       * ------------------------------------------------------------
       * COOK FOOD
       * ------------------------------------------------------------
       */

      console.log(`[CookFood] Cooking ${cookAmount}x ${rawFood}...`);

      const cooked = await cookOnFire(adapter, rawFood, cookedFood, cookAmount);
      if (!cooked.success) {
        return cooked;
      }

      /*
       * ------------------------------------------------------------
       * RETURN TO BANK
       * ------------------------------------------------------------
       */

      console.log("[CookFood] Cooking completed. Returning to bank.");

      const finishedBankTravel = await travelTo(adapter, DEFAULT_BANK);
      if (!finishedBankTravel.success) {
        return finishedBankTravel;
      }

      const finishedBankOpen = await adapter.openBank();
      if (!finishedBankOpen.success) {
        return {
          success: false,
          message: `Could not open bank after cooking: ${finishedBankOpen.message}`,
          data: { reason: "bank_open_after_cooking_failed" },
        };
      }

      const finishedInventory = adapter.getInventory();
      if (finishedInventory.length > 0) {
        console.log(
          `[CookFood] Depositing completed cooking inventory (${finishedInventory.length} slot(s)).`,
        );

        const finalDeposit = await adapter.bankAll();
        if (!finalDeposit.success) {
          return {
            success: false,
            message: `Could not deposit cooked food: ${finalDeposit.message}`,
            data: { reason: "cooked_food_deposit_failed" },
          };
        }
      }

      try {
        await adapter.closeBank();
      } catch {
        // Ignore cleanup.
      }

      console.log(
        `[CookFood] SUCCESS: ${cookAmount} ${cookedFood} cooked and banked.`,
      );

      return {
        success: true,
        message: `Cooked ${cookAmount} ${cookedFood} and returned to bank.`,
        data: {
          rawFood,
          cookedFood,
          amount: cookAmount,
          phase: "complete",
          fireMade: true,
          returnedToBank: true,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
        data: { reason: "exception" },
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
 * EMERGENCY WOOD
 * ================================================================ */

async function gatherEmergencyLogs(
  adapter: any,
  ctx: ScriptContext,
): Promise<ScriptResult> {
  try {
    const result = await executeScript(
      "gather",
      {
        profession: "woodcutting",
        location: "draynor-oaks",
        resource: "oak",
        maxCycles: 5,
      },
      { ...ctx, adapter },
    );
    return result;
  } catch (error) {
    return {
      success: false,
      message: `Emergency wood gathering failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      data: { reason: "logs_missing" },
    };
  }
}

/* ================================================================
 * TRAVEL
 * ================================================================ */

async function travelTo(
  adapter: any,
  location: { name: string; x: number; z: number; tolerance: number },
): Promise<ScriptResult> {
  const player = adapter.getState()?.player as any;

  if (!player) {
    return {
      success: false,
      message: "Player state unavailable before travel",
      data: { reason: "state_unavailable" },
    };
  }

  const currentX = Number(player.worldX ?? player.x ?? 0);
  const currentZ = Number(player.worldZ ?? player.z ?? 0);

  const distance = Math.hypot(currentX - location.x, currentZ - location.z);

  if (distance <= location.tolerance) {
    console.log(`[CookFood] Already at ${location.name}.`);
    return { success: true, message: `Already at ${location.name}` };
  }

  console.log(
    `[CookFood] Travelling to ${location.name} (${location.x}, ${location.z})...`,
  );

  const result = await adapter.walkTo(location.x, location.z, location.tolerance);

  if (!result.success) {
    return { success: false, message: result.message, data: result.data };
  }

  console.log(`[CookFood] Reached ${location.name}.`);
  return { success: true, message: `Reached ${location.name}` };
}

/* ================================================================
 * SHOPPING
 * ================================================================ */

async function buyTinderbox(adapter: any): Promise<ScriptResult> {
  if (typeof adapter.buyFromShop !== "function") {
    return {
      success: false,
      message: "SDK does not expose buyFromShop().",
      data: { reason: "shopping_capability_missing" },
    };
  }

  console.log("[CookFood] Buying Tinderbox from general store.");
  try {
    const result = await adapter.buyFromShop("Tinderbox", 1);
    if (result && result.success === false) {
      return {
        success: false,
        message: `Could not buy Tinderbox: ${result.message}`,
        data: { reason: "shopping_failed" },
      };
    }

    console.log("[CookFood] Tinderbox purchased.");
    return { success: true, message: "Purchased Tinderbox." };
  } catch (error) {
    return {
      success: false,
      message: `Tinderbox purchase failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      data: { reason: "shopping_failed" },
    };
  }
}

/* ================================================================
 * FIREMAKING
 * ================================================================ */

async function makeFire(adapter: any): Promise<ScriptResult> {
  const bot = (adapter as any).bot;
  if (!bot || typeof bot.burnLogs !== "function") {
    return {
      success: false,
      message: "No firemaking capability (bot.burnLogs) available.",
      data: { reason: "firemaking_capability_missing" },
    };
  }

  try {
    console.log("[CookFood] Burning logs with tinderbox...");
    const result = await bot.burnLogs(DEFAULT_LOGS);

    if (!result?.success) {
      // Retry with a small step forward if we got a "bad location" error.
      if (result.message?.toLowerCase().includes("bad location")) {
        console.log("[CookFood] Bad location, stepping north and retrying once.");
        const player = (adapter as any).getState?.()?.player;
        if (player) {
          const newX = Number(player.worldX ?? player.x ?? 0);
          const newZ = Number(player.worldZ ?? player.z ?? 0) + 1; // step north
          await adapter.walkTo(newX, newZ, 1);
          await waitForTicksSafe(adapter, 2);
          const retry = await bot.burnLogs(DEFAULT_LOGS);
          if (retry?.success) {
            console.log("[CookFood] Fire created after retry.");
            return { success: true, message: "Fire created." };
          }
          return {
            success: false,
            message: `Could not make fire: ${retry.message}`,
            data: { reason: "fire_failed" },
          };
        }
      }

      return {
        success: false,
        message: `Could not make fire: ${result.message}`,
        data: { reason: "fire_failed" },
      };
    }

    console.log("[CookFood] Fire created.");
    return { success: true, message: "Fire created." };
  } catch (error) {
    return {
      success: false,
      message: `Firemaking failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      data: { reason: "fire_failed" },
    };
  }
}

/* ================================================================
 * COOKING
 * ================================================================ */

async function cookOnFire(
  adapter: any,
  rawFood: string,
  cookedFood: string,
  amount: number,
): Promise<ScriptResult> {
  const bot = (adapter as any).bot;
  const sdk = (adapter as any).sdk;

  if (!bot || typeof bot.useItemOnLoc !== "function") {
    return {
      success: false,
      message: "No cooking capability (bot.useItemOnLoc) available.",
      data: { reason: "cooking_capability_missing" },
    };
  }

  try {
    let fire = sdk?.findNearbyLoc?.(/fire/i) ?? null;
    if (!fire && typeof sdk?.scanFindNearbyLoc === "function") {
      fire = await sdk.scanFindNearbyLoc(/fire/i, 12);
    }

    if (!fire) {
      return {
        success: false,
        message: "No fire object found nearby.",
        data: { reason: "fire_not_found" },
      };
    }

    console.log(
      `[CookFood] Cooking ${amount}x ${rawFood} on fire...`,
    );

    let cookedCount = 0;
    const maxAttempts = Math.min(amount, 30);

    for (let i = 0; i < maxAttempts; i++) {
      const rawItem = sdk?.findInventoryItem?.(new RegExp(`^${escapeRegex(rawFood)}$`, "i"));
      if (!rawItem) {
        console.log("[CookFood] No more raw food in inventory.");
        break;
      }

      const result = await bot.useItemOnLoc(rawItem, fire, { timeout: 8000 });

      if (!result?.success) {
        const remainingRaw = sdk?.countInventoryItems?.(new RegExp(`^${escapeRegex(rawFood)}$`, "i")) ??
          countNamedItems(adapter.getInventory(), rawFood);
        if (remainingRaw <= 0) {
          cookedCount = amount;
          break;
        }
        return {
          success: false,
          message: `Cooking failed on attempt ${i + 1}: ${result.message}`,
          data: { reason: "cooking_failed" },
        };
      }

      await waitForTicksSafe(adapter, 2);

      const currentCooked = sdk?.countInventoryItems?.(new RegExp(`^${escapeRegex(cookedFood)}$`, "i")) ??
        countNamedItems(adapter.getInventory(), cookedFood);

      if (currentCooked > cookedCount) {
        cookedCount = currentCooked;
        if (cookedCount >= amount) {
          break;
        }
      }
    }

    if (cookedCount <= 0) {
      return {
        success: false,
        message: "No cooked food detected after cooking attempts.",
        data: { reason: "cooking_failed" },
      };
    }

    console.log(`[CookFood] Successfully cooked ${cookedCount}x ${cookedFood}.`);
    return {
      success: true,
      message: `Cooked ${cookedCount} ${cookedFood}.`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Cooking failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      data: { reason: "cooking_failed" },
    };
  }
}

/* ================================================================
 * BANK STATE
 * ================================================================ */

function readBankItems(adapter: any): any[] {
  try {
    if (typeof adapter.getBankInventory === "function") {
      const items = adapter.getBankInventory();
      return Array.isArray(items) ? items : [];
    }

    if (typeof adapter.getBankItems === "function") {
      const items = adapter.getBankItems();
      return Array.isArray(items) ? items : [];
    }
  } catch {
    // Ignore unavailable bank state.
  }

  return [];
}

function countNamedItems(items: any[], name: string): number {
  let total = 0;
  const wanted = name.trim().toLowerCase();

  for (const item of items) {
    const itemName = String(item?.name ?? "").trim().toLowerCase();
    if (itemName !== wanted) continue;

    const quantity = Number(item?.quantity ?? item?.count ?? 1);
    if (Number.isFinite(quantity)) {
      total += quantity;
    }
  }

  return total;
}

/* ================================================================
 * WAIT
 * ================================================================ */

async function waitForTicksSafe(adapter: any, ticks: number): Promise<void> {
  const sdk = adapter?.sdk;
  if (sdk && typeof sdk.waitForTicks === "function") {
    await sdk.waitForTicks(ticks);
  }
}

/* ================================================================
 * LOCATION
 * ================================================================ */

function resolveCookingLocation(value: string): {
  name: string;
  x: number;
  z: number;
  tolerance: number;
} {
  if (value.trim().toLowerCase() === "draynor-cooking") {
    return { ...DEFAULT_COOKING_LOCATION };
  }

  return { ...DEFAULT_COOKING_LOCATION };
}

/* ================================================================
 * COOKING SCRIPT COMPATIBILITY
 * ================================================================ */

function normalizeCookingScript(value: string | undefined): string {
  const requested = String(value ?? "cook_food").trim();

  if (!requested || requested === "cook") {
    return "cook_food";
  }

  return requested;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
