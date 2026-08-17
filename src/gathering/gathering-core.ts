import "../scripts/index.js";

import {
  RsSdkAdapter,
} from "../adapters/rs-sdk.js";

import {
  executeScript,
} from "../scripts/executor.js";

import type {
  ScriptContext,
  ScriptResult,
} from "../scripts/types.js";

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
   * Reuse a shared adapter supplied by the caller.
   * Otherwise create one here.
   */
  const suppliedAdapter =
    ctx.adapter as any;

  const adapter =
    suppliedAdapter &&
    typeof suppliedAdapter.connect ===
      "function" &&
    typeof suppliedAdapter.disconnect ===
      "function" &&
    typeof suppliedAdapter.getState ===
      "function"
      ? suppliedAdapter as RsSdkAdapter
      : new RsSdkAdapter({
          server:
            ctx.sdkBaseUrl,

          botName:
            ctx.sdkBotName,

          password:
            ctx.sdkBotPassword,
        });

  /*
   * All child scripts receive the same live adapter.
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

  const hpStopPercent =
    config.hpStopPercent ??
    0.50;

  /*
   * Persistent route.
   *
   * It survives banking. It is rebuilt only after enough consecutive
   * node failures.
   */
  let nodeRoute:
    GatheringNode[] = [];

  let routeIndex = 0;

  let nodeMisses = 0;

  const rebuildAfterMisses =
    Math.max(
      1,
      config.nodeRoute?.rebuildAfterMisses ??
        3,
    );

  let cycle = 1;

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
        return {
          success: false,

          message:
            `HP below gathering threshold: ${hp}/${maxHp}`,

          data: {
            cycle,

            action:
              "recover_hp",

            hp,

            maxHp,

            reason:
              "low_hp",
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * DANGER
       * ------------------------------------------------------------
       */
      const danger =
        detectDanger(
          state,
          adapter.getNearbyNpcs(),
          config.dangerousNpcPattern,
        );

      if (danger) {
        return {
          success: false,

          message:
            `Danger detected: ${danger}`,

          data: {
            cycle,

            action:
              "escape_danger",

            npc:
              danger,

            reason:
              "danger_detected",
          },
        };
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
            success: false,

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

        /*
         * Keep the route if it is still valid.
         * We do not automatically rebuild simply because we banked.
         */
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
          success: false,

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
          success: false,

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
        GatheringNode | undefined;

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
           *
           * This is essential after banking or after stale node
           * failures. The player may be standing at the bank, where
           * resource nodes do not exist.
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
                success: false,

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

          /*
           * Let the live world state update after arrival.
           */
          await waitForTicksSafe(
            adapter,
            2,
          );

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

          /*
           * Retry once after a short state-refresh delay.
           */
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
              success: false,

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
         * Walk to the saved node.
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
              success: false,

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
       * DANGER AFTER TRAVEL
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
        return {
          success: false,

          message:
            `Danger detected at resource area: ${travelDanger}`,

          data: {
            cycle,

            action:
              "escape_danger",

            npc:
              travelDanger,

            reason:
              "danger_detected",
          },
        };
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
          );

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

          /*
           * Do not advance the route here.
           * The next loop iteration will bank.
           */
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
              "timeout" ||
            /timed out/i.test(
              gatherResult.message,
            )
          )
        ) {
          nodeMisses++;

          console.log(
            `[Gathering] Saved node unavailable or timed out. ` +
            `Skipping node. Miss ${nodeMisses}/${rebuildAfterMisses}.`,
          );

          if (
            currentNode
          ) {
            console.log(
              `[Gathering] Skipping ${currentNode.name} ` +
              `(${currentNode.x}, ${currentNode.z}).`,
            );
          }

          routeIndex++;

          /*
           * Rebuild will occur on the next cycle if the miss
           * threshold has been reached. The rebuild code will first
           * travel back to config.resource before scanning.
           */
          continue;
        }

        /*
         * ----------------------------------------------------------
         * OTHER FAILURE
         * ----------------------------------------------------------
         */
        else {
          return {
            success: false,

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

        /*
         * A successful node clears consecutive node failures.
         */
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
          return {
            success: false,

            message:
              `HP dropped below threshold after gathering: ${afterHp}/${afterMaxHp}`,

            data: {
              cycle,

              action:
                "recover_hp",

              hp:
                afterHp,

              maxHp:
                afterMaxHp,

              reason:
                "low_hp",
            },
          };
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
            success: false,

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
      }

      console.log(
        `[Gathering] Cycle ${cycle} complete. Continuing...`,
      );

      cycle++;
    }

    /*
     * --------------------------------------------------------------
     * FINISHED
     * --------------------------------------------------------------
     */
    return {
      success: true,

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
  } catch (error) {
    return failure(
      error instanceof Error
        ? error.message
        : String(error),
      undefined,
      "exception",
    );
  } finally {
    /*
     * Only disconnect an adapter created by this core.
     *
     * A shared adapter belongs to the caller.
     */
    if (
      !suppliedAdapter ||
      suppliedAdapter !== adapter
    ) {
      await adapter.disconnect();
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

    if (!axe) {
      return {
        success: false,

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
      success: true,

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

    if (!pickaxe) {
      return {
        success: false,

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
      success: true,

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

  if (!fishingTool) {
    return {
      success: false,

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
    success: true,

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
  method: string,
): {
  source: string;
  regex: RegExp;
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
        15,
    );

  const maxNodes =
    Math.max(
      1,
      routeConfig.maxNodes ??
        12,
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
              object?.name ?? "",
            ),
          ),
      );
  }

  /*
   * If the current state does not contain matching locations,
   * try the optional SDK location scanner.
   *
   * Fishing uses NPC state directly.
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
    const object of objects
  ) {
    const x =
      Number(
        object?.x,
      );

    const z =
      Number(
        object?.z,
      );

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(z)
    ) {
      continue;
    }

    const name =
      String(
        object?.name ??
          "",
      );

    if (!name) {
      continue;
    }

    const key =
      `${x}:${z}`;

    if (
      !unique.has(key)
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

  if (!player) {
    return nodes.slice(
      0,
      maxNodes,
    );
  }

  let currentX =
    Number(
      player.worldX ?? 0,
    );

  let currentZ =
    Number(
      player.worldZ ?? 0,
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

      if (!candidate) {
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

    if (!next) {
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

  if (!player) {
    return {
      success: false,

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
        player.worldX ?? 0,
      ),
      Number(
        player.worldZ ?? 0,
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
 * DANGER
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

  if (
    player?.combat?.inCombat
  ) {
    return (
      player.combat.targetType ??
      "combat"
    );
  }

  if (!pattern) {
    return null;
  }

  const dangerousNpc =
    nearbyNpcs.find(
      (npc: any) =>
        testRegex(
          pattern,
          String(
            npc?.name ?? "",
          ),
        ),
    );

  return dangerousNpc
    ? String(
        dangerousNpc.name,
      )
    : null;
}

/* ================================================================
 * HELPERS
 * ================================================================ */

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
  }
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
