import {
  runGatheringCore,
} from "./gathering-core.js";

import type {
  ScriptContext,
} from "../scripts/types.js";

export async function runWoodcuttingTask(
  ctx: ScriptContext,
  options: {
    bankX: number;
    bankZ: number;

    resourceX: number;
    resourceZ: number;

    resource?: string;

    inventoryThreshold?: number;
  },
) {
  const resource =
    options.resource ??
    "tree";

  return runGatheringCore(
    {
      profession:
        "woodcutting",

      taskName:
        `Woodcutting — ${resource}`,

      bank: {
        name:
          "Woodcutting Bank",

        x:
          options.bankX,

        z:
          options.bankZ,

        tolerance:
          5,
      },

      resource: {
        name:
          `${resource} area`,

        x:
          options.resourceX,

        z:
          options.resourceZ,

        tolerance:
          5,
      },

      prepareScript:
        "ensure_woodcutting_tool",

      prepareParams: {
        location:
          "woodcutting-task",
      },

      gatherScript:
        "gather_wood",

      gatherParams: {
        location:
          "woodcutting-task",

        resource,
      },

      inventoryThreshold:
        options.inventoryThreshold ??
        26,

      /*
       * Woodcutting resources are world objects/locations.
       */
      nodeRoute: {
        enabled:
          true,

        nodeType:
          "locs",

        scanRadius:
          15,

        maxNodes:
          12,

        nodePattern:
          resource.toLowerCase() ===
            "tree"
            ? /^(tree|normal tree)$/i
            : new RegExp(
                `^${escapeRegex(resource)}$`,
                "i",
              ),

        rebuildAfterMisses:
          3,
      },

      hpStopPercent:
        0.50,

      maxCycles:
        0,
    },

    ctx,
  );
}

function escapeRegex(
  value: string,
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}
