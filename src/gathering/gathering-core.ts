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

import {
  updateAccountMemoryFromAdapter,
} from "../state/game-state-sync.js";

export interface GatheringLocation {
  name: string;
  x: number;
  z: number;
  tolerance?: number;
}

export interface GatheringNodeRouteConfig {
  enabled: boolean;

  /*
   * locs = rocks, trees, etc.
   * npcs = fishing spots, etc.
   */
  nodeType:
    | "locs"
    | "npcs";

  scanRadius?: number;

  maxNodes?: number;

  nodePattern: RegExp;

  rebuildAfterMisses?: number;
}

export interface GatheringCoreConfig {
  profession:
    | "woodcutting"
    | "mining"
    | "fishing";

  taskName: string;

  bank: GatheringLocation;

  resource: GatheringLocation;

  prepareScript: string;

  prepareParams?: Record<string, unknown>;

  gatherScript: string;

  gatherParams: Record<string, unknown>;

  inventoryThreshold: number;

  /*
   * Gathering is deliberately conservative.
   *
   * Default:
   *   70% HP = retreat threshold
   */
  hpStopPercent?: number;

  dangerousNpcPattern?: RegExp;

  nodeRoute?: GatheringNodeRouteConfig;

  /**
   * undefined or 0 = continuous
   * 1 = one cycle
   * 10 = ten cycles
   */
  maxCycles?: number;

  cancelSignal?: AbortSignal;
}

interface GatheringNode {
  x: number;
  z: number;
  name: string;
}

export interface GatheringCycleResult
  extends ScriptResult {
  data?: Record<string, unknown> & {
    cycle?: number;
    action?: string;
  };
}

