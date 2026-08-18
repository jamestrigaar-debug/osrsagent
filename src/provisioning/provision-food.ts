import "../scripts/index.js";

import {
  RsSdkAdapter,
  RsSdkAdapterOptions,
} from "../adapters/rs-sdk.js";

import {
  executeScript,
} from "../scripts/executor.js";

import type {
  ScriptContext,
  ScriptResult,
} from "../scripts/types.js";

export interface ProvisionFoodLocation {
  id: string;
  name: string;
  x: number;
  z: number;
  tolerance?: number;
}

export interface ProvisionFoodConfig {
  foodName: string;
  rawFoodName: string;
  targetBankedFood: number;
  fishingLocation: ProvisionFoodLocation;
  bank: ProvisionFoodLocation;
  cookingLocation: ProvisionFoodLocation;
  maxFishingRuns?: number;
  fishPerRun?: number;
  fishingMethod?: string;
  cookingScript?: string;
  fishingScript?: string;
  cancelSignal?: AbortSignal;
}

export interface ProvisionFoodResult
  extends ScriptResult {
  data?: Record<string, unknown>;
}

/* ================================================================
 * LOCATIONS
 * ================================================================ */

export const PROVISION_FOOD_LOCATIONS = {
  draynorFishing: {
    id: "draynor-fishing",
    name: "Draynor Fishing",
    x: 3087,
    z: 3227,
    tolerance: 5,
  },

  draynorBank: {
    id: "draynor-bank",
    name: "Draynor Bank",
    x: 3093,
    z: 3244,
    tolerance: 5,
  },

  draynorCooking: {
    id: "draynor-cooking",
    name: "Draynor Cooking",
    x: 3093,
    z: 3244,
    tolerance: 8,
  },
} as const;

/* ================================================================
 * DEFAULTS
 * ================================================================ */

const DEFAULT_COOKING_SCRIPT =
  "cook_food";

const DEFAULT_FISHING_SCRIPT =
  "use_fishing_script";

/* ================================================================
 * MAIN
 * ================================================================ */

