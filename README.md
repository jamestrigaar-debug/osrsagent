# OSRS AI Agent Framework

A two-tier TypeScript automation framework for running AI-driven agents that play Old School RuneScape (OSRS) by executing scripts based on high-level goals. The framework manages agent state locally using a SQLite memory store and coordinates planning and execution through an orchestrator.

## How It Works

This system implements a **Goal→Plan→Action** execution model:

1. **Planner (Tier-1)** — An LLM (GPT-4 / Claude) that takes a goal and available scripts to create a step-by-step plan
2. **Dispatcher (Tier-2)** — A local executor that runs plan steps as scripts, updates memory, and escalates back to the Planner when issues arise
3. **Memory Store** — SQLite-backed persistence that tracks account state, active plans, action history, and results
4. **Script Pool** — Composable scripts (movement, interaction, banking, etc.) that the Dispatcher executes based on the plan

### Architecture Diagram

```
┌─────────────────────────────────────┐
│      User Goal / Interaction        │
│   (via CLI or API injection)        │
└────────────────┬────────────────────┘
                 │
        ┌────────▼─────────────────┐
        │  Memory Store (SQLite)   │
        │  • Account state         │
        │  • Current goal/plan     │
        │  • Action history       │
        └────────┬─────────────────┘
                 │
  ┌──────────────┴──────────────┐
  │                             │
  ▼                             ▼
┌───────────────────┐   ┌──────────────────────┐
│ Planner (Tier-1)  │   │ Dispatcher (Tier-2)  │
│ LLM Decision      │   │ Script Executor      │
│ Goal → Plan       │   │ Plan Step → Action   │
└───────────────────┘   └──────┬───────────────┘
  ▲                            │
  │                            ▼
  │        ┌────────────────────────────┐
  │        │  Script Pool Executor      │
  │        │  • movement.ts             │
  │        │  • interaction.ts          │
  │        │  • banking.ts              │
  │        │  • skill.ts                │
  │        └────────────────────────────┘
  │                    │
  └────────────────────┴──────┐
                              ▼
                    ┌──────────────────┐
                    │  RS-SDK Server   │
                    │  (Game Instance) │
                    └──────────────────┘
```

**Flow:**
- Goal is set (via CLI or API) and stored in Memory
- Orchestrator ticks at regular intervals (default 500ms)
- Dispatcher checks Memory for current goal and plan
- If no plan exists, Dispatcher escalates to Planner
- Planner creates a step-by-step plan using available scripts
- Dispatcher executes plan steps as scripts, updating Memory with results
- If steps fail repeatedly or goal changes, Dispatcher escalates back to Planner
- When goal is achieved, the cycle completes and awaits a new goal

## Features

- 🧠 **Two-Tier AI Architecture** — Planner (LLM) + Dispatcher (Local Executor)
- 📦 **Script Pool System** — Composable, reusable scripts with manifests
- 💾 **SQLite Memory Store** — Persistent account state, plans, and history
- 🔄 **Automatic Escalation** — Dispatcher escalates to Planner on repeated failures or user requests
- 🎮 **RS-SDK Integration** — Communicates with rs-sdk server for game actions
- 📊 **Dashboard** — Real-time monitoring of agent state and plan execution
- 🔧 **CLI Tools** — Inject goals, view status, list accounts, inspect scripts
- 📝 **TypeScript** — Full type safety and IDE support

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- AI API key (OpenAI or Anthropic)
- rs-sdk server running (for game connection)

### Installation

```bash
npm install
```

### Configuration

1. Copy `.env.example` to `.env`
2. Set your configuration:

```env
# RS-SDK server connection
RS_SDK_URL=http://localhost:3000
RS_SDK_WS=ws://localhost:3001

# Bot credentials
BOT_NAME=your_bot_name
BOT_PASSWORD=your_bot_password

# AI Planner (Tier-1)
AI_PROVIDER=openai      # or 'anthropic'
AI_API_KEY=your_key_here
AI_MODEL=gpt-4

# Orchestrator
DISPATCH_INTERVAL=500   # ms between dispatcher ticks
DASHBOARD_PORT=4000
LOG_LEVEL=info
```