export async function runGatheringCore(
  config: GatheringCoreConfig,
  ctx: ScriptContext,
): Promise<GatheringCycleResult> {
  /*
   * Resolve adapter in priority order:
   *
   *   1. Shared adapter already attached to ctx.adapter.
   *   2. Shared adapter pool from ctx.adapterPool.
   *   3. Fresh adapter created here.
   */
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

  let adapter:
    RsSdkAdapter;

  let usedPool =
    false;

  const adapterOptions:
    RsSdkAdapterOptions = {
    server:
      ctx.sdkBaseUrl,

    botName:
      ctx.sdkBotName,

    password:
      ctx.sdkBotPassword,
  };

  if (
    isValidAdapter(
      suppliedAdapter,
    )
  ) {
    adapter =
      suppliedAdapter;
  } else if (
    ctx.adapterPool
  ) {
    adapter =
      await ctx.adapterPool.getAdapter(
        ctx.accountId,
        adapterOptions,
      );

    usedPool =
      true;
  } else {
    adapter =
      new RsSdkAdapter(
        adapterOptions,
      );
  }

  /*
   * Every child script gets the same live adapter.
   */
  const sharedContext:
    ScriptContext = {
    ...ctx,

    adapter,
  };

  const unlimitedCycles =
    config.maxCycles === undefined ||
    config.maxCycles === 0;

  const maxCycles =
    unlimitedCycles
      ? Number.POSITIVE_INFINITY
      : Math.max(
          1,
          config.maxCycles ?? 1,
        );

  /*
   * Conservative safety threshold.
   *
   * The previous 50% default was too late. If the account has
   * 12 HP, 70% means retreating at 8 HP or below.
   */
  const hpStopPercent =
    config.hpStopPercent ??
    0.70;

  /*
   * Persistent route.
   *
   * It survives banking and danger recovery.
   */
  let nodeRoute:
    GatheringNode[] = [];

  let routeIndex =
    0;

  let nodeMisses =
    0;

  const rebuildAfterMisses =
    Math.max(
      1,
      config.nodeRoute?.rebuildAfterMisses ??
        3,
    );

  let cycle =
    1;

  try {
    await adapter.connect();

    while (
      !config.cancelSignal?.aborted &&
      (
        unlimitedCycles ||
        cycle <= maxCycles
      )
    ) {
      console.log("");
      console.log(
        "================================",
      );
      console.log(
        `${config.profession.toUpperCase()} CYCLE ${cycle}`,
      );
      console.log(
        "================================",
      );

      /*
       * ------------------------------------------------------------
       * CANCELLATION
       * ------------------------------------------------------------
       */
      if (
        config.cancelSignal?.aborted
      ) {
        break;
      }

      /*
       * ------------------------------------------------------------
       * CURRENT STATE
       * ------------------------------------------------------------
       */
      const state =
        adapter.getState();

      const player =
        state?.player as any;

      if (!player) {
        return failure(
          "Player state unavailable",
          cycle,
          "state_unavailable",
        );
      }

      /*
       * ------------------------------------------------------------
       * HP SAFETY
       * ------------------------------------------------------------
       *
       * We do NOT allow the dispatcher to keep retrying while the
       * character is dying.
       *
       * At or below the threshold:
       *
       *   gather -> retreat -> recover -> continue
       */
      const hp =
        Number(
          player.hp ?? 0,
        );

      const maxHp =
        Number(
          player.maxHp ?? 0,
        );

      if (
        maxHp > 0 &&
        hp / maxHp <=
          hpStopPercent
      ) {
        console.log(
          `[Gathering] HP emergency: ${hp}/${maxHp}. Retreating to ${config.bank.name}.`,
        );

        const retreat =
          await retreatToBank(
            adapter,
            config.bank,
          );

        if (
          !retreat.success
        ) {
          return {
            success:
              false,

            message:
              `HP emergency and retreat failed: ${retreat.message}`,

            data: {
              cycle,

              action:
                "emergency_retreat",

              hp,

              maxHp,

              reason:
                "low_hp",

              ...(retreat.data ?? {}),
            },
          };
        }

        /*
         * Let the player regenerate before attempting another cycle.
         */
        await waitForTicksSafe(
          adapter,
          10,
        );

        cycle++;

        continue;
      }

      /*
       * ------------------------------------------------------------
       * DANGER
       * ------------------------------------------------------------
       *
       * Danger is recoverable.
       *
       * IMPORTANT:
       *
       * "none", "null", "undefined" and empty combat targets are
       * never treated as real enemies.
       */
      const nearbyNpcs =
        adapter.getNearbyNpcs();

      const danger =
        detectDanger(
          state,
          nearbyNpcs,
          config.dangerousNpcPattern,
        );

      if (
        danger
      ) {
        console.log(
          `[Gathering] Danger detected: ${danger}. Attempting recovery...`,
        );

        const escapeResult =
          await escapeDanger(
            adapter,
            config.resource,
            danger,
          );

        if (
          !escapeResult.success
        ) {
          return {
            success:
              false,

            message:
              `Could not escape danger: ${escapeResult.message}`,

            data: {
              cycle,

              action:
                "escape_danger",

              npc:
                danger,

              reason:
                "danger_escape_failed",

              ...(escapeResult.data ??
                {}),
            },
          };
        }

        await waitForTicksSafe(
          adapter,
          4,
        );

        /*
         * Re-check after escaping.
         */
        const safeState =
          adapter.getState();

        const safeDanger =
          detectDanger(
            safeState,
            adapter.getNearbyNpcs(),
            config.dangerousNpcPattern,
          );

        if (
          safeDanger
        ) {
          console.log(
            `[Gathering] Danger is still present (${safeDanger}); staying away temporarily.`,
          );

          await waitForTicksSafe(
            adapter,
            6,
          );

          continue;
        }

        console.log(
          "[Gathering] Danger cleared. Resuming gathering.",
        );

        continue;
      }

      /*
       * ------------------------------------------------------------
       * INVENTORY / BANK
       * ------------------------------------------------------------
       */
      const inventory =
        adapter.getInventory();

      console.log(
        `[Gathering] Inventory: ${inventory.length}/28`,
      );

      if (
        inventory.length >=
        config.inventoryThreshold
      ) {
        console.log(
          `[Gathering] Inventory threshold reached: ${inventory.length}/${config.inventoryThreshold}`,
        );

        const bankResult =
          await bankAndReset(
            adapter,
            config.bank,
          );

        if (
          !bankResult.success
        ) {
          return {
            success:
              false,

            message:
              bankResult.message,

            data: {
              cycle,

              action:
                "bank",

              ...(bankResult.data ?? {}),
            },
          };
        }

        continue;
      }

      /*
       * ------------------------------------------------------------
       * PREPARE
       * ------------------------------------------------------------
       */
      console.log(
        `[Gathering] Preparing via ${config.prepareScript}...`,
      );

      const prepareResult =
        await executeScript(
          config.prepareScript,
          config.prepareParams ??
            {},
          sharedContext,
        );

      if (
        !prepareResult.success
      ) {
        return {
          success:
            false,

          message:
            `Preparation failed: ${prepareResult.message}`,

          data: {
            cycle,

            action:
              "prepare",

            ...(prepareResult.data ?? {}),
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * VERIFY REQUIRED EQUIPMENT
       * ------------------------------------------------------------
       */
      const equipmentCheck =
        verifyGatheringEquipment(
          config.profession,
          adapter,
          config.gatherParams,
        );

      if (
        !equipmentCheck.success
      ) {
        return {
          success:
            false,

          message:
            equipmentCheck.message,

          data: {
            cycle,

            action:
              "equipment_check",

            ...(equipmentCheck.data ?? {}),
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * NODE ROUTE
       * ------------------------------------------------------------
       */
      let currentNode:
        GatheringNode |
        undefined;

      if (
        config.nodeRoute?.enabled
      ) {
        const rebuildingRoute =
          nodeRoute.length === 0 ||
          nodeMisses >=
            rebuildAfterMisses;

        if (
          rebuildingRoute
        ) {
          /*
           * --------------------------------------------------------
           * TRAVEL TO RESOURCE BEFORE SCANNING
           * --------------------------------------------------------
           */
          const current =
            adapter.getState()
              ?.player as any;

          if (!current) {
            return failure(
              "Player state unavailable before route rebuild",
              cycle,
              "state_unavailable",
            );
          }

          const distance =
            tileDistance(
              Number(
                current.worldX ?? 0,
              ),
              Number(
                current.worldZ ?? 0,
              ),
              config.resource.x,
              config.resource.z,
            );

          if (
            distance >
            (
              config.resource
                .tolerance ??
              5
            )
          ) {
            console.log(
              `[Gathering] Travelling to ${config.resource.name} before route rebuild...`,
            );

            const travel =
              await adapter.walkTo(
                config.resource.x,
                config.resource.z,
                config.resource
                  .tolerance ??
                  5,
              );

            if (
              !travel.success
            ) {
              return {
                success:
                  false,

                message:
                  `Could not reach ${config.resource.name}: ${travel.message}`,

                data: {
                  cycle,

                  action:
                    "travel_to_resource",

                  reason:
                    "resource_unreachable",

                  ...(travel.data ?? {}),
                },
              };
            }
          }

          await waitForTicksSafe(
            adapter,
            2,
          );

          /*
           * Check for danger immediately after reaching the
           * resource area.
           */
          const resourceState =
            adapter.getState();

          const resourceDanger =
            detectDanger(
              resourceState,
              adapter.getNearbyNpcs(),
              config.dangerousNpcPattern,
            );

          if (
            resourceDanger
          ) {
            console.log(
              `[Gathering] Danger detected at resource area: ${resourceDanger}. Escaping before route scan...`,
            );

            const escapeResult =
              await escapeDanger(
                adapter,
                config.resource,
                resourceDanger,
              );

            if (
              !escapeResult.success
            ) {
              return {
                success:
                  false,

                message:
                  `Could not escape resource-area danger: ${escapeResult.message}`,

                data: {
                  cycle,

                  action:
                    "escape_danger",

                  npc:
                    resourceDanger,

                  reason:
                    "danger_escape_failed",

                  ...(escapeResult.data ??
                    {}),
                },
              };
            }

            await waitForTicksSafe(
              adapter,
              5,
            );

            continue;
          }

          console.log(
            `[Gathering] Scanning ${config.nodeRoute.nodeType} for resource nodes (radius ${config.nodeRoute.scanRadius ?? 15})...`,
          );

          nodeRoute =
            await buildNodeRoute(
              adapter,
              config.nodeRoute,
            );

          routeIndex =
            0;

          nodeMisses =
            0;

          if (
            nodeRoute.length ===
            0
          ) {
            await waitForTicksSafe(
              adapter,
              3,
            );

            nodeRoute =
              await buildNodeRoute(
                adapter,
                config.nodeRoute,
              );
          }

          if (
            nodeRoute.length ===
            0
          ) {
            return {
              success:
                false,

              message:
                `No ${config.profession} resource nodes found near ${config.resource.name}`,

              data: {
                cycle,

                action:
                  "build_route",

                reason:
                  "resource_nodes_not_found",
              },
            };
          }

          console.log(
            `[Gathering] Built persistent route with ${nodeRoute.length} node(s).`,
          );

          for (
            let i = 0;
            i < nodeRoute.length;
            i++
          ) {
            const node =
              nodeRoute[i];

            if (!node) {
              continue;
            }

            console.log(
              `[Gathering] Node ${i + 1}: ${node.name} (${node.x}, ${node.z})`,
            );
          }
        }

        /*
         * ----------------------------------------------------------
         * SELECT CURRENT NODE
         * ----------------------------------------------------------
         */
        currentNode =
          nodeRoute[
            routeIndex %
              nodeRoute.length
          ];

        if (
          !currentNode
        ) {
          return failure(
            "Node route produced no current node",
            cycle,
            "route_empty",
          );
        }

        console.log(
          `[Gathering] Route node ${routeIndex % nodeRoute.length + 1}/${nodeRoute.length}: ${currentNode.name} (${currentNode.x}, ${currentNode.z})`,
        );

        /*
         * Walk to saved node.
         */
        const travel =
          await adapter.walkTo(
            currentNode.x,
            currentNode.z,
            2,
          );

        if (
          !travel.success
        ) {
          nodeMisses++;

          console.log(
            `[Gathering] Could not reach saved node (${currentNode.x}, ${currentNode.z}). Miss ${nodeMisses}/${rebuildAfterMisses}.`,
          );

          routeIndex++;

          continue;
        }

        /*
         * ----------------------------------------------------------
         * DANGER AT ACTUAL NODE
         * ----------------------------------------------------------
         */
        const nodeState =
          adapter.getState();

        const nodeDanger =
          detectDanger(
            nodeState,
            adapter.getNearbyNpcs(),
            config.dangerousNpcPattern,
          );

        if (
          nodeDanger
        ) {
          console.log(
            `[Gathering] Node ${currentNode.name} is unsafe because of ${nodeDanger}. Skipping this node.`,
          );

          nodeMisses++;

          routeIndex++;

          const escapeResult =
            await escapeDanger(
              adapter,
              config.resource,
              nodeDanger,
            );

          if (
            !escapeResult.success
          ) {
            return {
              success:
                false,

              message:
                `Could not move away from dangerous node: ${escapeResult.message}`,

              data: {
                cycle,

                action:
                  "escape_danger",

                npc:
                  nodeDanger,

                node:
                  currentNode.name,

                reason:
                  "danger_escape_failed",

                ...(escapeResult.data ??
                  {}),
              },
            };
          }

          await waitForTicksSafe(
            adapter,
            3,
          );

          continue;
        }
      } else {
        /*
         * ----------------------------------------------------------
         * FALLBACK WITHOUT NODE ROUTING
         * ----------------------------------------------------------
         */
        const current =
          adapter.getState()
            ?.player as any;

        if (!current) {
          return failure(
            "Player state unavailable before travel",
            cycle,
            "state_unavailable",
          );
        }

        const distance =
          tileDistance(
            Number(
              current.worldX ?? 0,
            ),
            Number(
              current.worldZ ?? 0,
            ),
            config.resource.x,
            config.resource.z,
          );

        if (
          distance >
          (
            config.resource
              .tolerance ??
            4
          )
        ) {
          console.log(
            `[Gathering] Travelling to ${config.resource.name}...`,
          );

          const travel =
            await adapter.walkTo(
              config.resource.x,
              config.resource.z,
              config.resource
                .tolerance ??
                4,
            );

          if (
            !travel.success
          ) {
            return {
              success:
                false,

              message:
                `Could not reach ${config.resource.name}: ${travel.message}`,

              data: {
                cycle,

                action:
                  "travel",

                ...(travel.data ?? {}),
              },
            };
          }
        }
      }

      /*
       * ------------------------------------------------------------
       * CANCELLATION AFTER TRAVEL
       * ------------------------------------------------------------
       */
      if (
        config.cancelSignal?.aborted
      ) {
        break;
      }

      /*
       * ------------------------------------------------------------
       * SECOND DANGER CHECK
       * ------------------------------------------------------------
       */
      const travelState =
        adapter.getState();

      const travelDanger =
        detectDanger(
          travelState,
          adapter.getNearbyNpcs(),
          config.dangerousNpcPattern,
        );

      if (
        travelDanger
      ) {
        console.log(
          `[Gathering] Danger detected after travel: ${travelDanger}. Escaping and retrying.`,
        );

        const escapeResult =
          await escapeDanger(
            adapter,
            config.resource,
            travelDanger,
          );

        if (
          !escapeResult.success
        ) {
          return {
            success:
              false,

            message:
              `Could not escape travel-area danger: ${escapeResult.message}`,

            data: {
              cycle,

              action:
                "escape_danger",

              npc:
                travelDanger,

              reason:
                "danger_escape_failed",

              ...(escapeResult.data ??
                {}),
            },
          };
        }

        await waitForTicksSafe(
          adapter,
          4,
        );

        continue;
      }

      /*
       * ------------------------------------------------------------
       * GATHER
       * ------------------------------------------------------------
       */
      console.log(
        `[Gathering] Executing ${config.gatherScript}...`,
      );

      const gatherParams:
        Record<string, unknown> = {
        ...config.gatherParams,
      };

      /*
       * Pass saved coordinates to profession-specific scripts.
       */
      if (
        currentNode
      ) {
        gatherParams.targetX =
          currentNode.x;

        gatherParams.targetZ =
          currentNode.z;
      }

      const gatherResult =
        await executeScript(
          config.gatherScript,
          gatherParams,
          sharedContext,
        );

      if (
        !gatherResult.success
      ) {
        const reason =
          String(
            gatherResult.data?.reason ??
              "",
          )
            .trim()
            .toLowerCase();

        /*
         * ----------------------------------------------------------
         * INVENTORY FULL
         * ----------------------------------------------------------
         */
        if (
          reason ===
          "inventory_full"
        ) {
          console.log(
            "[Gathering] Inventory full; banking next.",
          );
        }

        /*
         * ----------------------------------------------------------
         * NODE UNAVAILABLE / TIMEOUT
         * ----------------------------------------------------------
         */
        else if (
          config.nodeRoute?.enabled &&
          (
            reason ===
              "resource_not_found" ||
            reason ===
              "node_not_found" ||
            reason ===
              "node_unavailable" ||
            reason ===
              "timeout" ||
            /timed out/i.test(
              gatherResult.message,
            )
          )
        ) {
          nodeMisses++;

          console.log(
            `[Gathering] Saved node unavailable or timed out. Skipping node. Miss ${nodeMisses}/${rebuildAfterMisses}.`,
          );

          if (
            currentNode
          ) {
            console.log(
              `[Gathering] Skipping ${currentNode.name} (${currentNode.x}, ${currentNode.z}).`,
            );
          }

          routeIndex++;

          continue;
        }

        /*
         * ----------------------------------------------------------
         * DANGER REPORTED BY CHILD SCRIPT
         * ----------------------------------------------------------
         */
        else if (
          reason ===
            "danger_detected" ||
          reason ===
            "escape_danger"
        ) {
          const childDanger =
            normaliseDangerName(
              gatherResult.data?.npc ??
                gatherResult.data?.target ??
                gatherResult.data?.targetName ??
                "",
            );

          /*
           * If the child says "none", do not invent a danger event.
           */
          if (
            !childDanger
          ) {
            console.log(
              "[Gathering] Child script reported a non-specific/empty danger state. Re-checking instead of fleeing.",
            );

            await waitForTicksSafe(
              adapter,
              2,
            );

            continue;
          }

          console.log(
            `[Gathering] Child gathering script reported danger: ${childDanger}. Recovering.`,
          );

          const escapeResult =
            await escapeDanger(
              adapter,
              config.resource,
              childDanger,
            );

          if (
            !escapeResult.success
          ) {
            return {
              success:
                false,

              message:
                `Could not recover from child-script danger: ${escapeResult.message}`,

              data: {
                cycle,

                action:
                  "escape_danger",

                npc:
                  childDanger,

                reason:
                  "danger_escape_failed",

                ...(escapeResult.data ??
                  {}),
              },
            };
          }

          await waitForTicksSafe(
            adapter,
            4,
          );

          continue;
        }

        /*
         * ----------------------------------------------------------
         * LOW HP FROM CHILD SCRIPT
         * ----------------------------------------------------------
         */
        else if (
          reason ===
          "low_hp"
        ) {
          console.log(
            "[Gathering] Child script reported low HP. Emergency retreat.",
          );

          const retreat =
            await retreatToBank(
              adapter,
              config.bank,
            );

          if (
            !retreat.success
          ) {
            return {
              success:
                false,

              message:
                `Low HP retreat failed: ${retreat.message}`,

              data: {
                cycle,

                action:
                  "emergency_retreat",

                reason:
                  "retreat_failed",

                ...(retreat.data ?? {}),
              },
            };
          }

          await waitForTicksSafe(
            adapter,
            10,
          );

          continue;
        }

        /*
         * ----------------------------------------------------------
         * OTHER FAILURE
         * ----------------------------------------------------------
         */
        else {
          return {
            success:
              false,

            message:
              `Gathering failed: ${gatherResult.message}`,

            data: {
              cycle,

              action:
                "gather",

              ...(gatherResult.data ?? {}),
            },
          };
        }
      }

      /*
       * ------------------------------------------------------------
       * ADVANCE SUCCESSFUL NODE
       * ------------------------------------------------------------
       */
      if (
        config.nodeRoute?.enabled
      ) {
        routeIndex++;

        nodeMisses =
          0;
      }

      /*
       * ------------------------------------------------------------
       * POST-GATHER HP
       * ------------------------------------------------------------
       */
      const afterGather =
        adapter.getState();

      const afterGatherPlayer =
        afterGather?.player as any;

      if (
        afterGatherPlayer
      ) {
        const afterHp =
          Number(
            afterGatherPlayer.hp ??
              0,
          );

        const afterMaxHp =
          Number(
            afterGatherPlayer.maxHp ??
              0,
          );

        if (
          afterMaxHp > 0 &&
          afterHp /
            afterMaxHp <=
            hpStopPercent
        ) {
          console.log(
            `[Gathering] HP dropped to ${afterHp}/${afterMaxHp}. Emergency retreat.`,
          );

          const retreat =
            await retreatToBank(
              adapter,
              config.bank,
            );

          if (
            !retreat.success
          ) {
            return {
              success:
                false,

              message:
                `HP emergency retreat failed: ${retreat.message}`,

              data: {
                cycle,

                action:
                  "emergency_retreat",

                hp:
                  afterHp,

                maxHp:
                  afterMaxHp,

                reason:
                  "retreat_failed",

                ...(retreat.data ?? {}),
              },
            };
          }

          await waitForTicksSafe(
            adapter,
            10,
          );

          cycle++;

          continue;
        }
      }

      /*
       * ------------------------------------------------------------
       * INVENTORY AFTER GATHER
       * ------------------------------------------------------------
       */
      const afterInventory =
        adapter.getInventory();

      console.log(
        `[Gathering] After gather: ${afterInventory.length}/28`,
      );

      if (
        afterInventory.length >=
        config.inventoryThreshold
      ) {
        console.log(
          "[Gathering] Threshold reached; banking...",
        );

        const bankResult =
          await bankAndReset(
            adapter,
            config.bank,
          );

        if (
          !bankResult.success
        ) {
          return {
            success:
              false,

            message:
              bankResult.message,

            data: {
              cycle,

              action:
                "bank",

              ...(bankResult.data ?? {}),
            },
          };
        }

        console.log(
          `[Gathering] Banking completed at ${config.bank.name}.`,
        );
      }

      console.log(
        `[Gathering] Cycle ${cycle} complete. Continuing...`,
      );

      /*
       * Persist current live state.
       */
      await updateAccountMemoryFromAdapter(
        adapter,
        ctx.accountId,
      );

      cycle++;
    }

    /*
     * --------------------------------------------------------------
     * FINISHED
     * --------------------------------------------------------------
     */
    return {
      success:
        true,

      message:
        config.cancelSignal?.aborted
          ? `${config.taskName}: cancelled`
          : `${config.taskName}: maximum cycles completed`,

      data: {
        action:
          config.cancelSignal?.aborted
            ? "cancelled"
            : "max_cycles",

        cycle,
      },
    };
  } catch (
    error
  ) {
    return failure(
      error instanceof Error
        ? error.message
        : String(error),
      cycle,
      "exception",
    );
  } finally {
    /*
     * Lifecycle rules:
     *
     *   - Pooled adapter: release.
     *   - Supplied adapter: caller owns it.
     *   - Fresh adapter: disconnect.
     */
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
 * EQUIPMENT VERIFICATION
 * ================================================================ */

function verifyGatheringEquipment(
  profession:
    | "woodcutting"
    | "mining"
    | "fishing",

  adapter:
    RsSdkAdapter,

  gatherParams:
    Record<string, unknown>,
): ScriptResult {
  const items = [
    ...adapter.getInventory(),
    ...adapter.getEquipment(),
  ];

  /*
   * WOODCUTTING
   */
  if (
    profession ===
    "woodcutting"
  ) {
    const axe =
      items.find(
        (item: any) =>
          typeof item?.name ===
            "string" &&
          /\baxe\b/i.test(
            item.name,
          ),
      );

    if (
      !axe
    ) {
      return {
        success:
          false,

        message:
          "Woodcutting requires an axe, but no axe is available.",

        data: {
          reason:
            "equipment_missing",

          required:
            "axe",
        },
      };
    }

    console.log(
      `[Gathering] Equipment verified: ${axe.name}`,
    );

    return {
      success:
        true,

      message:
        `Axe verified: ${axe.name}`,

      data: {
        equipment:
          axe.name,
      },
    };
  }

  /*
   * MINING
   */
  if (
    profession ===
    "mining"
  ) {
    const pickaxe =
      items.find(
        (item: any) =>
          typeof item?.name ===
            "string" &&
          /pickaxe/i.test(
            item.name,
          ),
      );

    if (
      !pickaxe
    ) {
      return {
        success:
          false,

        message:
          "Mining requires a pickaxe, but no pickaxe is available.",

        data: {
          reason:
            "equipment_missing",

          required:
            "pickaxe",
        },
      };
    }

    console.log(
      `[Gathering] Equipment verified: ${pickaxe.name}`,
    );

    return {
      success:
        true,

      message:
        `Pickaxe verified: ${pickaxe.name}`,

      data: {
        equipment:
          pickaxe.name,
      },
    };
  }

  /*
   * FISHING
   */
  const method =
    String(
      gatherParams.method ??
        "net",
    )
      .trim()
      .toLowerCase();

  const equipment =
    getFishingEquipmentPattern(
      method,
    );

  const fishingTool =
    items.find(
      (item: any) =>
        typeof item?.name ===
          "string" &&
        testRegex(
          equipment.regex,
          item.name,
        ),
    );

  if (
    !fishingTool
  ) {
    return {
      success:
        false,

      message:
        `Fishing requires ${equipment.source} for method "${method}", but the required equipment is not available.`,

      data: {
        reason:
          "equipment_missing",

        required:
          equipment.source,

        method,
      },
    };
  }

  console.log(
    `[Gathering] Fishing equipment verified: ${fishingTool.name}`,
  );

  return {
    success:
      true,

    message:
      `Fishing equipment verified: ${fishingTool.name}`,

    data: {
      equipment:
        fishingTool.name,

      method,
    },
  };
}

function getFishingEquipmentPattern(
  method:
    string,
): {
  source:
    string;

  regex:
    RegExp;
} {
  switch (
    method
  ) {
    case "net":
      return {
        source:
          "small fishing net",

        regex:
          /small fishing net/i,
      };

    case "bait":
      return {
        source:
          "fishing rod and bait",

        regex:
          /fishing rod/i,
      };

    case "fly":
    case "lure":
      return {
        source:
          "fly fishing rod and feathers",

        regex:
          /fly fishing rod/i,
      };

    case "cage":
      return {
        source:
          "lobster pot",

        regex:
          /lobster pot/i,
      };

    case "harpoon":
      return {
        source:
          "harpoon",

        regex:
          /harpoon/i,
      };

    default:
      return {
        source:
          method,

        regex:
          new RegExp(
            escapeRegex(
              method,
            ),
            "i",
          ),
      };
  }
}

/* ================================================================
 * NODE ROUTE BUILDER
 * ================================================================ */

async function buildNodeRoute(
  adapter:
    RsSdkAdapter,

  routeConfig:
    GatheringNodeRouteConfig,
): Promise<GatheringNode[]> {
  const radius =
    Math.max(
      1,
      routeConfig.scanRadius ??
        8,
    );

  const maxNodes =
    Math.max(
      1,
      routeConfig.maxNodes ??
        6,
    );

  let objects:
    any[] =
    routeConfig.nodeType ===
      "npcs"
      ? adapter.getNearbyNpcs()
      : adapter.getNearbyLocs();

  /*
   * Match configured node pattern.
   */
  objects =
    objects.filter(
      (object: any) =>
        typeof object?.name ===
          "string" &&
        testRegex(
          routeConfig.nodePattern,
          String(
            object.name,
          ),
        ),
    );

  /*
   * Stumps are not valid woodcutting nodes.
   */
  if (
    routeConfig.nodeType ===
    "locs"
  ) {
    objects =
      objects.filter(
        (object: any) =>
          !/stump/i.test(
            String(
              object?.name ??
                "",
            ),
          ),
      );
  }

  /*
   * Filter objects to the configured scan radius around the player.
   *
   * This prevents the route from spanning an unnecessarily large
   * area when the SDK returns a wide set of nearby locations.
   */
  const playerForScan =
    adapter.getState()
      ?.player as any;

  if (
    playerForScan
  ) {
    const scanX =
      Number(
        playerForScan.worldX ??
          playerForScan.x ??
          0,
      );

    const scanZ =
      Number(
        playerForScan.worldZ ??
          playerForScan.z ??
          0,
      );

    objects =
      objects.filter(
        (object: any) => {
          const objectX =
            Number(
              object?.x ??
                object?.worldX,
            );

          const objectZ =
            Number(
              object?.z ??
                object?.worldZ,
            );

          if (
            !Number.isFinite(
              objectX,
            ) ||
            !Number.isFinite(
              objectZ,
            )
          ) {
            return false;
          }

          return (
            tileDistance(
              scanX,
              scanZ,
              objectX,
              objectZ,
            ) <=
            radius
          );
        },
      );
  }

  /*
   * Fallback SDK scanner.
   */
  if (
    objects.length ===
    0
  ) {
    try {
      const sdk =
        (adapter as any).sdk;

      if (
        routeConfig.nodeType ===
          "locs" &&
        typeof sdk?.scanNearbyLocs ===
          "function"
      ) {
        const scanned =
          await sdk.scanNearbyLocs(
            radius,
          );

        if (
          Array.isArray(
            scanned,
          )
        ) {
          objects =
            scanned.filter(
              (object: any) =>
                typeof object?.name ===
                  "string" &&
                testRegex(
                  routeConfig.nodePattern,
                  String(
                    object.name,
                  ),
                ),
            );

          objects =
            objects.filter(
              (object: any) =>
                !/stump/i.test(
                  String(
                    object?.name ??
                      "",
                  ),
                ),
            );
        }
      }
    } catch {
      /*
       * Current-state discovery remains valid.
       */
    }
  }

  /*
   * Deduplicate by world coordinate.
   */
  const unique =
    new Map<
      string,
      GatheringNode
    >();

  for (
    const object of
      objects
  ) {
    const x =
      Number(
        object?.x ??
          object?.worldX,
      );

    const z =
      Number(
        object?.z ??
          object?.worldZ,
      );

    if (
      !Number.isFinite(
        x,
      ) ||
      !Number.isFinite(
        z,
      )
    ) {
      continue;
    }

    const name =
      String(
        object?.name ??
          "",
      );

    if (
      !name
    ) {
      continue;
    }

    const key =
      `${x}:${z}`;

    if (
      !unique.has(
        key,
      )
    ) {
      unique.set(
        key,
        {
          x,
          z,
          name,
        },
      );
    }
  }

  const nodes =
    Array.from(
      unique.values(),
    );

  /*
   * Build a stable nearest-neighbour route starting at the player's
   * current location.
   */
  const player =
    adapter.getState()
      ?.player as any;

  if (
    !player
  ) {
    return nodes.slice(
      0,
      maxNodes,
    );
  }

  let currentX =
    Number(
      player.worldX ??
        player.x ??
        0,
    );

  let currentZ =
    Number(
      player.worldZ ??
        player.z ??
        0,
    );

  const remaining =
    [...nodes];

  const ordered:
    GatheringNode[] = [];

  while (
    remaining.length > 0 &&
    ordered.length <
      maxNodes
  ) {
    let bestIndex =
      -1;

    let bestDistance =
      Number.POSITIVE_INFINITY;

    for (
      let i = 0;
      i < remaining.length;
      i++
    ) {
      const candidate =
        remaining[i];

      if (
        !candidate
      ) {
        continue;
      }

      const distance =
        tileDistance(
          currentX,
          currentZ,
          candidate.x,
          candidate.z,
        );

      if (
        distance <
        bestDistance
      ) {
        bestDistance =
          distance;

        bestIndex =
          i;
      }
    }

    if (
      bestIndex <
      0
    ) {
      break;
    }

    const next =
      remaining.splice(
        bestIndex,
        1,
      )[0];

    if (
      !next
    ) {
      break;
    }

    ordered.push(
      next,
    );

    currentX =
      next.x;

    currentZ =
      next.z;
  }

  return ordered;
}

/* ================================================================
 * BANK
 * ================================================================ */

async function bankAndReset(
  adapter:
    RsSdkAdapter,

  bank:
    GatheringLocation,
): Promise<ScriptResult> {
  const player =
    adapter.getState()
      ?.player as any;

  if (
    !player
  ) {
    return {
      success:
        false,

      message:
        "Player state unavailable before banking",

      data: {
        reason:
          "state_unavailable",
      },
    };
  }

  const distance =
    tileDistance(
      Number(
        player.worldX ??
          player.x ??
          0,
      ),
      Number(
        player.worldZ ??
          player.z ??
          0,
      ),
      bank.x,
      bank.z,
    );

  if (
    distance >
    (
      bank.tolerance ??
      5
    )
  ) {
    console.log(
      `[Gathering] Returning to ${bank.name}...`,
    );

    const walk =
      await adapter.walkTo(
        bank.x,
        bank.z,
        bank.tolerance ??
          5,
      );

    if (
      !walk.success
    ) {
      return {
        success:
          false,

        message:
          `Could not reach ${bank.name}: ${walk.message}`,

        data: {
          reason:
            "bank_unreachable",
        },
      };
    }
  }

  console.log(
    `[Gathering] Opening ${bank.name}...`,
  );

  const opened =
    await adapter.openBank();

  if (
    !opened.success
  ) {
    return {
      success:
        false,

      message:
        `Could not open ${bank.name}: ${opened.message}`,

      data: {
        reason:
          "bank_open_failed",
      },
    };
  }

  const bankResult =
    await adapter.bankAll();

  if (
    !bankResult.success
  ) {
    return {
      success:
        false,

      message:
        `Banking failed: ${bankResult.message}`,

      data: {
        reason:
          "bank_failed",

        ...(bankResult.data ?? {}),
      },
    };
  }

  return {
    success:
      true,

    message:
      `Banked inventory at ${bank.name}`,

    data: {
      bank:
        bank.name,
    },
  };
}

/* ================================================================
 * EMERGENCY RETREAT
 * ================================================================ */

async function retreatToBank(
  adapter:
    RsSdkAdapter,

  bank:
    GatheringLocation,
): Promise<ScriptResult> {
  const player =
    adapter.getState()
      ?.player as any;

  if (
    !player
  ) {
    return {
      success:
        false,

      message:
        "Player state unavailable during emergency retreat",

      data: {
        reason:
          "state_unavailable",
      },
    };
  }

  console.log(
    `[Gathering] Emergency retreat -> ${bank.name} (${bank.x}, ${bank.z})`,
  );

  const walk =
    await adapter.walkTo(
      bank.x,
      bank.z,
      bank.tolerance ??
        6,
    );

  if (
    !walk.success
  ) {
    return {
      success:
        false,

      message:
        `Emergency retreat failed: ${walk.message}`,

      data: {
        reason:
          "retreat_failed",

        bank:
          bank.name,

        ...(walk.data ?? {}),
      },
    };
  }

  console.log(
    `[Gathering] Emergency retreat reached ${bank.name}.`,
  );

  /*
   * Once at the bank, try to eat if a food routine already exists.
   * We deliberately do not assume a specific food script here.
   */
  try {
    const bankOpen =
      await adapter.openBank();

    if (
      bankOpen.success
    ) {
      await adapter.closeBank();
    }
  } catch {
    /*
     * Reaching the safe point is the important part. Ignore optional
     * bank-state cleanup errors.
     */
  }

  return {
    success:
      true,

    message:
      `Emergency retreat reached ${bank.name}`,

    data: {
      reason:
        "retreated_to_bank",

      bank:
        bank.name,
    },
  };
}

/* ================================================================
 * DANGER DETECTION
 * ================================================================ */

function detectDanger(
  state:
    unknown,

  nearbyNpcs:
    any[],

  pattern?:
    RegExp,
): string | null {
  const player =
    (state as any)?.player;

  /*
   * ------------------------------------------------------------
   * COMBAT STATE
   * ------------------------------------------------------------
   *
   * Only report actual combat. Never report "none", empty strings,
   * null-like values, or placeholders as an enemy.
   */
  const combat =
    player?.combat;

  if (
    combat?.inCombat === true
  ) {
    const target =
      normaliseDangerName(
        combat.targetName ??
          combat.target ??
          combat.targetType ??
          "",
      );

    /*
     * We know the player is in combat even if the SDK does not give
     * us the target name.
     */
    return (
      target ||
      "combat"
    );
  }

  /*
   * ------------------------------------------------------------
   * NPC PATTERN
   * ------------------------------------------------------------
   */
  if (
    !pattern
  ) {
    return null;
  }

  if (
    !Array.isArray(
      nearbyNpcs,
    )
  ) {
    return null;
  }

  const playerX =
    Number(
      player?.worldX ??
        player?.x ??
        0,
    );

  const playerZ =
    Number(
      player?.worldZ ??
        player?.z ??
        0,
    );

  const maxDangerDistance =
    6;

  const dangerousNpc =
    nearbyNpcs.find(
      (npc: any) => {
        if (
          !npc ||
          typeof npc.name !==
            "string"
        ) {
          return false;
        }

        const npcName =
          normaliseDangerName(
            npc.name,
          );

        if (
          !npcName
        ) {
          return false;
        }

        if (
          !testRegex(
            pattern,
            npcName,
          )
        ) {
          return false;
        }

        const npcX =
          Number(
            npc.worldX ??
              npc.x,
          );

        const npcZ =
          Number(
            npc.worldZ ??
              npc.z,
          );

        /*
         * Missing NPC coordinates means we cannot safely decide that
         * the NPC is actually near the player.
         */
        if (
          !Number.isFinite(
            npcX,
          ) ||
          !Number.isFinite(
            npcZ,
          )
        ) {
          return false;
        }

        const distance =
          tileDistance(
            playerX,
            playerZ,
            npcX,
            npcZ,
          );

        return (
          Number.isFinite(
            distance,
          ) &&
          distance <=
            maxDangerDistance
        );
      },
    );

  if (
    !dangerousNpc
  ) {
    return null;
  }

  return normaliseDangerName(
    dangerousNpc.name,
  );
}

/* ================================================================
 * DANGER ESCAPE
 * ================================================================ */

async function escapeDanger(
  adapter:
    RsSdkAdapter,

  resource:
    GatheringLocation,

  danger:
    string,
): Promise<ScriptResult> {
  const cleanDanger =
    normaliseDangerName(
      danger,
    );

  /*
   * Never attempt a "danger escape" for placeholder values.
   */
  if (
    !cleanDanger
  ) {
    return {
      success:
        true,

      message:
        "No actual danger present",

      data: {
        reason:
          "no_danger",
      },
    };
  }

  const state =
    adapter.getState();

  const player =
    state?.player as any;

  const currentX =
    Number(
      player?.worldX ??
        player?.x ??
        resource.x,
    );

  const currentZ =
    Number(
      player?.worldZ ??
        player?.z ??
        resource.z,
    );

  /*
   * Prefer running away from the resource anchor.
   */
  const dx =
    currentX -
    resource.x;

  const dz =
    currentZ -
    resource.z;

  const length =
    Math.hypot(
      dx,
      dz,
    );

  let escapeX:
    number;

  let escapeZ:
    number;

  if (
    length >
    0
  ) {
    escapeX =
      Math.round(
        currentX +
          (
            dx /
            length
          ) *
            10,
      );

    escapeZ =
      Math.round(
        currentZ +
          (
            dz /
            length
          ) *
            10,
      );
  } else {
    /*
     * At the exact resource anchor, move south/east away from the
     * resource rather than sitting on top of it.
     */
    escapeX =
      Math.round(
        currentX +
          8,
      );

    escapeZ =
      Math.round(
        currentZ +
          8,
      );
  }

  console.log(
    `[Gathering] Escaping ${cleanDanger} from (${currentX}, ${currentZ}) to (${escapeX}, ${escapeZ})...`,
  );

  const result =
    await adapter.walkTo(
      escapeX,
      escapeZ,
      2,
    );

  if (
    !result.success
  ) {
    return {
      success:
        false,

      message:
        result.message,

      data: {
        reason:
          "danger_escape_failed",

        danger:
          cleanDanger,

        escapeX,

        escapeZ,

        ...(result.data ?? {}),
      },
    };
  }

  console.log(
    `[Gathering] Escape completed at approximately (${escapeX}, ${escapeZ}).`,
  );

  return {
    success:
      true,

    message:
      `Escaped danger: ${cleanDanger}`,

    data: {
      reason:
        "danger_escaped",

      danger:
        cleanDanger,

      escapeX,

      escapeZ,
    },
  };
}

/* ================================================================
 * HELPERS
 * ================================================================ */

function normaliseDangerName(
  value:
    unknown,
): string {
  const text =
    String(
      value ?? "",
    )
      .trim();

  if (
    !text
  ) {
    return "";
  }

  const lower =
    text.toLowerCase();

  if (
    lower === "none" ||
    lower === "null" ||
    lower === "undefined" ||
    lower === "npc" ||
    lower === "npcs" ||
    lower === "no target" ||
    lower === "no_target" ||
    lower === "no target found" ||
    lower === "unknown"
  ) {
    return "";
  }

  return text;
}

async function waitForTicksSafe(
  adapter:
    RsSdkAdapter,

  ticks:
    number,
): Promise<void> {
  const sdk =
    (adapter as any).sdk;

  if (
    sdk &&
    typeof sdk.waitForTicks ===
      "function"
  ) {
    await sdk.waitForTicks(
      ticks,
    );

    return;
  }

  await new Promise<void>(
    (
      resolve,
    ) => {
      setTimeout(
        resolve,
        Math.max(
          100,
          ticks * 600,
        ),
      );
    },
  );
}

function testRegex(
  pattern:
    RegExp,

  value:
    string,
): boolean {
  pattern.lastIndex =
    0;

  return pattern.test(
    value,
  );
}

function escapeRegex(
  value:
    string,
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}

function tileDistance(
  x1:
    number,

  z1:
    number,

  x2:
    number,

  z2:
    number,
): number {
  return Math.hypot(
    x1 - x2,
    z1 - z2,
  );
}

function failure(
  message:
    string,

  cycle:
    | number
    | undefined,

  reason:
    string,
): GatheringCycleResult {
  return {
    success:
      false,

    message,

    data: {
      ...(cycle !==
        undefined
        ? {
            cycle,
          }
        : {}),

      reason,
    },
  };
}
