#!/usr/bin/env node

import { Command } from 'commander';

import {
  Orchestrator,
} from './orchestrator/index.js';

import {
  loadMemory,
  listAccounts,
} from './memory/store.js';

import {
  flagUserRequest,
} from './dispatcher/escalation.js';

import {
  getAllManifests,
} from './scripts/index.js';

import {
  logger,
} from './logger.js';

import {
  config,
} from './config/index.js';

import './scripts/index.js';

const program =
  new Command();

program
  .name(
    'osrs-ai-agent',
  )
  .description(
    'Two-tier AI Agent (Planner/Dispatcher) for OSRS automation',
  )
  .version(
    '2.0.0',
  );

/* ================================================================
 * START
 * ================================================================ */

program
  .command(
    'start',
  )
  .description(
    'Start the Planner/Dispatcher orchestrator',
  )
  .option(
    '-b, --bot <name>',
    'Bot name',
    config.bot.name,
  )
  .option(
    '-g, --goal <goal>',
    'Initial goal',
  )
  .option(
    '-i, --interval <ms>',
    'Dispatcher tick interval in ms',
    '500',
  )
  .option(
    '--no-dashboard',
    'Disable the local dashboard',
  )
  .action(
    (
      options: {
        bot: string;
        goal?: string;
        interval: string;
        dashboard: boolean;
      },
    ) => {
      console.log(
        '[CLI] start command entered',
      );

      const interval =
        Number.parseInt(
          options.interval,
          10,
        );

      if (
        !Number.isFinite(
          interval,
        ) ||
        interval <= 0
      ) {
        console.error(
          `[CLI] Invalid interval: ${options.interval}`,
        );

        process.exitCode =
          1;

        return;
      }

      let orchestrator:
        Orchestrator;

      try {
        console.log(
          '[CLI] Constructing Orchestrator...',
        );

        orchestrator =
          new Orchestrator({
            dispatchInterval:
              interval,

            dashboardPort:
              options.dashboard
                ? config.orchestrator
                    .dashboardPort
                : 0,
          });

        console.log(
          '[CLI] Orchestrator constructed.',
        );

        /*
         * Keep Node alive explicitly.
         *
         * stdin.resume() worked reliably with this project before
         * and is retained alongside a heartbeat timer.
         */
        process.stdin.resume();

        const keepAlive =
          setInterval(
            () => {
              console.log(
                `[CLI] heartbeat ${new Date().toISOString()}`,
              );
            },
            5000,
          );

        let shuttingDown =
          false;

        const shutdown =
          () => {
            if (
              shuttingDown
            ) {
              return;
            }

            shuttingDown =
              true;

            clearInterval(
              keepAlive,
            );

            logger.info(
              'Shutting down...',
            );

            try {
              orchestrator.stop();
            } catch (
              error
            ) {
              console.error(
                '[CLI] Error stopping orchestrator:',
                error,
              );
            }

            process.stdin.pause();

            process.exit(
              0,
            );
          };

        process.once(
          'SIGINT',
          shutdown,
        );

        process.once(
          'SIGTERM',
          shutdown,
        );

        /*
         * Catch unexpected process-level errors.
         */
        process.on(
          'uncaughtException',
          (
            error,
          ) => {
            console.error(
              '[CLI] uncaughtException:',
              error,
            );
          },
        );

        process.on(
          'unhandledRejection',
          (
            reason,
          ) => {
            console.error(
              '[CLI] unhandledRejection:',
              reason,
            );
          },
        );

        console.log(
          '[CLI] Calling orchestrator.start()...',
        );

        orchestrator.start(
          options.bot,
          options.goal,
        );

        console.log(
          '[CLI] Orchestrator.start() returned.',
        );

        console.log(
          `[CLI] Bot: ${options.bot}`,
        );

        console.log(
          `[CLI] Interval: ${interval}ms`,
        );

        console.log(
          `[CLI] Goal: ${
            options.goal ??
            '(none)'
          }`,
        );

        console.log(
          '[CLI] Process should remain running. Press Ctrl+C to stop.',
        );
      } catch (
        error
      ) {
        console.error(
          '[CLI] START FAILED:',
          error,
        );

        process.exitCode =
          1;
      }
    },
  );

/* ================================================================
 * GOAL
 * ================================================================ */

program
  .command(
    'goal <accountId> <goal>',
  )
  .description(
    'Inject a goal into a running account',
  )
  .action(
    (
      accountId:
        string,

      goal:
        string,
    ) => {
      try {
        flagUserRequest(
          accountId,
          goal,
        );

        console.log(
          `Goal injected for ${accountId}: ${goal}`,
        );
      } catch (
        error
      ) {
        console.error(
          '[CLI] Goal injection failed:',
          error,
        );

        process.exitCode =
          1;
      }
    },
  );

/* ================================================================
 * STATUS
 * ================================================================ */

program
  .command(
    'status [accountId]',
  )
  .description(
    'Display current Memory state',
  )
  .action(
    (
      accountId?:
        string,
    ) => {
      const id =
        accountId ??
        config.bot.name;

      const memory =
        loadMemory(
          id,
        );

      console.log(
        JSON.stringify(
          memory,
          null,
          2,
        ),
      );
    },
  );

/* ================================================================
 * LIST
 * ================================================================ */

program
  .command(
    'list',
  )
  .description(
    'List all accounts',
  )
  .action(
    () => {
      const accounts =
        listAccounts();

      if (
        accounts.length ===
        0
      ) {
        console.log(
          'No accounts found in memory store.',
        );

        return;
      }

      for (
        const account of
          accounts
      ) {
        console.log(
          `- ${account}`,
        );
      }
    },
  );

/* ================================================================
 * SCRIPTS
 * ================================================================ */

program
  .command(
    'scripts',
  )
  .description(
    'List all registered scripts',
  )
  .action(
    () => {
      console.log(
        JSON.stringify(
          getAllManifests(),
          null,
          2,
        ),
      );
    },
  );

/* ================================================================
 * PARSE
 * ================================================================ */

program.parse(
  process.argv,
);
