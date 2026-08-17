#!/usr/bin/env node

import { Command } from 'commander';
import { Orchestrator } from './orchestrator/index.js';
import { loadMemory, listAccounts } from './memory/store.js';
import { flagUserRequest } from './dispatcher/escalation.js';
import { getAllManifests } from './scripts/index.js';
import { logger } from './logger.js';
import { config } from './config/index.js';

// Ensure scripts are registered by importing the index
import './scripts/index.js';

const program = new Command();

program
  .name('osrs-ai-agent')
  .description('Two-tier AI Agent (Planner/Dispatcher) for OSRS automation')
  .version('2.0.0');

/**
 * start — Start the full orchestrator loop with optional goal
 */
program
  .command('start')
  .description('Start the Planner/Dispatcher orchestrator')
  .option('-b, --bot <name>', 'Bot name', config.bot.name)
  .option('-g, --goal <goal>', 'Initial goal (e.g. "reach fishing level 20")')
  .option('-i, --interval <ms>', 'Dispatcher tick interval in ms', '500')
  .option('--no-dashboard', 'Disable the local dashboard')
  .action((options) => {
    const orchestrator = new Orchestrator({
      dispatchInterval: parseInt(options.interval),
      dashboardPort: options.dashboard ? config.orchestrator.dashboardPort : 0,
    });

    orchestrator.start(options.bot, options.goal);

    process.on('SIGINT', () => {
      logger.info('Shutting down...');
      orchestrator.stop();
      process.exit(0);
    });
  });

/**
 * goal — Inject a goal for a running account
 */
program
  .command('goal <accountId> <goal>')
  .description('Inject a goal into a running account\'s Memory')
  .action((accountId: string, goal: string) => {
    flagUserRequest(accountId, goal);
    console.log(`Goal injected for ${accountId}: ${goal}`);
  });

/**
 * status — Display Memory state for an account
 */
program
  .command('status [accountId]')
  .description('Display the current Memory state')
  .action((accountId?: string) => {
    const id = accountId || config.bot.name;
    const memory = loadMemory(id);
    console.log(JSON.stringify(memory, null, 2));
  });

/**
 * list — Show all accounts in the Memory store
 */
program
  .command('list')
  .description('List all accounts in the Memory store')
  .action(() => {
    const accounts = listAccounts();
    if (accounts.length === 0) {
      console.log('No accounts found in memory store.');
    } else {
      accounts.forEach(a => console.log(`- ${a}`));
    }
  });

/**
 * scripts — List all registered scripts and their manifests
 */
program
  .command('scripts')
  .description('List all registered script manifests')
  .action(() => {
    const manifests = getAllManifests();
    console.log(JSON.stringify(manifests, null, 2));
  });

program.parse(process.argv);
