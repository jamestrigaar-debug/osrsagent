import { registerScript } from '../registry.js';

import type {
  ScriptContext,
  ScriptResult,
} from '../types.js';

import {
  createRsSdkAdapter,
} from '../../adapters/rs-sdk.js';

const NODE_MINING_TIMEOUT_MS =
  30_000;

const ORE_PROGRESS_TIMEOUT_MS =
  8_000;

registerScript(
  {
    name:
      'gather_ore',

    description:
      'Mine a selected persistent mining node using an available pickaxe. The bot remains at the node until ore is confirmed in inventory, the rock depletes, inventory fills, or a safety timeout occurs.',

    params: {
      location:
        'string — registered mining location',

      resource:
        'string — copper | tin | iron | coal | silver | gold | mithril | adamantite',

      targetX:
        'number — saved mining node world X coordinate',

      targetZ:
        'number — saved mining node world Z coordinate',
    },

    preconditions: [
      'in_game',
      'correct_mining_tool',
      'at_mining_location',
    ],

    postconditions: [
      'mining_action_attempted',
      'ore_gathered_or_node_depleted',
    ],

    failureModes: [
      'resource_not_found',
      'equipment_missing',
      'inventory_full',
      'danger_detected',
      'interaction_failed',
      'timeout',
    ],

    category:
      'gathering',

    verified:
      true,

    version:
      4,
  },

  async (
    params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const location =
      String(
        params.location ?? '',
      ).trim();

    const resource =
      String(
        params.resource ?? '',
      ).trim().toLowerCase();

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
       * INVENTORY CHECK
       * ------------------------------------------------------------
       */
      const initialInventory =
        adapter.getInventory();

      if (
        initialInventory.length >=
        28
      ) {
        return {
          success:
            false,

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
       * PICKAXE CHECK
       * ------------------------------------------------------------
       */
      const pickaxe =
        [
          ...initialInventory,
          ...adapter.getEquipment(),
        ].find(
          (item: any) =>
            typeof item?.name ===
              'string' &&
            /pickaxe/i.test(
              item.name,
            ),
        );

      if (!pickaxe) {
        return {
          success:
            false,

          message:
            'No pickaxe available for mining',

          data: {
            reason:
              'equipment_missing',
          },
        };
      }

      console.log(
        `[Mining] Pickaxe available: ${pickaxe.name}`,
      );

      /*
       * ------------------------------------------------------------
       * VALIDATE TARGET
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
          success:
            false,

          message:
            'Saved mining node coordinates are invalid',

          data: {
            reason:
              'invalid_coordinates',

            targetX,

            targetZ,
          },
        };
      }

      console.log(
        `[Mining] Target node: ${resource} at (${targetX}, ${targetZ})`,
      );

      /*
       * ------------------------------------------------------------
       * WALK TO SAVED NODE
       * ------------------------------------------------------------
       */
      const walkResult =
        await adapter.walkTo(
          targetX,
          targetZ,
          2,
        );

      if (
        !walkResult.success
      ) {
        return {
          success:
            false,

          message:
            `Could not reach mining node: ${walkResult.message}`,

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
       * EXPECTED ROCK
       * ------------------------------------------------------------
       */
      const expectedPattern =
        buildRockPattern(
          resource,
        );

      /*
       * ------------------------------------------------------------
       * EXACT SAVED ROCK LOOKUP
       * ------------------------------------------------------------
       */
      const findSavedRock =
        (): any | null => {
          return (
            adapter
              .getNearbyLocs()
              .find(
                (loc: any) =>
                  Number(
                    loc?.x,
                  ) ===
                    targetX &&
                  Number(
                    loc?.z,
                  ) ===
                    targetZ &&
                  typeof loc?.name ===
                    'string' &&
                  testRegex(
                    expectedPattern,
                    loc.name,
                  ),
              ) ??
            null
          );
        };

      let rock =
        findSavedRock();

      if (!rock) {
        return {
          success:
            false,

          message:
            `Saved ${resource} node at (${targetX}, ${targetZ}) is currently unavailable`,

          data: {
            reason:
              'resource_not_found',

            resource,

            targetX,

            targetZ,
          },
        };
      }

      console.log(
        `[Mining] Found saved node: ${rock.name} (${targetX}, ${targetZ})`,
      );

      /*
       * ------------------------------------------------------------
       * ORE TRACKING
       * ------------------------------------------------------------
       *
       * We measure the actual ore count in inventory before every
       * mining interaction. The node does not count as successfully
       * mined until that count increases.
       */
      const oreName =
        getExpectedOreName(
          resource,
        );

      let totalOreGained =
        0;

      let lastConfirmedOreTime =
        Date.now();

      const nodeStartedAt =
        Date.now();

      /*
       * ------------------------------------------------------------
       * MINING LOOP
       * ------------------------------------------------------------
       */
      while (
        Date.now() -
          nodeStartedAt <
        NODE_MINING_TIMEOUT_MS
      ) {
        /*
         * Inventory can become full while the node is still active.
         */
        const inventory =
          adapter.getInventory();

        if (
          inventory.length >=
          28
        ) {
          console.log(
            '[Mining] Inventory full while mining.',
          );

          return {
            success:
              true,

            message:
              'Inventory full while mining; banking is required.',

            data: {
              location,

              resource,

              pickaxe:
                pickaxe.name,

              targetX,

              targetZ,

              node:
                rock.name,

              oreGained:
                totalOreGained,

              reason:
                'inventory_full',
            },
          };
        }

        /*
         * Verify that the same saved node still exists.
         */
        rock =
          findSavedRock();

        if (!rock) {
          console.log(
            `[Mining] Saved node depleted or disappeared at (${targetX}, ${targetZ}).`,
          );

          return {
            success:
              true,

            message:
              `Mining node depleted at (${targetX}, ${targetZ}).`,

            data: {
              location,

              resource,

              pickaxe:
                pickaxe.name,

              targetX,

              targetZ,

              node:
                `${resource} ore`,

              oreGained:
                totalOreGained,

              reason:
                'node_depleted',
            },
          };
        }

        /*
         * ----------------------------------------------------------
         * COUNT ORE BEFORE MINE
         * ----------------------------------------------------------
         */
        const oreBefore =
          getItemCount(
            inventory,
            oreName,
          );

        console.log(
          `[Mining] Mining ${rock.name} at (${targetX}, ${targetZ}) — ${oreName} before: ${oreBefore}`,
        );

        /*
         * ----------------------------------------------------------
         * MINE
         * ----------------------------------------------------------
         */
        const actionResult =
          await adapter.mine(
            resource,
          );

        if (
          !actionResult.success
        ) {
          /*
           * The rock may have disappeared between lookup and action.
           */
          rock =
            findSavedRock();

          if (!rock) {
            console.log(
              '[Mining] Rock disappeared during mining attempt.',
            );

            return {
              success:
                true,

              message:
                `Mining node depleted at (${targetX}, ${targetZ}).`,

              data: {
                location,

                resource,

                pickaxe:
                  pickaxe.name,

                targetX,

                targetZ,

                node:
                  `${resource} ore`,

                oreGained:
                  totalOreGained,

                reason:
                  'node_depleted',
              },
            };
          }

          const actionReason =
            String(
              actionResult.data?.reason ??
                '',
            );

          return {
            success:
              false,

            message:
              actionResult.message,

            data: {
              location,

              resource,

              pickaxe:
                pickaxe.name,

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
         * WAIT FOR ACTUAL ORE
         * ----------------------------------------------------------
         *
         * We do NOT move away simply because the interaction
         * succeeded. We wait until the inventory proves the mine
         * produced ore.
         */
        const progress =
          await waitForOreIncrease(
            adapter,
            oreName,
            oreBefore,
          );

        if (
          progress.gained > 0
        ) {
          totalOreGained +=
            progress.gained;

          lastConfirmedOreTime =
            Date.now();

          console.log(
            `[Mining] Ore confirmed: ${oreName} ${oreBefore} -> ${progress.newCount}. Total node gain: ${totalOreGained}.`,
          );

          /*
           * Stay on THIS node.
           */
          await waitForTicksSafe(
            adapter,
            1,
          );

          continue;
        }

        /*
         * ----------------------------------------------------------
         * NO ORE YET
         * ----------------------------------------------------------
         *
         * Before considering the node failed, check whether it has
         * disappeared. If it is still there, stay.
         */
        rock =
          findSavedRock();

        if (!rock) {
          return {
            success:
              true,

            message:
              `Mining node depleted at (${targetX}, ${targetZ}).`,

            data: {
              location,

              resource,

              pickaxe:
                pickaxe.name,

              targetX,

              targetZ,

              node:
                `${resource} ore`,

              oreGained:
                totalOreGained,

              reason:
                'node_depleted',
            },
          };
        }

        console.log(
          `[Mining] No ore confirmed from last mine; rock still exists. Staying on node.`,
        );

        /*
         * Give the game another tick and continue checking the same
         * node instead of advancing the route.
         */
        await waitForTicksSafe(
          adapter,
          1,
        );

        /*
         * ----------------------------------------------------------
         * SAFETY TIMEOUT
         * ----------------------------------------------------------
         *
         * Only after a long period with no confirmed ore do we
         * return a failure. This prevents the route from silently
         * moving to another rock without evidence of success.
         */
        if (
          Date.now() -
            lastConfirmedOreTime >
          ORE_PROGRESS_TIMEOUT_MS
        ) {
          return {
            success:
              false,

            message:
              `No ore was confirmed from ${rock.name} at (${targetX}, ${targetZ}) while the rock remained available.`,

            data: {
              location,

              resource,

              pickaxe:
                pickaxe.name,

              targetX,

              targetZ,

              node:
                rock.name,

              oreGained:
                totalOreGained,

              reason:
                'timeout',
            },
          };
        }
      }

      /*
       * ------------------------------------------------------------
       * NODE DWELL TIME EXPIRED
       * ------------------------------------------------------------
       */
      return {
        success:
          totalOreGained > 0,

        message:
          totalOreGained > 0
            ? `Mining node completed with ${totalOreGained} ${oreName}.`
            : `Mining node timed out without confirmed ore.`,

        data: {
          location,

          resource,

          pickaxe:
            pickaxe.name,

          targetX,

          targetZ,

          node:
            rock.name,

          oreGained:
            totalOreGained,

          reason:
            totalOreGained > 0
              ? 'node_timeout'
              : 'timeout',
        },
      };
    } catch (error) {
      return {
        success:
          false,

        message:
          `Mining failed: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,

        data: {
          reason:
            'exception',
        },
      };
    }
  },
);

/* ================================================================
 * WAIT FOR ORE INCREASE
 * ================================================================ */

async function waitForOreIncrease(
  adapter: any,
  oreName: string,
  previousCount: number,
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
    ORE_PROGRESS_TIMEOUT_MS
  ) {
    await waitForTicksSafe(
      adapter,
      1,
    );

    currentCount =
      getItemCount(
        adapter.getInventory(),
        oreName,
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

  return {
    gained:
      0,

    newCount:
      currentCount,
  };
}

/* ================================================================
 * ORE HELPERS
 * ================================================================ */

function getItemCount(
  inventory: any[],
  itemName: string,
): number {
  return inventory.reduce(
    (
      total: number,
      item: any,
    ) => {
      if (
        typeof item?.name !==
          'string' ||
        item.name.toLowerCase() !==
          itemName.toLowerCase()
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

function getExpectedOreName(
  resource: string,
): string {
  return `${resource} ore`;
}

/* ================================================================
 * ROCK PATTERN
 * ================================================================ */

function buildRockPattern(
  resource: string,
): RegExp {
  const knownResources =
    new Set([
      'copper',
      'tin',
      'iron',
      'coal',
      'silver',
      'gold',
      'mithril',
      'adamantite',
    ]);

  if (
    knownResources.has(
      resource.toLowerCase(),
    )
  ) {
    return new RegExp(
      `^Rocks ${escapeRegex(
        resource,
      )} ore$`,
      'i',
    );
  }

  return new RegExp(
    escapeRegex(
      resource,
    ),
    'i',
  );
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

function testRegex(
  pattern: RegExp,
  value: string,
): boolean {
  pattern.lastIndex =
    0;

  return pattern.test(
    value,
  );
}

function escapeRegex(
  value: string,
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
}
