import pino from 'pino';
import { config } from './config/index.js';

const level = config.orchestrator.logLevel || 'info';

export const logger = pino(
  {
    level,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }
);