export async function runProvisionFood(
  config: ProvisionFoodConfig,
  ctx: ScriptContext,
): Promise<ProvisionFoodResult> {
  const suppliedAdapter =
    ctx.adapter as any;

  const isValidAdapter =
    (obj: unknown): obj is RsSdkAdapter =>
      Boolean(
        obj &&
        typeof (obj as any).connect === "function" &&
        typeof (obj as any).disconnect === "function" &&
        typeof (obj as any).getState === "function",
      );

  let adapter: RsSdkAdapter;
  let usedPool = false;

  const adapterOptions: RsSdkAdapterOptions = {
    server: ctx.sdkBaseUrl,
    botName: ctx.sdkBotName,
    password: ctx.sdkBotPassword,
  };

  if (
    isValidAdapter(
      suppliedAdapter,
    )
  ) {
    adapter = suppliedAdapter;
  } else if (
    ctx.adapterPool
  ) {
    adapter =
      await ctx.adapterPool.getAdapter(
        ctx.accountId,
        adapterOptions,
      );

    usedPool = true;
  } else {
    adapter =
      new RsSdkAdapter(
        adapterOptions,
      );
  }

  const sharedContext: ScriptContext = {
    ...ctx,
    adapter,
  };

  const cookingScript =
    normalizeCookingScript(
      config.cookingScript,
    );

  const fishingScript =
    normalizeFishingScript(
      config.fishingScript,
    );

  try {
    await adapter.connect();

    console.log("");
    console.log(
      "================================",
    );
    console.log(
      "PHASE 2 FOOD PROVISIONING",
    );
    console.log(
      "================================",
    );

    console.log(
      `[ProvisionFood] Target food: ${config.foodName}`,
    );

    console.log(
      `[ProvisionFood] Target banked amount: ${config.targetBankedFood}`,
    );

    /*
     * ------------------------------------------------------------
     * START AT BANK
     * ------------------------------------------------------------
     */

    const initialBankTravel =
      await travelToLocation(
        adapter,
        config.bank,
      );

    if (
      !initialBankTravel.success
    ) {
      return initialBankTravel;
    }

    /*
     * ------------------------------------------------------------
     * BANK INSPECTION
     * ------------------------------------------------------------
     */

    const initialBank =
      await inspectBank(
        adapter,
        config.bank,
        config.foodName,
        config.rawFoodName,
      );

    if (
      !initialBank.success
    ) {
      return initialBank;
    }

    let bankedCooked =
      Number(
        initialBank.data?.cookedCount ??
          0,
      );

    let bankedRaw =
      Number(
        initialBank.data?.rawCount ??
          0,
      );

    console.log(
      `[ProvisionFood] Banked ${config.foodName}: ${bankedCooked}`,
    );

    console.log(
      `[ProvisionFood] Banked ${config.rawFoodName}: ${bankedRaw}`,
    );

    /*
     * ------------------------------------------------------------
     * ALREADY DONE
     * ------------------------------------------------------------
     */

    if (
      bankedCooked >=
      config.targetBankedFood
    ) {
      return {
        success: true,

        message:
          `Food already provisioned: ${bankedCooked} ${config.foodName} in bank.`,

        data: {
          phase: "complete",
          food: config.foodName,
          bankedFood: bankedCooked,
          target: config.targetBankedFood,
        },
      };
    }

    /*
     * ------------------------------------------------------------
     * COOK EXISTING RAW FOOD FIRST
     * ------------------------------------------------------------
     */

    if (
      bankedRaw > 0 &&
      !config.cancelSignal?.aborted
    ) {
      console.log(
        `[ProvisionFood] Found ${bankedRaw} raw food already banked. Cooking it first.`,
      );

      const cookedExisting =
        await cookBankedFood(
          adapter,
          sharedContext,
          config,
          bankedRaw,
          cookingScript,
        );

      if (
        !cookedExisting.success
      ) {
        return cookedExisting;
      }

      const afterExistingCook =
        await inspectBank(
          adapter,
          config.bank,
          config.foodName,
          config.rawFoodName,
        );

      if (
        !afterExistingCook.success
      ) {
        return afterExistingCook;
      }

      bankedCooked =
        Number(
          afterExistingCook.data?.cookedCount ??
            0,
        );

      bankedRaw =
        Number(
          afterExistingCook.data?.rawCount ??
            0,
        );

      console.log(
        `[ProvisionFood] After cooking existing raw stock: cooked=${bankedCooked}, raw=${bankedRaw}`,
      );

      if (
        bankedCooked >=
        config.targetBankedFood
      ) {
        return {
          success: true,

          message:
            `Food provisioned from existing raw stock: ${bankedCooked} ${config.foodName}.`,

          data: {
            phase: "complete",
            food: config.foodName,
            bankedFood: bankedCooked,
            target: config.targetBankedFood,
          },
        };
      }
    }

    /*
     * ------------------------------------------------------------
     * FISHING RUNS
     * ------------------------------------------------------------
     */

    const maxRuns =
      Math.max(
        1,
        config.maxFishingRuns ??
          3,
      );

    const fishPerRun =
      Math.max(
        1,
        config.fishPerRun ??
          26,
      );

    let fishingRun = 0;

    while (
      !config.cancelSignal?.aborted &&
      bankedCooked <
        config.targetBankedFood &&
      fishingRun <
        maxRuns
    ) {
      fishingRun++;

      console.log("");
      console.log(
        "--------------------------------",
      );
      console.log(
        `[ProvisionFood] FISHING RUN ${fishingRun}/${maxRuns}`,
      );
      console.log(
        "--------------------------------",
      );

      /*
       * GO TO FISHING
       */

      const travelToFish =
        await travelToLocation(
          adapter,
          config.fishingLocation,
        );

      if (
        !travelToFish.success
      ) {
        return {
          success: false,

          message:
            `Could not reach fishing location: ${travelToFish.message}`,

          data: {
            phase: "travel_to_fishing",
            run: fishingRun,
          },
        };
      }

      /*
       * RUN EXISTING FISHING SCRIPT
       *
       * IMPORTANT:
       * We use the project's existing fishing implementation rather
       * than inventing a new fishing mechanism.
       */

      console.log(
        `[ProvisionFood] Executing ${fishingScript}...`,
      );

      const fishResult =
        await executeScript(
          fishingScript,
          {
            location:
              config.fishingLocation.id,

            method:
              config.fishingMethod ??
              "net",

            target:
              "shrimp",

            amount:
              fishPerRun,

            targetAmount:
              fishPerRun,

            maxCycles:
              fishPerRun,
          },
          sharedContext,
        );

      if (
        !fishResult.success
      ) {
        return {
          success: false,

          message:
            `Fishing failed: ${fishResult.message}`,

          data: {
            phase: "fishing",
            run: fishingRun,

            fishingScript,

            ...(fishResult.data ??
              {}),
          },
        };
      }

      /*
       * RETURN TO BANK
       */

      console.log(
        `[ProvisionFood] Fishing run ${fishingRun} complete. Returning to bank.`,
      );

      const bankTravel =
        await travelToLocation(
          adapter,
          config.bank,
        );

      if (
        !bankTravel.success
      ) {
        return {
          success: false,

          message:
            `Could not return to bank: ${bankTravel.message}`,

          data: {
            phase: "return_to_bank",
            run: fishingRun,
          },
        };
      }

      /*
       * OPEN BANK
       */

      const openBank =
        await adapter.openBank();

      if (
        !openBank.success
      ) {
        return {
          success: false,

          message:
            `Could not open bank: ${openBank.message}`,

          data: {
            phase: "open_bank",
            run: fishingRun,
          },
        };
      }

      /*
       * ALWAYS DEPOSIT CURRENT INVENTORY FIRST.
       */

      const fishingInventory =
        adapter.getInventory();

      if (
        fishingInventory.length > 0
      ) {
        console.log(
          `[ProvisionFood] Depositing fishing inventory (${fishingInventory.length} slot(s))...`,
        );

        const deposit =
          await adapter.bankAll();

        if (
          !deposit.success
        ) {
          return {
            success: false,

            message:
              `Failed depositing fishing inventory: ${deposit.message}`,

            data: {
              phase:
                "deposit_fishing_inventory",

              run:
                fishingRun,
            },
          };
        }
      }

      try {
        await adapter.closeBank();
      } catch {
        // Optional cleanup.
      }

      /*
       * REFRESH BANK
       */

      const afterFishing =
        await inspectBank(
          adapter,
          config.bank,
          config.foodName,
          config.rawFoodName,
        );

      if (
        !afterFishing.success
      ) {
        return afterFishing;
      }

      bankedCooked =
        Number(
          afterFishing.data?.cookedCount ??
            bankedCooked,
        );

      bankedRaw =
        Number(
          afterFishing.data?.rawCount ??
            bankedRaw,
        );

      console.log(
        `[ProvisionFood] Bank now contains cooked=${bankedCooked}, raw=${bankedRaw}.`,
      );

      /*
       * COOK RAW AFTER EACH BANKING RUN WHEN PRACTICAL.
       *
       * This keeps the bank state clean and means we don't wait
       * until all fishing runs are finished before processing food.
       */

      if (
        bankedRaw > 0 &&
        bankedCooked <
          config.targetBankedFood &&
        !config.cancelSignal?.aborted
      ) {
        console.log(
          `[ProvisionFood] Cooking ${bankedRaw} raw food after fishing run ${fishingRun}.`,
        );

        const cookResult =
          await cookBankedFood(
            adapter,
            sharedContext,
            config,
            bankedRaw,
            cookingScript,
          );

        if (
          !cookResult.success
        ) {
          return cookResult;
        }

        const afterCook =
          await inspectBank(
            adapter,
            config.bank,
            config.foodName,
            config.rawFoodName,
          );

        if (
          !afterCook.success
        ) {
          return afterCook;
        }

        bankedCooked =
          Number(
            afterCook.data?.cookedCount ??
              bankedCooked,
          );

        bankedRaw =
          Number(
            afterCook.data?.rawCount ??
              0,
          );

        console.log(
          `[ProvisionFood] After cooking run ${fishingRun}: cooked=${bankedCooked}, raw=${bankedRaw}.`,
        );
      }

      if (
        bankedCooked >=
        config.targetBankedFood
      ) {
        break;
      }
    }

    /*
     * ------------------------------------------------------------
     * FINAL COOKING PASS
     * ------------------------------------------------------------
     */

    if (
      !config.cancelSignal?.aborted &&
      bankedCooked <
        config.targetBankedFood &&
      bankedRaw > 0
    ) {
      console.log(
        `[ProvisionFood] Final cooking pass for ${bankedRaw} raw food.`,
      );

      const finalCook =
        await cookBankedFood(
          adapter,
          sharedContext,
          config,
          bankedRaw,
          cookingScript,
        );

      if (
        !finalCook.success
      ) {
        return finalCook;
      }

      const finalBank =
        await inspectBank(
          adapter,
          config.bank,
          config.foodName,
          config.rawFoodName,
        );

      if (
        !finalBank.success
      ) {
        return finalBank;
      }

      bankedCooked =
        Number(
          finalBank.data?.cookedCount ??
            bankedCooked,
        );

      bankedRaw =
        Number(
          finalBank.data?.rawCount ??
            0,
        );
    }

    /*
     * ------------------------------------------------------------
     * RESULT
     * ------------------------------------------------------------
     */

    if (
      bankedCooked >=
      config.targetBankedFood
    ) {
      console.log(
        `[ProvisionFood] SUCCESS: ${bankedCooked} ${config.foodName} stored.`,
      );

      return {
        success: true,

        message:
          `Food provisioned successfully: ${bankedCooked} ${config.foodName} in bank.`,

        data: {
          phase: "complete",

          food:
            config.foodName,

          rawFood:
            config.rawFoodName,

          bankedFood:
            bankedCooked,

          remainingRaw:
            bankedRaw,

          fishingRuns:
            fishingRun,

          target:
            config.targetBankedFood,
        },
      };
    }

    if (
      config.cancelSignal?.aborted
    ) {
      return {
        success: false,

        message:
          "Food provisioning cancelled.",

        data: {
          phase: "cancelled",

          bankedFood:
            bankedCooked,

          remainingRaw:
            bankedRaw,

          fishingRuns:
            fishingRun,

          target:
            config.targetBankedFood,

          reason:
            "cancelled",
        },
      };
    }

    return {
      success: false,

      message:
        `Food provisioning incomplete: ${bankedCooked}/${config.targetBankedFood} cooked food available.`,

      data: {
        phase: "incomplete",

        bankedFood:
          bankedCooked,

        remainingRaw:
          bankedRaw,

        fishingRuns:
          fishingRun,

        target:
          config.targetBankedFood,

        reason:
          "target_not_reached",
      },
    };
  } catch (
    error
  ) {
    return {
      success: false,

      message:
        error instanceof Error
          ? error.message
          : String(error),

      data: {
        phase: "exception",
        reason: "exception",
      },
    };
  } finally {
    if (
      usedPool &&
      ctx.adapterPool
    ) {
      ctx.adapterPool.release(
        ctx.accountId,
      );
    } else if (
      !isValidAdapter(
        suppliedAdapter,
      ) &&
      !usedPool
    ) {
      try {
        await adapter.disconnect();
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}

/* ================================================================
 * TRAVEL
 * ================================================================ */

async function travelToLocation(
  adapter: RsSdkAdapter,
  location: ProvisionFoodLocation,
): Promise<ScriptResult> {
  const state =
    adapter.getState();

  const player =
    state?.player as any;

  if (
    !player
  ) {
    return {
      success: false,

      message:
        "Player state unavailable before travel",

      data: {
        reason:
          "state_unavailable",
      },
    };
  }

  const currentX =
    Number(
      player.worldX ??
        player.x ??
        0,
    );

  const currentZ =
    Number(
      player.worldZ ??
        player.z ??
        0,
    );

  const tolerance =
    location.tolerance ??
    5;

  const distance =
    Math.hypot(
      currentX -
        location.x,
      currentZ -
        location.z,
    );

  if (
    distance <=
    tolerance
  ) {
    console.log(
      `[ProvisionFood] Already at ${location.name}.`,
    );

    return {
      success: true,

      message:
        `Already at ${location.name}`,
    };
  }

  console.log(
    `[ProvisionFood] Travelling to ${location.name} (${location.x}, ${location.z})...`,
  );

  const result =
    await adapter.walkTo(
      location.x,
      location.z,
      tolerance,
    );

  if (
    !result.success
  ) {
    return {
      success: false,

      message:
        result.message,

      data:
        result.data,
    };
  }

  console.log(
    `[ProvisionFood] Reached ${location.name}.`,
  );

  return {
    success: true,

    message:
      `Reached ${location.name}`,
  };
}

/* ================================================================
 * BANK INSPECTION
 * ================================================================ */

async function inspectBank(
  adapter: RsSdkAdapter,
  bank: ProvisionFoodLocation,
  cookedFoodName: string,
  rawFoodName: string,
): Promise<ProvisionFoodResult> {
  const travel =
    await travelToLocation(
      adapter,
      bank,
    );

  if (
    !travel.success
  ) {
    return {
      success: false,

      message:
        travel.message,

      data: {
        phase:
          "bank_travel",
      },
    };
  }

  const open =
    await adapter.openBank();

  if (
    !open.success
  ) {
    return {
      success: false,

      message:
        `Could not open ${bank.name}: ${open.message}`,

      data: {
        phase:
          "bank_open",
      },
    };
  }

  /*
   * IMPORTANT:
   * Always deposit current inventory before examining/withdrawing
   * provisioning resources.
   */

  const inventory =
    adapter.getInventory();

  if (
    inventory.length > 0
  ) {
    console.log(
      `[ProvisionFood] Depositing current inventory before bank inspection (${inventory.length} slot(s))...`,
    );

    const deposit =
      await adapter.bankAll();

    if (
      !deposit.success
    ) {
      try {
        await adapter.closeBank();
      } catch {
        // Ignore cleanup.
      }

      return {
        success: false,

        message:
          `Could not deposit current inventory: ${deposit.message}`,

        data: {
          phase:
            "deposit_before_bank_inspection",
          reason:
            "deposit_failed",
        },
      };
    }

    console.log(
      `[ProvisionFood] Current inventory deposited.`,
    );
  } else {
    console.log(
      "[ProvisionFood] Inventory already empty before bank inspection.",
    );
  }

  let cookedCount = 0;
  let rawCount = 0;

  const bankItems =
    readBankItems(
      adapter,
    );

  if (
    bankItems.length > 0
  ) {
    cookedCount =
      countNamedItems(
        bankItems,
        cookedFoodName,
      );

    rawCount =
      countNamedItems(
        bankItems,
        rawFoodName,
      );
  }

  try {
    await adapter.closeBank();
  } catch {
    // Optional cleanup.
  }

  console.log(
    `[ProvisionFood] Bank inspection: cooked=${cookedCount}, raw=${rawCount}`,
  );

  return {
    success: true,

    message:
      `Inspected ${bank.name}`,

    data: {
      cookedCount,
      rawCount,
    },
  };
}

/* ================================================================
 * COOK BANKED FOOD
 * ================================================================ */

async function cookBankedFood(
  adapter: RsSdkAdapter,
  ctx: ScriptContext,
  config: ProvisionFoodConfig,
  rawCount: number,
  cookingScript: string,
): Promise<ProvisionFoodResult> {
  if (
    rawCount <= 0
  ) {
    return {
      success: true,

      message:
        "No raw food requires cooking.",

      data: {
        phase:
          "cooking",
        rawCount:
          0,
      },
    };
  }

  /*
   * ------------------------------------------------------------
   * RETURN TO BANK
   * ------------------------------------------------------------
   */

  const bankTravel =
    await travelToLocation(
      adapter,
      config.bank,
    );

  if (
    !bankTravel.success
  ) {
    return {
      success: false,

      message:
        `Could not reach bank before cooking: ${bankTravel.message}`,

      data: {
        phase:
          "cook_bank_travel",
      },
    };
  }

  const bankOpen =
    await adapter.openBank();

  if (
    !bankOpen.success
  ) {
    return {
      success: false,

      message:
        `Could not open bank before cooking: ${bankOpen.message}`,

      data: {
        phase:
          "cook_bank_open",
      },
    };
  }

  /*
   * ALWAYS deposit before withdrawing raw food.
   */

  const inventory =
    adapter.getInventory();

  if (
    inventory.length > 0
  ) {
    console.log(
      `[ProvisionFood] Depositing inventory before withdrawing ${config.rawFoodName}...`,
    );

    const deposit =
      await adapter.bankAll();

    if (
      !deposit.success
    ) {
      return {
        success: false,

        message:
          `Could not deposit inventory before cooking: ${deposit.message}`,

        data: {
          phase:
            "cook_deposit_before_withdraw",
        },
      };
    }
  }

  const amount =
    Math.min(
      Math.max(
        1,
        rawCount,
      ),
      27,
    );

  /*
   * Withdraw raw food.
   */

  console.log(
    `[ProvisionFood] Withdrawing ${amount}x ${config.rawFoodName} for cooking...`,
  );

  const withdraw =
    await adapter.withdrawItem(
      config.rawFoodName,
      amount,
    );

  if (
    !withdraw.success
  ) {
    return {
      success: false,

      message:
        `Could not withdraw ${config.rawFoodName}: ${withdraw.message}`,

      data: {
        phase:
          "cook_withdraw_raw",
      },
    };
  }

  console.log(
    `[ProvisionFood] ${amount}x ${config.rawFoodName} ready for cooking.`,
  );

  try {
    await adapter.closeBank();
  } catch {
    // Optional cleanup.
  }

  /*
   * ------------------------------------------------------------
   * COOK
   * ------------------------------------------------------------
   */

  const cookingTravel =
    await travelToLocation(
      adapter,
      config.cookingLocation,
    );

  if (
    !cookingTravel.success
  ) {
    return {
      success: false,

      message:
        `Could not reach cooking location: ${cookingTravel.message}`,

      data: {
        phase:
          "cook_travel",
      },
    };
  }

  console.log(
    `[ProvisionFood] Executing ${cookingScript}...`,
  );

  /*
   * This is the key fix:
   *
   * We NEVER execute "cook".
   *
   * The registered script is "cook_food".
   */

  const cookResult =
    await executeScript(
      cookingScript,
      {
        item:
          config.rawFoodName,

        rawFood:
          config.rawFoodName,

        cookedFood:
          config.foodName,

        amount,

        location:
          config.cookingLocation.id,
      },
      ctx,
    );

  if (
    !cookResult.success
  ) {
    return {
      success: false,

      message:
        `Cooking failed: ${cookResult.message}`,

      data: {
        phase:
          "cooking",

        cookingScript,

        ...(cookResult.data ??
          {}),
      },
    };
  }

  /*
   * ------------------------------------------------------------
   * RETURN TO BANK
   * ------------------------------------------------------------
   */

  const finishedBankTravel =
    await travelToLocation(
      adapter,
      config.bank,
    );

  if (
    !finishedBankTravel.success
  ) {
    return {
      success: false,

      message:
        `Could not return to bank after cooking: ${finishedBankTravel.message}`,

      data: {
        phase:
          "cook_return_to_bank",
      },
    };
  }

  const finishedBank =
    await adapter.openBank();

  if (
    !finishedBank.success
  ) {
    return {
      success: false,

      message:
        `Could not open bank after cooking: ${finishedBank.message}`,

      data: {
        phase:
          "cook_bank_open",
      },
    };
  }

  /*
   * IMPORTANT:
   * Deposit all cooked food/supplies before considering the cooking
   * run complete.
   */

  const cookedInventory =
    adapter.getInventory();

  if (
    cookedInventory.length > 0
  ) {
    const deposit =
      await adapter.bankAll();

    if (
      !deposit.success
    ) {
      return {
        success: false,

        message:
          `Could not bank cooked food: ${deposit.message}`,

        data: {
          phase:
            "cook_bank",
        },
      };
    }
  }

  try {
    await adapter.closeBank();
  } catch {
    // Optional cleanup.
  }

  console.log(
    `[ProvisionFood] Cooking and banking completed: ${amount} ${config.foodName}.`,
  );

  return {
    success: true,

    message:
      `Cooked and banked ${amount} ${config.foodName}`,

    data: {
      phase:
        "cooking_complete",

      food:
        config.foodName,

      cookedFromRaw:
        amount,

      cookingScript,
    },
  };
}

/* ================================================================
 * BANK STATE
 * ================================================================ */

function readBankItems(
  adapter: RsSdkAdapter,
): any[] {
  const rawAdapter =
    adapter as any;

  try {
    if (
      typeof rawAdapter.getBankInventory ===
      "function"
    ) {
      const items =
        rawAdapter.getBankInventory();

      return Array.isArray(
        items,
      )
        ? items
        : [];
    }

    if (
      typeof rawAdapter.getBankItems ===
      "function"
    ) {
      const items =
        rawAdapter.getBankItems();

      return Array.isArray(
        items,
      )
        ? items
        : [];
    }
  } catch {
    // Ignore unavailable bank state.
  }

  return [];
}

function countNamedItems(
  items: any[],
  name: string,
): number {
  let total = 0;

  const wanted =
    name
      .trim()
      .toLowerCase();

  for (
    const item of items
  ) {
    const itemName =
      String(
        item?.name ??
          "",
      )
        .trim()
        .toLowerCase();

    if (
      itemName !==
      wanted
    ) {
      continue;
    }

    const quantity =
      Number(
        item?.quantity ??
          item?.count ??
          1,
      );

    if (
      Number.isFinite(
        quantity,
      )
    ) {
      total +=
        quantity;
    }
  }

  return total;
}

/* ================================================================
 * SCRIPT NAME NORMALIZATION
 * ================================================================ */

function normalizeCookingScript(
  value:
    | string
    | undefined,
): string {
  const requested =
    String(
      value ??
        DEFAULT_COOKING_SCRIPT,
    )
      .trim();

  /*
   * "cook" was an old/nonexistent name.
   * Keep this compatibility guard so an old plan/config cannot
   * send the controller into the Unknown script: cook loop.
   */
  if (
    !requested ||
    requested ===
      "cook"
  ) {
    return DEFAULT_COOKING_SCRIPT;
  }

  return requested;
}

function normalizeFishingScript(
  value:
    | string
    | undefined,
): string {
  const requested =
    String(
      value ??
        DEFAULT_FISHING_SCRIPT,
    )
      .trim();

  if (
    !requested ||
    requested ===
      "gather"
  ) {
    return DEFAULT_FISHING_SCRIPT;
  }

  return requested;
}
