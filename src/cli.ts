#!/usr/bin/env node

import { Command } from 'commander';
import { AgentManager } from './controller/manager.js';
import { logger } from './logger.js';
import { config } from './config/index.js';

const program = new Command();

program
  .name('osrs-ai-agent')
  .description('AI Agent framework for OSRS automation on rs-sdk')
  .version('1.0.0');

/**
 * Agent command - Run the AI agent
 */
program
  .command('agent')
  .description('Start the AI agent')
  .option('-b, --bot <name>', 'Bot name', config.bot.name)
  .option('-p, --password <password>', 'Bot password', config.bot.password)
  .action(async (options) => {
    logger.info({ bot: options.bot }, 'Starting AI Agent');

    const manager = new AgentManager(options.bot, options.password);
    await manager.start();

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      logger.info('Shutting down...');
      manager.stop();
      process.exit(0);
    });
  });

/**
 * Monitor command - Display agent stats
 */
program
  .command('monitor')
  .description('Monitor agent statistics')
  .option('-b, --bot <name>', 'Bot name', config.bot.name)
  .option('-p, --password <password>', 'Bot password', config.bot.password)
  .action((options) => {
    logger.info({ bot: options.bot }, 'Starting monitoring');
    logger.info(
      {
        viewerUrl: config.bot.viewerUrl,
      },
      'Open this URL to view the bot'
    );

    const manager = new AgentManager(options.bot, options.password);
    const session = manager.getSession();

    // Display session info
    console.log('\n=== Agent Session ===');
    console.log(`Session ID: ${session.id}`);
    console.log(`Bot: ${session.botName}`);
    console.log(`Viewer: ${session.viewerUrl}`);
    console.log(`Started: ${session.startTime}`);
    console.log('\nPress Ctrl+C to exit\n');

    // Update stats every 5 seconds
    setInterval(() => {
      const stats = session.stats;
      console.clear();
      console.log('\n=== Agent Statistics ===');
      console.log(`Decisions: ${stats.decisionsCount}`);
      console.log(`Successful Actions: ${stats.successfulActions}`);
      console.log(`Failed Actions: ${stats.failedActions}`);
      if (stats.lastAction) {
        console.log(`Last Action: ${stats.lastAction.type}`);
        console.log(`Last Action Time: ${stats.lastActionTime}`);
      }
      console.log('\nViewer: ' + session.viewerUrl);
      console.log('\nPress Ctrl+C to exit\n');
    }, 5000);
  });

/**
 * List command - Show available bots
 */
program
  .command('list')
  .description('List available bot instances')
  .action(() => {
    logger.info('Available bots:');
    console.log(`\n- ${config.bot.name}`);
    console.log(`  Password: ${config.bot.password}`);
    console.log(`  Viewer: ${config.bot.viewerUrl}\n`);
  });

program.parse(process.argv);
