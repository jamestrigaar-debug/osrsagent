import { registerScript } from '../registry.js';

import type {
  ScriptContext,
  ScriptResult,
} from '../types.js';

import {
  createRsSdkAdapter,
} from '../../adapters/rs-sdk.js';

const FISHING_ACTION_TIMEOUT_MS =
  30_000;

const CATCH_PROGRESS_TIMEOUT_MS =
  10_000;

registerScript(
  {
    name:
      'use_fishing_script',

    description:
      'Fish a selected persistent fishing-spot node using the appropriate fishing equipment. Remains at the spot while catches are being produced and only advances when the spot disappears, inventory fills, or a safety timeout occurs.',

    params: {
      location:
        'string — registered fishing location',

      method:
        'string — net | bait | fly | cage | harpoon',

      target:
        'string — optional target fish',

      targetX:
        'number — saved fishing spot world X coordinate',

      targetZ:
        'number — saved fishing spot world Z coordinate',
    },

    preconditions: [
      'in_game',
      'correct_fishing_equipment',
      'at_fishing_location',
    ],

    postconditions: [
      'fishing_action_attempted',
      'fish_gathered_or_spot_unavailable',
    ],

    failureModes: [
      'fishing_spot_not_found',
      'fishing_option_not_found',
      'equipment_missing',
      'inventory_full',
      'danger_detected',
      'interaction_failed',
      'timeout',
    ],

    category:
      'gathering',

    verified:
      false,

    version:
      2,
  },

  async (
    params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const location =
      String(
        params.location ?? '',
      ).trim();

    const method =
      String(
        params.method ?? 'net',
      )
        .trim()
        .toLowerCase();

    const target =
      String(
        params.target ?? '',
      ).trim();

    const targetX =
      Number(
        params.targetX,
      );

    const targetZ =
      Number(
        params.targetZ,
      );

    const adapter =
      createRsSdkAdapter(
        ctx,
      );

    try {
      await adapter.connect();

      /*
       * ------------------------------------------------------------
       * INVENTORY
       * ------------------------------------------------------------
       */
      const initialInventory =
        adapter.getInventory();

      if (
        initialInventory.length >= 28
      ) {
        return {
          success: false,

          message:
            'Inventory is full; banking is required',

          data: {
            reason:
              'inventory_full',

            inventorySlots:
              initialInventory.length,
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * EQUIPMENT
       * ------------------------------------------------------------
       */
      const equipmentCheck =
        hasFishingEquipment(
          [
            ...initialInventory,
            ...adapter.getEquipment(),
          ],
          method,
        );

      if (
        !equipmentCheck.success
      ) {
        return equipmentCheck;
      }

      console.log(
        `[Fishing] Equipment available: ${equipmentCheck.data?.equipment}`,
      );

      /*
       * ------------------------------------------------------------
       * TARGET VALIDATION
       * ------------------------------------------------------------
       */
      if (
        !Number.isFinite(
          targetX,
        ) ||
        !Number.isFinite(
          targetZ,
        )
      ) {
        return {
          success: false,

          message:
            'Saved fishing spot coordinates are invalid',

          data: {
            reason:
              'invalid_coordinates',

            targetX,

            targetZ,
          },
        };
      }

      console.log(
        `[Fishing] Target spot: ${method} at (${targetX}, ${targetZ})`,
      );

      /*
       * ------------------------------------------------------------
       * WALK TO SAVED SPOT
       * ------------------------------------------------------------
       */
      const walkResult =
        await adapter.walkTo(
          targetX,
          targetZ,
          3,
        );

      if (
        !walkResult.success
      ) {
        return {
          success: false,

          message:
            `Could not reach fishing spot: ${walkResult.message}`,

          data: {
            reason:
              'node_unreachable',

            targetX,

            targetZ,
          },
        };
      }

      await waitForTicksSafe(
        adapter,
        1,
      );

      /*
       * ------------------------------------------------------------
       * FIND SAVED FISHING SPOT
       * ------------------------------------------------------------
       */
      const findFishingSpot =
        (): any | null => {
          const nearby =
            adapter.getNearbyNpcs();

          /*
           * Prefer exact coordinates.
           */
          const exact =
            nearby.find(
              (npc: any) =>
                Number(
                  npc?.x,
                ) ===
                  targetX &&
                Number(
                  npc?.z,
                ) ===
                  targetZ &&
                isFishingSpotNpc(
                  npc,
                ),
            );

          if (
            exact
          ) {
            return exact;
          }

          /*
           * Allow a small positional tolerance.
           */
          return (
            nearby.find(
              (npc: any) =>
                isFishingSpotNpc(
                  npc,
                ) &&
                tileDistance(
                  Number(
                    npc?.x ??
                      0,
                  ),
                  Number(
                    npc?.z ??
                      0,
                  ),
                  targetX,
                  targetZ,
                ) <= 2,
            ) ??
            null
          );
        };

      let spot =
        findFishingSpot();

      /*
       * Give the NPC state a little more time to populate after
       * walking into the area.
       */
      if (
        !spot
      ) {
        await waitForTicksSafe(
          adapter,
          2,
        );

        spot =
          findFishingSpot();
      }

      if (
        !spot
      ) {
        return {
          success: false,

          message:
            `Fishing spot at (${targetX}, ${targetZ}) is currently unavailable`,

          data: {
            reason:
              'fishing_spot_not_found',

            location,

            targetX,

            targetZ,

            method,

            target,
          },
        };
      }

      console.log(
        `[Fishing] Found fishing spot: ${spot.name} (${targetX}, ${targetZ})`,
      );

      /*
       * ------------------------------------------------------------
       * TRACK CATCHES
       * ------------------------------------------------------------
       */
      const trackedItems =
        getTrackedFishNames(
          target,
        );

      let totalProgress =
        0;

      let lastProgressAt =
        Date.now();

      const startedAt =
        Date.now();

      /*
       * ------------------------------------------------------------
       * FISHING LOOP
       * ------------------------------------------------------------
       */
      while (
        Date.now() -
          startedAt <
        FISHING_ACTION_TIMEOUT_MS
      ) {
        /*
         * Inventory full.
         */
        const inventory =
          adapter.getInventory();

        if (
          inventory.length >= 28
        ) {
          return {
            success: true,

            message:
              'Inventory full while fishing; banking is required.',

            data: {
              location,

              method,

              target,

              targetX,

              targetZ,

              spot:
                spot.name,

              catches:
                totalProgress,

              reason:
                'inventory_full',
            },
          };
        }

        /*
         * Refresh the fishing spot.
         */
        spot =
          findFishingSpot();

        if (
          !spot
        ) {
          if (
            totalProgress > 0
          ) {
            return {
              success: true,

              message:
                `Fishing spot became unavailable after ${totalProgress} catch/progress event(s).`,

              data: {
                location,

                method,

                target,

                targetX,

                targetZ,

                catches:
                  totalProgress,

                reason:
                  'spot_unavailable',
              },
            };
          }

          return {
            success: false,

            message:
              `Fishing spot at (${targetX}, ${targetZ}) is no longer available.`,

            data: {
              reason:
                'fishing_spot_not_found',

              location,

              method,

              target,

              targetX,

              targetZ,
            },
          };
        }

        /*
         * ----------------------------------------------------------
         * RECORD INVENTORY BEFORE FISHING
         * ----------------------------------------------------------
         */
        const inventoryBefore =
          adapter.getInventory();

        const trackedCountBefore =
          getTrackedInventoryCount(
            inventoryBefore,
            trackedItems,
          );

        const slotsBefore =
          inventoryBefore.length;

        console.log(
          `[Fishing] Fishing ${spot.name} using ${method}...`,
        );

        /*
         * ----------------------------------------------------------
         * START FISHING
         * ----------------------------------------------------------
         */
        const actionResult =
          await adapter.fish(
            method,
          );

        if (
          !actionResult.success
        ) {
          const actionReason =
            String(
              actionResult.data?.reason ??
                '',
            );

          /*
           * Spot may have disappeared between lookup and interaction.
           */
          if (
            actionReason ===
              'fishing_spot_not_found' ||
            /fishing spot.*not found/i.test(
              actionResult.message,
            )
          ) {
            spot =
              findFishingSpot();

            if (
              !spot
            ) {
              return {
                success:
                  totalProgress > 0,

                message:
                  totalProgress > 0
                    ? 'Fishing spot became unavailable after successful catches.'
                    : actionResult.message,

                data: {
                  location,

                  method,

                  target,

                  targetX,

                  targetZ,

                  catches:
                    totalProgress,

                  reason:
                    totalProgress > 0
                      ? 'spot_unavailable'
                      : 'fishing_spot_not_found',
                },
              };
            }
          }

          if (
            actionReason ===
              'fishing_option_not_found'
          ) {
            return {
              success: false,

              message:
                actionResult.message,

              data: {
                location,

                method,

                target,

                targetX,

                targetZ,

                reason:
                  'fishing_option_not_found',

                ...(actionResult.data ?? {}),
              },
            };
          }

          return {
            success: false,

            message:
              actionResult.message,

            data: {
              location,

              method,

              target,

              targetX,

              targetZ,

              reason:
                /timed out/i.test(
                  actionResult.message,
                )
                  ? 'timeout'
                  : actionReason ||
                    'interaction_failed',

              ...(actionResult.data ?? {}),
            },
          };
        }

        /*
         * ----------------------------------------------------------
         * WAIT FOR ACTUAL CATCH
         * ----------------------------------------------------------
         */
        const progress =
          await waitForFishingProgress(
            adapter,
            trackedItems,
            trackedCountBefore,
            slotsBefore,
          );

        if (
          progress.gained > 0
        ) {
          totalProgress +=
            progress.gained;

          lastProgressAt =
            Date.now();

          console.log(
            `[Fishing] Catch confirmed. Progress at this spot: ${totalProgress}.`,
          );

          /*
           * IMPORTANT:
           *
           * Stay at this exact fishing spot.
           * Do not move to another saved node after one catch.
           */
          await waitForTicksSafe(
            adapter,
            1,
          );

          continue;
        }

        /*
         * ----------------------------------------------------------
         * NO CATCH CONFIRMED
         * ----------------------------------------------------------
         */
        spot =
          findFishingSpot();

        if (
          !spot
        ) {
          if (
            totalProgress > 0
          ) {
            return {
              success: true,

              message:
                `Fishing spot disappeared after ${totalProgress} catch/progress event(s).`,

              data: {
                location,

                method,

                target,

                targetX,

                targetZ,

                catches:
                  totalProgress,

                reason:
                  'spot_unavailable',
              },
            };
          }

          return {
            success: false,

            message:
              'Fishing spot disappeared before a catch was confirmed.',

            data: {
              location,

              method,

              target,

              targetX,

              targetZ,

              reason:
                'fishing_spot_not_found',
            },
          };
        }

        console.log(
          `[Fishing] No catch confirmed yet; fishing spot still exists. Staying here.`,
        );

        await waitForTicksSafe(
          adapter,
          1,
        );

        /*
         * Only abandon the spot after the safety timeout.
         */
        if (
          Date.now() -
            lastProgressAt >
          CATCH_PROGRESS_TIMEOUT_MS
        ) {
          return {
            success: false,

            message:
              `No fishing catch/progress was confirmed at (${targetX}, ${targetZ}) while the fishing spot remained available.`,

            data: {
              location,

              method,

              target,

              targetX,

              targetZ,

              spot:
                spot.name,

              catches:
                totalProgress,

              reason:
                'timeout',
            },
          };
        }
      }

      /*
       * ------------------------------------------------------------
       * OVERALL NODE TIMEOUT
       * ------------------------------------------------------------
       */
      return {
        success:
          totalProgress > 0,

        message:
          totalProgress > 0
            ? `Fishing spot dwell time completed with ${totalProgress} catch/progress event(s).`
            : 'Fishing spot timed out without confirmed catch progress.',

        data: {
          location,

          method,

          target,

          targetX,

          targetZ,

          spot:
            spot?.name ??
            'fishing spot',

          catches:
            totalProgress,

          reason:
            totalProgress > 0
              ? 'node_timeout'
              : 'timeout',
        },
      };
    } catch (error) {
      return {
        success: false,

        message:
          `Fishing failed: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,

        data: {
          reason:
            'exception',

          location,

          method,

          target,

          targetX,

          targetZ,
        },
      };
    }
  },
);

/* ================================================================
 * EQUIPMENT
 * ================================================================ */

function hasFishingEquipment(
  items: any[],
  method: string,
): ScriptResult {
  const equipment =
    findFishingEquipment(
      items,
      method,
    );

  if (
    !equipment
  ) {
    return {
      success: false,

      message:
        `Required fishing equipment for method "${method}" is not available.`,

      data: {
        reason:
          'equipment_missing',

        method,
      },
    };
  }

  return {
    success: true,

    message:
      `Fishing equipment available: ${equipment.name}`,

    data: {
      equipment:
        equipment.name,
    },
  };
}

function findFishingEquipment(
  items: any[],
  method: string,
): any | null {
  switch (
    method
  ) {
    case 'net':
      return (
        items.find(
          (item: any) =>
            typeof item?.name ===
              'string' &&
            /small fishing net/i.test(
              item.name,
            ),
        ) ??
        null
      );

    case 'bait':
      return (
        items.find(
          (item: any) =>
            typeof item?.name ===
              'string' &&
            /fishing rod/i.test(
              item.name,
            ),
        ) ??
        null
      );

    case 'fly':
    case 'lure':
      return (
        items.find(
          (item: any) =>
            typeof item?.name ===
              'string' &&
            /fly fishing rod/i.test(
              item.name,
            ),
        ) ??
        null
      );

    case 'cage':
      return (
        items.find(
          (item: any) =>
            typeof item?.name ===
              'string' &&
            /lobster pot/i.test(
              item.name,
            ),
        ) ??
        null
      );

    case 'harpoon':
      return (
        items.find(
          (item: any) =>
            typeof item?.name ===
              'string' &&
            /harpoon/i.test(
              item.name,
            ),
        ) ??
        null
      );

    default:
      return null;
  }
}

/* ================================================================
 * FISHING SPOT
 * ================================================================ */

function isFishingSpotNpc(
  npc: any,
): boolean {
  return (
    typeof npc?.name ===
      'string' &&
    /fishing spot/i.test(
      npc.name,
    )
  );
}

/* ================================================================
 * TRACKED FISH
 * ================================================================ */

function getTrackedFishNames(
  target: string,
): string[] {
  const normalized =
    target
      .trim()
      .toLowerCase();

  if (
    !normalized
  ) {
    return [];
  }

  return [
    normalized,
  ];
}

function getTrackedInventoryCount(
  inventory: any[],
  trackedNames: string[],
): number {
  if (
    trackedNames.length ===
    0
  ) {
    return 0;
  }

  return inventory.reduce(
    (
      total: number,
      item: any,
    ) => {
      if (
        typeof item?.name !==
          'string'
      ) {
        return total;
      }

      const normalized =
        item.name
          .trim()
          .toLowerCase();

      if (
        !trackedNames.includes(
          normalized,
        )
      ) {
        return total;
      }

      return (
        total +
        Number(
          item?.count ?? 0,
        )
      );
    },
    0,
  );
}

/* ================================================================
 * WAIT FOR FISHING PROGRESS
 * ================================================================ */

async function waitForFishingProgress(
  adapter: any,
  trackedNames: string[],
  previousCount: number,
  previousSlots: number,
): Promise<{
  gained: number;
  newCount: number;
}> {
  const startedAt =
    Date.now();

  let currentCount =
    previousCount;

  while (
    Date.now() -
      startedAt <
    CATCH_PROGRESS_TIMEOUT_MS
  ) {
    await waitForTicksSafe(
      adapter,
      1,
    );

    const inventory =
      adapter.getInventory();

    /*
     * When a specific target fish is known, use its count.
     */
    if (
      trackedNames.length >
      0
    ) {
      currentCount =
        getTrackedInventoryCount(
          inventory,
          trackedNames,
        );

      if (
        currentCount >
        previousCount
      ) {
        return {
          gained:
            currentCount -
            previousCount,

          newCount:
            currentCount,
        };
      }
    }

    /*
     * Otherwise, an inventory slot increase is sufficient evidence
     * of a catch.
     */
    if (
      trackedNames.length ===
        0 &&
      inventory.length >
        previousSlots
    ) {
      return {
        gained:
          inventory.length -
          previousSlots,

        newCount:
          inventory.length,
      };
    }
  }

  return {
    gained:
      0,

    newCount:
      currentCount,
  };
}

/* ================================================================
 * SDK HELPERS
 * ================================================================ */

async function waitForTicksSafe(
  adapter: any,
  ticks: number,
): Promise<void> {
  const sdk =
    adapter?.sdk;

  if (
    sdk &&
    typeof sdk.waitForTicks ===
      'function'
  ) {
    await sdk.waitForTicks(
      ticks,
    );
  }
}

function tileDistance(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number {
  return Math.hypot(
    x1 - x2,
    z1 - z2,
  );
}
