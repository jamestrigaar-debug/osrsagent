import { registerScript } from '../registry.js';

import type {
  ScriptContext,
  ScriptResult,
} from '../types.js';

import {
  createRsSdkAdapter,
} from '../../adapters/rs-sdk.js';

registerScript(
  {
    name:
      'travel_to',

    description:
      'Travel to world coordinates using the RS-SDK pathfinder. Supports optional destination requirements and can announce arrival in chat.',

    params: {
      location:
        'string — world coordinates as "x,z"',

      tolerance:
        'number — optional arrival tolerance in tiles (default 3)',

      announce:
        'boolean — optional, announce arrival in chat (default true)',

      message:
        'string — optional arrival announcement',

      requiresCoins:
        'number — optional minimum coins required before travel',

      requiresPassage:
        'boolean — optional, destination requires a special passage or gate',

      passageName:
        'string — optional name of the passage/gate requirement',
    },

    preconditions: [
      'in_game',
    ],

    postconditions: [
      'player_at_location',
    ],

    failureModes: [
      'location_missing',
      'invalid_location',
      'insufficient_coins',
      'passage_required',
      'navigation_failed',
      'chat_send_failed',
      'sdk_connection_failed',
      'timeout',
    ],

    category:
      'movement',

    verified:
      true,

    version:
      2,
  },

  async (
    params:
      Record<string, unknown>,

    ctx:
      ScriptContext,
  ): Promise<ScriptResult> => {
    const location =
      String(
        params.location ?? '',
      ).trim();

    if (
      !location
    ) {
      return {
        success:
          false,

        message:
          'Location is required',

        data: {
          reason:
            'location_missing',
        },
      };
    }

    const coordinates =
      parseCoordinates(
        location,
      );

    if (
      !coordinates
    ) {
      return {
        success:
          false,

        message:
          `Invalid location "${location}". Expected "x,z".`,

        data: {
          reason:
            'invalid_location',

          location,
        },
      };
    }

    const tolerance =
      parseTolerance(
        params.tolerance,
      );

    const announce =
      params.announce ===
      undefined
        ? true
        : parseBoolean(
            params.announce,
          );

    const message =
      String(
        params.message ??
          'travel completed',
      ).trim();

    const requiresCoins =
      parseNonNegativeNumber(
        params.requiresCoins,
        0,
      );

    const requiresPassage =
      parseBoolean(
        params.requiresPassage,
      );

    const passageName =
      String(
        params.passageName ??
          'required passage',
      ).trim();

    const adapter =
      createRsSdkAdapter(
        ctx,
      );

    try {
      await adapter.connect();

      /*
       * ------------------------------------------------------------
       * DESTINATION REQUIREMENTS
       * ------------------------------------------------------------
       */

      if (
        requiresCoins >
        0
      ) {
        const coins =
          adapter.getCoins();

        if (
          coins <
          requiresCoins
        ) {
          return {
            success:
              false,

            message:
              `Insufficient coins for travel. Required ${requiresCoins}, have ${coins}.`,

            data: {
              reason:
                'insufficient_coins',

              requiredCoins:
                requiresCoins,

              coins,
            },
          };
        }

        console.log(
          `[Travel] Coin requirement satisfied: ${coins} coins available.`,
        );
      }

      /*
       * We deliberately do not blindly walk through special
       * passages. The passage must be handled by an explicit
       * preparation script/step in the plan.
       *
       * This prevents the pathfinder from repeatedly attempting to
       * route through a paid or gated area.
       */
      if (
        requiresPassage
      ) {
        return {
          success:
            false,

          message:
            `Destination requires ${passageName}. Add a passage preparation step before travel.`,

          data: {
            reason:
              'passage_required',

            passage:
              passageName,

            x:
              coordinates.x,

            z:
              coordinates.z,
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * CHECK WHETHER WE ARE ALREADY THERE
       * ------------------------------------------------------------
       */

      const currentState =
        adapter.getState();

      const player =
        currentState?.player as any;

      if (
        player
      ) {
        const currentX =
          Number(
            player.worldX ??
              0,
          );

        const currentZ =
          Number(
            player.worldZ ??
              0,
          );

        const distance =
          Math.hypot(
            currentX -
              coordinates.x,
            currentZ -
              coordinates.z,
          );

        if (
          Number.isFinite(
            distance,
          ) &&
          distance <=
            tolerance
        ) {
          console.log(
            `[Travel] Already at (${coordinates.x}, ${coordinates.z}) within tolerance ${tolerance}.`,
          );

          await announceArrival(
            adapter,
            announce,
            message,
          );

          return {
            success:
              true,

            message:
              `Already at (${coordinates.x}, ${coordinates.z})`,

            data: {
              x:
                coordinates.x,

              z:
                coordinates.z,

              tolerance,

              alreadyThere:
                true,

              announced:
                announce &&
                message
                  ? message
                  : null,
            },
          };
        }
      }

      /*
       * ------------------------------------------------------------
       * TRAVEL
       * ------------------------------------------------------------
       */

      console.log(
        `[Travel] Walking to (${coordinates.x}, ${coordinates.z}) with tolerance ${tolerance}`,
      );

      const walkResult =
        await adapter.walkTo(
          coordinates.x,
          coordinates.z,
          tolerance,
        );

      if (
        !walkResult.success
      ) {
        return {
          success:
            false,

          message:
            `Navigation failed: ${walkResult.message}`,

          data: {
            reason:
              'navigation_failed',

            x:
              coordinates.x,

            z:
              coordinates.z,

            tolerance,

            ...(walkResult.data ??
              {}),
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * VERIFY ARRIVAL
       * ------------------------------------------------------------
       */

      const afterState =
        adapter.getState();

      const afterPlayer =
        afterState?.player as any;

      if (
        afterPlayer
      ) {
        const finalX =
          Number(
            afterPlayer.worldX ??
              0,
          );

        const finalZ =
          Number(
            afterPlayer.worldZ ??
              0,
          );

        const finalDistance =
          Math.hypot(
            finalX -
              coordinates.x,
            finalZ -
              coordinates.z,
          );

        if (
          Number.isFinite(
            finalDistance,
          ) &&
          finalDistance >
            tolerance
        ) {
          return {
            success:
              false,

            message:
              `Pathfinder completed but player is still ${finalDistance.toFixed(
                1,
              )} tiles from destination.`,

            data: {
              reason:
                'navigation_failed',

              x:
                coordinates.x,

              z:
                coordinates.z,

              finalX,

              finalZ,

              tolerance,

              distance:
                finalDistance,
            },
          };
        }
      }

      console.log(
        `[Travel] Arrived at (${coordinates.x}, ${coordinates.z})`,
      );

      /*
       * ------------------------------------------------------------
       * CHAT ANNOUNCEMENT
       * ------------------------------------------------------------
       */

      const chatAnnouncement =
        await announceArrival(
          adapter,
          announce,
          message,
        );

      return {
        success:
          true,

        message:
          chatAnnouncement.failed
            ? `Reached (${coordinates.x}, ${coordinates.z}) but chat announcement failed.`
            : `Reached (${coordinates.x}, ${coordinates.z})`,

        data: {
          x:
            coordinates.x,

          z:
            coordinates.z,

          tolerance,

          announced:
            announce &&
            message
              ? message
              : null,

          chatSendFailed:
            chatAnnouncement.failed,
        },
      };
    } catch (
      error
    ) {
      return {
        success:
          false,

        message:
          `Travel failed: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,

        data: {
          reason:
            'sdk_connection_failed',

          x:
            coordinates.x,

          z:
            coordinates.z,
        },
      };
    }
  },
);

/* ================================================================
 * CHAT
 * ================================================================ */

async function announceArrival(
  adapter:
    any,

  announce:
    boolean,

  message:
    string,
): Promise<{
  failed: boolean;
}> {
  if (
    !announce ||
    !message
  ) {
    return {
      failed:
        false,
    };
  }

  try {
    /*
     * Prefer the adapter abstraction when available.
     */
    if (
      typeof adapter.say ===
      'function'
    ) {
      const result =
        await adapter.say(
          message,
        );

      if (
        !result.success
      ) {
        console.log(
          `[Travel] Chat announcement failed: ${result.message}`,
        );

        return {
          failed:
            true,
        };
      }

      console.log(
        `[Travel] Announced: "${message}"`,
      );

      return {
        failed:
          false,
      };
    }

    /*
     * Compatibility fallback for older adapters.
     */
    const sdk =
      adapter?.sdk;

    if (
      sdk &&
      typeof sdk.sendSay ===
        'function'
    ) {
      const result =
        await sdk.sendSay(
          message,
        );

      if (
        result &&
        result.success ===
          false
      ) {
        console.log(
          `[Travel] Chat announcement failed: ${
            result.message ??
            'unknown error'
          }`,
        );

        return {
          failed:
            true,
        };
      }

      console.log(
        `[Travel] Announced: "${message}"`,
      );

      return {
        failed:
          false,
      };
    }

    console.log(
      '[Travel] Chat announcement unavailable.',
    );

    return {
      failed:
        true,
    };
  } catch (
    error
  ) {
    console.log(
      `[Travel] Chat announcement error: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );

    return {
      failed:
        true,
    };
  }
}

/* ================================================================
 * COORDINATE PARSING
 * ================================================================ */

function parseCoordinates(
  value:
    string,
): {
  x: number;
  z: number;
} | null {
  const match =
    value.match(
      /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/,
    );

  if (
    !match
  ) {
    return null;
  }

  const x =
    Number(
      match[1],
    );

  const z =
    Number(
      match[2],
    );

  if (
    !Number.isFinite(
      x,
    ) ||
    !Number.isFinite(
      z,
    )
  ) {
    return null;
  }

  return {
    x,
    z,
  };
}

/* ================================================================
 * PARAMETER PARSING
 * ================================================================ */

function parseTolerance(
  value:
    unknown,
): number {
  return parseNonNegativeNumber(
    value,
    3,
  );
}

function parseNonNegativeNumber(
  value:
    unknown,

  fallback:
    number,
): number {
  if (
    typeof value ===
      'number' &&
    Number.isFinite(
      value,
    ) &&
    value >= 0
  ) {
    return value;
  }

  if (
    typeof value ===
      'string'
  ) {
    const parsed =
      Number(
        value,
      );

    if (
      Number.isFinite(
        parsed,
      ) &&
      parsed >= 0
    ) {
      return parsed;
    }
  }

  return fallback;
}

function parseBoolean(
  value:
    unknown,
): boolean {
  if (
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (
    typeof value ===
      'string'
  ) {
    const normalized =
      value
        .trim()
        .toLowerCase();

    if (
      normalized ===
        'true' ||
      normalized ===
        'yes' ||
      normalized ===
        '1'
    ) {
      return true;
    }

    if (
      normalized ===
        'false' ||
      normalized ===
        'no' ||
      normalized ===
        '0'
    ) {
      return false;
    }
  }

  return false;
}
