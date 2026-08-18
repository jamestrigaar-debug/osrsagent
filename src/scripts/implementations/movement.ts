import { registerScript } from '../registry.js';

import type {
  ScriptContext,
  ScriptResult,
} from '../types.js';

import {
  createRsSdkAdapter,
} from '../../adapters/rs-sdk.js';

/* ================================================================
 * CHECK SKILL LEVEL
 * ================================================================ */

registerScript(
  {
    name:
      'check_skill_level',

    description:
      'Reads the current level and XP for the specified skill from the live RS-SDK game state.',

    params: {
      skill:
        'string — skill name such as fishing, woodcutting, mining',
    },

    preconditions: [
      'in_game',
    ],

    postconditions: [
      'skill_data_available',
    ],

    failureModes: [
      'skill_not_found',
      'state_unavailable',
      'sdk_connection_failed',
    ],

    category:
      'observation',

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
    const skill =
      String(
        params.skill ??
          '',
      )
        .trim()
        .toLowerCase();

    if (
      !skill
    ) {
      return {
        success:
          false,

        message:
          'Skill is required',

        data: {
          reason:
            'skill_not_found',
        },
      };
    }

    const adapter =
      createRsSdkAdapter(
        ctx,
      );

    try {
      await adapter.connect();

      const state =
        adapter.getState();

      if (
        !state
      ) {
        return {
          success:
            false,

          message:
            'Game state unavailable',

          data: {
            reason:
              'state_unavailable',

            skill,
          },
        };
      }

      /*
       * Prefer the adapter's skill helper when available.
       */
      if (
        typeof (
          adapter as any
        ).getSkill ===
        'function'
      ) {
        const skillData =
          (
            adapter as any
          ).getSkill(
            skill,
          );

        if (
          skillData
        ) {
          const level =
            Number(
              skillData.level ??
                skillData.currentLevel ??
                0,
            );

          const xp =
            Number(
              skillData.xp ??
                skillData.experience ??
                skillData.totalXp ??
                0,
            );

          if (
            Number.isFinite(
              level,
            ) &&
            level > 0
          ) {
            return {
              success:
                true,

              message:
                `${skill} level ${level}`,

              data: {
                skill,

                level,

                xp,
              },
            };
          }
        }
      }

      /*
       * Fallback to the raw SDK game state.
       */
      const skills =
        (
          state as any
        ).skills;

      if (
        skills
      ) {
        const entry =
          skills[
            skill
          ];

        if (
          entry
        ) {
          const level =
            Number(
              entry.level ??
                entry.currentLevel ??
                0,
            );

          const xp =
            Number(
              entry.xp ??
                entry.experience ??
                entry.totalXp ??
                0,
            );

          if (
            Number.isFinite(
              level,
            ) &&
            level > 0
          ) {
            return {
              success:
                true,

              message:
                `${skill} level ${level}`,

              data: {
                skill,

                level,

                xp,
              },
            };
          }
        }
      }

      return {
        success:
          false,

        message:
          `Skill "${skill}" was not found in the current game state.`,

        data: {
          reason:
            'skill_not_found',

          skill,
        },
      };
    } catch (
      error
    ) {
      return {
        success:
          false,

        message:
          `Could not read ${skill} level: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,

        data: {
          reason:
            'sdk_connection_failed',

          skill,
        },
      };
    }
  },
);

/* ================================================================
 * WALK TO
 * ================================================================ */

registerScript(
  {
    name:
      'walk_to',

    description:
      'Walks the player to world coordinates using the live RS-SDK pathfinder.',

    params: {
      location:
        'string — world coordinates as "x,z"',

      tolerance:
        'number — optional arrival tolerance in tiles',
    },

    preconditions: [
      'in_game',
    ],

    postconditions: [
      'player_at_location',
    ],

    failureModes: [
      'invalid_location',
      'path_unreachable',
      'navigation_failed',
      'danger_detected',
      'timeout',
      'sdk_connection_failed',
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
        params.location ??
          '',
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
            'invalid_location',
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

    const adapter =
      createRsSdkAdapter(
        ctx,
      );

    try {
      await adapter.connect();

      /*
       * ------------------------------------------------------------
       * CANCELLATION
       * ------------------------------------------------------------
       */
      if (
        ctx.cancelSignal?.aborted
      ) {
        return {
          success:
            false,

          message:
            'Movement cancelled before navigation started',

          data: {
            reason:
              'cancelled',
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * ALREADY THERE
       * ------------------------------------------------------------
       */
      const state =
        adapter.getState();

      const player =
        state?.player as any;

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
            `[Movement] Already at (${coordinates.x}, ${coordinates.z})`,
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

              distance,
            },
          };
        }
      }

      /*
       * ------------------------------------------------------------
       * WALK
       * ------------------------------------------------------------
       */

      console.log(
        `[Movement] Walking to (${coordinates.x}, ${coordinates.z}) with tolerance ${tolerance}`,
      );

      const result =
        await adapter.walkTo(
          coordinates.x,
          coordinates.z,
          tolerance,
        );

      /*
       * ------------------------------------------------------------
       * CANCELLATION AFTER WALK
       * ------------------------------------------------------------
       */
      if (
        ctx.cancelSignal?.aborted
      ) {
        return {
          success:
            false,

          message:
            'Movement cancelled',

          data: {
            reason:
              'cancelled',

            x:
              coordinates.x,

            z:
              coordinates.z,
          },
        };
      }

      if (
        !result.success
      ) {
        const reason =
          String(
            result.data?.reason ??
              '',
          );

        return {
          success:
            false,

          message:
            `Could not reach (${coordinates.x}, ${coordinates.z}): ${result.message}`,

          data: {
            reason:
              reason ||
              classifyMovementFailure(
                result.message,
              ),

            x:
              coordinates.x,

            z:
              coordinates.z,

            tolerance,

            ...(result.data ??
              {}),
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * VERIFY FINAL POSITION
       * ------------------------------------------------------------
       */
      const finalState =
        adapter.getState();

      const finalPlayer =
        finalState
          ?.player as any;

      if (
        finalPlayer
      ) {
        const finalX =
          Number(
            finalPlayer.worldX ??
              0,
          );

        const finalZ =
          Number(
            finalPlayer.worldZ ??
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
              `Navigation completed but player is ${finalDistance.toFixed(
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

              distance:
                finalDistance,

              tolerance,
            },
          };
        }

        console.log(
          `[Movement] Arrived at (${finalX}, ${finalZ})`,
        );

        return {
          success:
            true,

          message:
            `Reached (${coordinates.x}, ${coordinates.z})`,

          data: {
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

      /*
       * SDK reported success but did not expose final position.
       */
      return {
        success:
          true,

        message:
          `Reached (${coordinates.x}, ${coordinates.z})`,

        data: {
          x:
            coordinates.x,

          z:
            coordinates.z,

          tolerance,

          ...(result.data ??
            {}),
        },
      };
    } catch (
      error
    ) {
      return {
        success:
          false,

        message:
          `Movement failed: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,

        data: {
          reason:
            'sdk_connection_failed',

          location,

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
 * HELPERS
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

function parseTolerance(
  value:
    unknown,
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

  return 3;
}

function classifyMovementFailure(
  message:
    string,
): string {
  const lower =
    message
      .toLowerCase();

  if (
    lower.includes(
      'unreachable',
    ) ||
    lower.includes(
      'no path',
    ) ||
    lower.includes(
      'path',
    )
  ) {
    return 'path_unreachable';
  }

  if (
    lower.includes(
      'timeout',
    ) ||
    lower.includes(
      'timed out',
    )
  ) {
    return 'timeout';
  }

  if (
    lower.includes(
      'danger',
    )
  ) {
    return 'danger_detected';
  }

  return 'navigation_failed';
}
