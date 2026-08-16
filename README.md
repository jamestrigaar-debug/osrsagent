# OSRS AI Agent Framework

A TypeScript framework for managing and monitoring AI agents playing Old School RuneScape (OSRS) on the [rs-sdk](https://github.com/MaxBittker/rs-sdk) automation server.

## Features

- 🤖 **AI-Powered Decisions**: Integrates with OpenAI, Anthropic, or custom AI providers
- 🎮 **rs-sdk Integration**: Seamless communication with the rs-sdk client
- 📊 **Real-time Monitoring**: Track agent statistics and game state
- 🎯 **Action Framework**: Extensible action system (movement, interaction, skills, banking)
- 🔧 **Easy Configuration**: Environment-based config with sensible defaults
- 📝 **TypeScript**: Full type safety and IDE support

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- AI API key (OpenAI or Anthropic)

### Installation

```bash
npm install
```

### Configuration

1. Copy `.env.example` to `.env`
2. Set your AI API key:

```env
AI_PROVIDER=openai  # or 'anthropic'
AI_API_KEY=your_key_here
BOT_NAME=trigaarbot8
BOT_PASSWORD=your_password
```

### Running the Agent

```bash
# Start the AI agent
npm run agent

# Monitor agent statistics
npm run monitor

# List available bots
npm run list
```

## Architecture

```
┌─────────────────┐
│   AI Provider   │ (OpenAI, Anthropic)
│   (GPT-4, etc)  │
└────────┬────────┘
         │
    ┌────▼────────────┐
    │   AI Agent      │ Decision Making
    │  (Decision Loop)│
    └────┬────────────┘
         │
    ┌────▼──────────────┐
    │ Agent Manager     │ Execution & State
    │ (Coordination)    │
    └────┬──────────────┘
         │
    ┌────▼───���──────────┐
    │  SDK Client       │ OSRS Communication
    │ (rs-sdk wrapper)  │
    └────┬──────────────┘
         │
    ┌────▼──────────────┐
    │  rs-sdk Server    │ Game State & Actions
    │  (Game Instance)  │
    └───────────────────┘
```

## File Structure

```
src/
├── ai/                 # AI decision making
│   ├── agent.ts       # Main AI agent
│   └── providers/     # AI API providers
│       ├── openai.ts
│       └── anthropic.ts
├── sdk/               # rs-sdk integration
│   └── client.ts      # SDK wrapper
├── controller/        # Agent coordination
│   └── manager.ts     # Main manager
├── config/            # Configuration
│   └── index.ts
├── types/             # Type definitions
│   └── index.ts
├── cli.ts             # CLI commands
├── logger.ts          # Logging
└── index.ts           # Entry point
```

## Usage Examples

### Basic Agent Run

```bash
npm run agent
```

This will:
1. Connect to the rs-sdk server
2. Poll game state every 1000ms
3. Use AI to make decisions
4. Execute actions with >60% confidence
5. Continue until stopped (Ctrl+C)

### Monitor Statistics

```bash
npm run monitor
```

Displays:
- Total decisions made
- Successful/failed actions
- Last action and timestamp
- Link to game viewer

### Custom Bot

```bash
npm run agent -- --bot mybot --password secret123
```

## Extending the Framework

### Adding New Actions

Edit `src/controller/manager.ts` in the `executeAction` method:

```typescript
case 'skill':
  return await this.sdkClient.useSkill(
    action.parameters?.skillName || '',
    action.parameters?.target
  );
```

### Custom AI Provider

Create a new provider in `src/ai/providers/`:

```typescript
export const customProvider = {
  async complete(prompt: string, config: AIAgentConfig): Promise<string> {
    // Your implementation
  },
};
```

Then use it in `src/ai/agent.ts`:

```typescript
case 'custom':
  return customProvider.complete(prompt, this.config);
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | `openai` | AI provider to use |
| `AI_API_KEY` | `` | API key for AI provider |
| `AI_MODEL` | `gpt-4` | Model to use |
| `BOT_NAME` | `trigaarbot8` | Bot instance name |
| `BOT_PASSWORD` | `iMAThClkHhE8` | Bot password |
| `AGENT_POLL_INTERVAL` | `1000` | Poll interval in ms |
| `LOG_LEVEL` | `info` | Logging level |

## Development

```bash
# Build TypeScript
npm run build

# Run in watch mode
npm run dev

# Check types
npx tsc --noEmit
```

## Viewer

Watch your bot play in real-time:

https://rs-sdk-demo.fly.dev/bot?bot=trigaarbot8&password=*******

## Troubleshooting

### Agent not making decisions
- Check AI API key is set correctly
- Verify rs-sdk server is running
- Check logs for API errors

### Actions failing
- Ensure bot is in-game
- Check game state in logs
- Verify action parameters

### High latency
- Reduce `AGENT_POLL_INTERVAL`
- Check network connection to rs-sdk
- Increase AI `temperature` for faster decisions

## License

MIT

## Contributing

Pull requests welcome! Please ensure TypeScript builds without errors.