### Running the Agent

Start the orchestrator (Planner + Dispatcher loop):

```bash
npm run start
```

This starts the local dashboard at `http://localhost:4000` and begins the orchestration loop for all accounts in the memory store.

### Injecting a Goal

In another terminal:

```bash
npm run goal mybot "reach fishing level 20"
```

The goal is stored in Memory, the Dispatcher detects it, escalates to the Planner, and a plan is generated.

### Other Commands

```bash
# View current memory state for an account
npm run status mybot

# List all accounts in the memory store
npm run list

# List available scripts and their manifests
npm run scripts

# Run in watch/dev mode
npm run dev
```

## File Structure

```
src/
├── orchestrator/        # Main orchestration loop (start, tick, stop)
│   └── index.ts        # Orchestrator class
│
├── dispatcher/         # Tier-2 executor (executes plan steps)
│   ├── dispatcher.ts   # Main dispatcher, runs scripts, escalates to Planner
│   └── escalation.ts   # Escalation logic and goal completion checks
│
├── planner/            # Tier-1 AI planning (calls LLM to generate plans)
│   └── planner.ts      # LLM-based plan generation
│
├── ai/                 # AI provider integrations
│   ├── agent.ts        # AI Agent interface (not directly used in v2)
│   └── providers/      # LLM API implementations
│       ├── openai.ts
│       └── anthropic.ts
│
├── memory/             # SQLite-backed state persistence
│   ├── store.ts        # Load/update/save Memory (SQLite)
│   ├── types.ts        # Memory data structures
│   ├── snapshots.ts    # Create memory snapshots for Planner
│   └── types.ts        # TypeScript definitions
│
├── scripts/            # Script pool and executor
│   ├── index.ts        # Script registry
│   ├── registry.ts     # Script manifest management
│   ├── executor.ts     # Execute scripts by name with params
│   ├── types.ts        # Script context and result types
│   └── [individual script files]
│
├── dashboard/          # Real-time monitoring web UI
│   └── server.ts       # Express server serving dashboard
│
├── config/             # Configuration (env var loading)
│   └── index.ts
│
├── types/              # Shared TypeScript types
│   └── index.ts
│
├── cli.ts              # Command-line interface
├── logger.ts           # Pino logging
└── index.ts            # Entry point
```

## How to Use

### 1. Start the Orchestrator

```bash
npm run start --bot mybot
```

This:
- Boots the memory store (creates/loads `memory.db`)
- Initializes the Dispatcher with a Planner instance
- Starts the dashboard on port 4000
- Begins the tick loop (default 500ms intervals)

### 2. Inject a Goal

```bash
npm run goal mybot "reach woodcutting level 30"
```

The goal is stored in the account's Memory. On the next Dispatcher tick:
- Dispatcher detects the goal
- Escalates to Planner (no plan yet)
- Planner calls the LLM with available scripts
- LLM generates a step-by-step plan
- Plan is stored in Memory and execution begins

### 3. Monitor Execution

Visit the dashboard or check Memory:

```bash
npm run status mybot
```

Output shows:
- `currentGoal` — the active goal
- `activePlan` — steps to execute, current step index
- `actionHistory` — recent action results
- `userRequest` — any pending user request

### 4. Scripts Execute Automatically

Each tick, the Dispatcher:
1. Loads the current plan from Memory
2. Executes the current step's script
3. Records the result (success/failure, data, timestamp)
4. Advances the plan pointer on success
5. On repeated failures, escalates to Planner for re-planning

### 5. Extending with New Scripts

Create a script file in `src/scripts/` with a manifest:

