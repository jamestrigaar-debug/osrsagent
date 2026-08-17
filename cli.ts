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

/*
 * Ensure every script implementation is registered.
 */
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
          `Invalid dispatcher interval: ${options.interval}`,
        );

        process.exitCode =
          1;

        return;
      }

      const orchestrator =
        new Orchestrator({
          dispatchInterval:
            interval,

          dashboardPort:
            options.dashboard
              ? config.orchestrator.dashboardPort
              : 0,
        });

      let shuttingDown =
        false;

      /*
       * Explicitly keep stdin active. This guarantees the CLI
       * process remains alive while the orchestrator is running.
       */
      process.stdin.resume();

      const shutdown =
        () => {
          if (
            shuttingDown
          ) {
            return;
          }

          shuttingDown =
            true;

          logger.info(
            'Shutting down...',
          );

          try {
            orchestrator.stop();
          } finally {
            process.stdin.pause();

            process.exit(
              0,
            );
          }
        };

      process.once(
        'SIGINT',
        shutdown,
      );

      process.once(
        'SIGTERM',
        shutdown,
      );

      try {
        orchestrator.start(
          options.bot,
          options.goal,
        );

        logger.info(
          {
            bot:
              options.bot,

            goal:
              options.goal ??
              null,

            interval,
          },
          'CLI: orchestrator is running',
        );
      } catch (
        error
      ) {
        logger.error(
          {
            err:
              error,
          },
          'Failed to start orchestrator',
        );

        orchestrator.stop();

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
    'Inject a goal into a running account Memory',
  )
  .action(
    (
      accountId:
        string,

      goal:
        string,
    ) => {
      flagUserRequest(
        accountId,
        goal,
      );

      console.log(
        `Goal injected for ${accountId}: ${goal}`,
      );
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
    'Display the current Memory state',
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
 * LIST ACCOUNTS
 * ================================================================ */

program
  .command(
    'list',
  )
  .description(
    'List all accounts in the Memory store',
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
    'List all registered script manifests',
  )
  .action(
    () => {
      const manifests =
        getAllManifests();

      console.log(
        JSON.stringify(
          manifests,
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
