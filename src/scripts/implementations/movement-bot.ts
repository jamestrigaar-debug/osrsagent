import { registerScript } from '../registry.js';

import type {
  ScriptContext,
  ScriptResult,
} from '../types.js';

import {
  executeScript,
} from '../executor.js';

import {
  createRsSdkAdapter,
} from '../../adapters/rs-sdk.js';

registerScript(
  {
    name:
      'move_and_gather',

    description:
      'Travel the bot to a map location and then start the generic gathering system for woodcutting, mining, or fishing.',

    params: {
      location:
        'string — destination world coordinates as "x,z"',

      tolerance:
        'number — optional travel tolerance',

      profession:
        'string — woodcutting | mining | fishing',

      gatheringLocation:
        'string — optional registered gathering location',

      resource:
        'string — optional gathering resource',

      method:
        'string — optional fishing method',

      target:
        'string — optional fishing target',
    },

    preconditions: [
      'in_game',
    ],

    postconditions: [
      'player_at_location',
      'continuous_gathering_started',
    ],

    failureModes: [
      'invalid_location',
      'invalid_profession',
      'navigation_failed',
      'gathering_failed',
      'sdk_connection_failed',
    ],

    category:
      'movement',

    verified:
      false,

    version:
      1,
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

    const profession =
      String(
        params.profession ?? '',
      )
        .trim()
        .toLowerCase();

    if (!location) {
      return {
        success:
          false,

        message:
          'Movement destination is required',

        data: {
          reason:
            'invalid_location',
        },
      };
    }

    if (
      profession !==
        'woodcutting' &&
      profession !==
        'mining' &&
      profession !==
        'fishing'
    ) {
      return {
        success:
          false,

        message:
          `Invalid gathering profession: ${
            profession || '(missing)'
          }`,

        data: {
          reason:
            'invalid_profession',

          allowed: [
            'woodcutting',
            'mining',
            'fishing',
          ],
        },
      };
    }

    /*
     * ------------------------------------------------------------
     * SHARED ADAPTER
     * ------------------------------------------------------------
     */
    const suppliedAdapter =
      ctx.adapter as any;

    const adapter =
      suppliedAdapter &&
      typeof suppliedAdapter.connect ===
        'function' &&
      typeof suppliedAdapter.disconnect ===
        'function'
        ? suppliedAdapter
        : createRsSdkAdapter(
            ctx,
          );

    const ownsAdapter =
      !suppliedAdapter ||
      suppliedAdapter !==
        adapter;

    const sharedContext:
      ScriptContext = {
      ...ctx,

      adapter,
    };

    try {
      await adapter.connect();

      /*
       * ------------------------------------------------------------
       * TRAVEL
       * ------------------------------------------------------------
       */
      console.log(
        `[MovementBot] Travelling to ${location}...`,
      );

      const travelResult =
        await executeScript(
          'travel_to',
          {
            location,

            tolerance:
              params.tolerance,

            announce:
              true,

            message:
              'travel completed',
          },
          sharedContext,
        );

      if (
        !travelResult.success
      ) {
        return {
          success:
            false,

          message:
            `Travel failed: ${travelResult.message}`,

          data: {
            reason:
              'navigation_failed',

            ...(travelResult.data ??
              {}),
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * GATHER
       * ------------------------------------------------------------
       */
      console.log(
        `[MovementBot] Travel complete. Starting ${profession} gathering...`,
      );

      const gatherParams:
        Record<string, unknown> = {
        profession,
      };

      if (
        params.gatheringLocation !==
        undefined
      ) {
        gatherParams.location =
          String(
            params.gatheringLocation,
          );
      }

      if (
        params.resource !==
        undefined
      ) {
        gatherParams.resource =
          String(
            params.resource,
          );
      }

      if (
        params.method !==
        undefined
      ) {
        gatherParams.method =
          String(
            params.method,
          );
      }

      if (
        params.target !==
        undefined
      ) {
        gatherParams.target =
          String(
            params.target,
          );
      }

      const gatherResult =
        await executeScript(
          'gather',
          gatherParams,
          sharedContext,
        );

      if (
        !gatherResult.success
      ) {
        return {
          success:
            false,

          message:
            `Gathering failed: ${gatherResult.message}`,

          data: {
            reason:
              'gathering_failed',

            ...(gatherResult.data ??
              {}),
          },
        };
      }

      return {
        success:
          true,

        message:
          `Travel completed and ${profession} gathering started.`,

        data: {
          destination:
            location,

          profession,

          travel:
            travelResult.data,

          gathering:
            gatherResult.data,
        },
      };
    } catch (
      error
    ) {
      return {
        success:
          false,

        message:
          `Movement bot failed: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,

        data: {
          reason:
            'sdk_connection_failed',
        },
      };
    } finally {
      if (
        ownsAdapter
      ) {
        await adapter.disconnect();
      }
    }
  },
);