```typescript
// src/scripts/fish.ts
import { ScriptManifest, ScriptContext } from './types.js';

export const manifest: ScriptManifest = {
  name: 'fish',
  description: 'Cast a fishing line at the nearest fishing spot',
  parameters: {
    fishType: { type: 'string', description: 'e.g., "trout", "salmon"' },
    duration: { type: 'number', description: 'Duration in ms' },
  },
};

export async function execute(params: Record<string, any>, ctx: ScriptContext): Promise<any> {
  // Call rs-sdk to fish, return { success: true, message, data }
  return { success: true, message: 'Fished for 30 seconds' };
}
```

Register it in `src/scripts/index.ts`:

```typescript
import { manifest as fishManifest, execute as fishExecute } from './fish.js';

registerScript('fish', fishManifest, fishExecute);
```

The Planner will then be able to use `fish` in generated plans.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RS_SDK_URL` | `http://localhost:3000` | RS-SDK server HTTP endpoint |
| `RS_SDK_WS` | `ws://localhost:3001` | RS-SDK server WebSocket endpoint |
| `BOT_NAME` | `trigaarbot8` | Bot instance name |
| `BOT_PASSWORD` | — | Bot login password |
| `AI_PROVIDER` | `openai` | AI provider (`openai` or `anthropic`) |
| `AI_API_KEY` | — | API key for the AI provider |
| `AI_MODEL` | `gpt-4` | Model name (e.g., `gpt-4`, `claude-3-opus`) |
| `AI_MAX_TOKENS` | `2048` | Max tokens for LLM response |
| `AI_TEMPERATURE` | `0.2` | LLM temperature (lower = more deterministic) |
| `DISPATCH_INTERVAL` | `500` | Milliseconds between Dispatcher ticks |
| `DASHBOARD_PORT` | `4000` | Port for the web dashboard (0 to disable) |
| `AGENT_MAX_ACTIONS` | `30` | Max actions per plan |
| `LOG_LEVEL` | `info` | Log level (`debug`, `info`, `warn`, `error`) |
| `MEMORY_DB_PATH` | `./memory.db` | Path to SQLite memory store |

## Data Structures

### AccountMemory

```typescript
{
  accountId: string;
  currentGoal?: string;
  activePlan?: {
    planId: string;
    goal: string;
    steps: Array<{ script: string; params: Record<string, any> }>;
    currentStepIndex: number;
    loopUntil?: (memory: AccountMemory) => boolean;
  };
  actionHistory: ActionResult[];
  userRequest?: string;
}
```

### ActionResult

```typescript
{
  success: boolean;
  message: string;
  timestamp: number;
  data?: any;
}
```

## Troubleshooting

### Agent not executing plans
- Check that rs-sdk server is running and accessible
- Verify bot credentials in `.env`
- Check logs: `npm run status mybot` to inspect Memory state
- Ensure Planner has API access (check `AI_API_KEY`)

### Planner fails to generate plans
- Check AI API key and provider settings
- Review available scripts: `npm run scripts`
- Look at logs for LLM error messages
- Increase `AI_MAX_TOKENS` if plans are truncated

### Scripts fail repeatedly
- Dispatcher will escalate to Planner after 3 consecutive failures
- Check script output in Memory's `actionHistory`
- Verify script dependencies and rs-sdk connection
- Review rs-sdk logs for game state issues

### Memory state grows too large
- Memory stores full action history; consider archival
- Dashboard queries can be slow with large history
- Implement history pruning if needed

## Development

```bash
# Build TypeScript
npm run build

# Run in watch mode
npm run dev

# Type check
npx tsc --noEmit
```

## Viewer

Watch your bot play in real-time:

https://rs-sdk-demo.fly.dev/bot?bot=trigaarbot8&password=*******

(Replace bot name and password)

## License

MIT

## Contributing

Pull requests welcome! Ensure TypeScript builds without errors and describe the changes clearly.
