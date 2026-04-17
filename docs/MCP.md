# MCP Integration Guide

Complete guide to Model Context Protocol (MCP) integration in FreeClaude v3.2.6.

## What is MCP?

**Model Context Protocol (MCP)** is an open standard for connecting AI assistants to external systems. Think of it as a "USB-C for AI" — a universal interface that lets FreeClaude:

- **Access external data** — databases, APIs, documents
- **Execute actions** — create tasks, send messages, update records
- **Maintain context** — bidirectional sync between FreeClaude and external systems

```
┌──────────────┐      MCP Protocol      ┌──────────────┐
│              │  ◄────────────────────► │   External   │
│  FreeClaude  │   stdin/stdout/SSE      │    System    │
│              │                         │  (Database)  │
└──────────────┘                         └──────────────┘
```

---

## Built-in MCP Servers

FreeClaude v3.2.6 includes two production MCP servers:

### 1. CEOClaw PM MCP

**Purpose:** Project management operations  
**Tools:** 6

| Tool | Description |
|------|-------------|
| `pm_project_create` | Create new project |
| `pm_project_list` | List all projects |
| `pm_task_create` | Create task in project |
| `pm_task_update` | Update task status/priority |
| `pm_evm` | Calculate Earned Value Metrics |
| `pm_status` | Get project health report |

**Example usage:**
```
> Create a new project called "Website Redesign"
[FreeClaude uses pm_project_create]
✓ Project "Website Redesign" created (ID: PRJ-2026-001)

> Add a task "Design homepage mockup" to the project
[Uses pm_task_create]
✓ Task created (ID: TSK-001)

> What's the project status?
[Uses pm_status]
📊 Website Redesign Status:
   Tasks: 5 total, 2 completed, 3 pending
   Progress: 40%
```

**Installation:**
```bash
# MCP server is bundled with FreeClaude
# No additional setup required
```

---

### 2. 1С OData MCP

**Purpose:** Read-only access to 1С (Russian ERP) data  
**Tools:** 5

| Tool | Description |
|------|-------------|
| `odata_list_entities` | List available entities |
| `odata_query` | Execute OData query |
| `odata_count` | Count records |
| `odata_metadata` | Get entity metadata |
| `odata_financial_summary` | Financial reports |

**Example usage:**
```
> Connect to 1С and list available tables
[Uses odata_list_entities]
📋 Available entities:
   - Catalog_Номенклатура
   - Document_РеализацияТоваров
   - AccumulationRegister_ТоварыНаСкладах

> Get total sales for Q1 2026
[Uses odata_financial_summary]
💰 Q1 2026 Sales: ₽15,420,000
   Orders: 342
   Avg order: ₽45,088
```

**Configuration (via env):**
```bash
export ODATA_BASE_URL="http://1c-server:8080/my-database/odata/standard.odata"
export ODATA_USERNAME="admin"
export ODATA_PASSWORD="secret"
```

---

## Connecting External MCP Servers

### Method 1: Command Line

```bash
freeclaude --mcp-config ./my-mcp.json
```

### Method 2: Config File

Add to `~/.freeclaude.json`:
```json
{
  "mcpServers": [
    {
      "name": "slack",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-slack"],
      "env": {
        "SLACK_BOT_TOKEN": "xoxb-..."
      }
    }
  ]
}
```

### Method 3: Project-level `.mcp.json`

Create `.mcp.json` in your project root:
```json
{
  "servers": [
    {
      "name": "notion",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-notion"],
      "env": {
        "NOTION_API_KEY": "secret_..."
      }
    }
  ]
}
```

---

## MCP Config File Format

### Full Schema

```json
{
  "mcpServers": [
    {
      "name": "unique-server-name",
      "command": "npx",
      "args": ["-y", "@scope/server-name"],
      "env": {
        "API_KEY": "your-key"
      },
      "disabled": false,
      "timeout": 60000
    }
  ]
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Unique identifier for this server |
| `command` | string | ✅ | Executable to run (npx, node, python, etc.) |
| `args` | string[] | ✅ | Arguments for command |
| `env` | object | ❌ | Environment variables |
| `disabled` | boolean | ❌ | Temporarily disable |
| `timeout` | number | ❌ | Timeout in ms (default: 60000) |

---

## Bidirectional MCP

**What is it?**  
Bidirectional MCP allows external systems to push updates back to FreeClaude, not just respond to requests.

**How it works:**
```
Traditional MCP:    Bidirectional MCP:
FC ───Request──►   FC ◄──────Request─────────────►
    Server        Server ────► External Event
FC ◄──Response──   FC ◄──────Push Notification───►
```

**Use cases:**
- Slack bot mentions trigger FreeClaude
- GitHub webhooks start CI analysis
- 1С document changes notify FreeClaude

**Configuration:**
```json
{
  "mcpServers": [
    {
      "name": "slack-bidirectional",
      "command": "node",
      "args": ["./servers/slack-bridge.js"],
      "bidirectional": true,
      "webhook": {
        "port": 3456,
        "path": "/slack/events"
      }
    }
  ]
}
```

---

## Example MCP Servers

### Slack MCP

**Installation:**
```bash
npm install -g @modelcontextprotocol/server-slack
```

**Config:**
```json
{
  "mcpServers": [{
    "name": "slack",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-slack"],
    "env": {
      "SLACK_BOT_TOKEN": "xoxb-your-token",
      "SLACK_TEAM_ID": "T123456"
    }
  }]
}
```

**Capabilities:**
- Send messages to channels
- Read channel history
- Get user info
- Post reactions

**Usage:**
```
> Send message to #general: "Deployment complete!"
> What's the last 10 messages in #dev?
> Reply to thread about the bug fix
```

---

### Notion MCP

**Installation:**
```bash
npm install -g @modelcontextprotocol/server-notion
```

**Config:**
```json
{
  "mcpServers": [{
    "name": "notion",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-notion"],
    "env": {
      "NOTION_API_KEY": "secret_...",
      "NOTION_DATABASE_ID": "abc123..."
    }
  }]
}
```

**Capabilities:**
- Query databases
- Create/update pages
- Add comments
- Search content

**Usage:**
```
> List all tasks in Projects database
> Create a new page for API documentation
> Update task "Fix login" status to Done
```

---

### GitHub MCP

**Installation:**
```bash
npm install -g @modelcontextprotocol/server-github
```

**Config:**
```json
{
  "mcpServers": [{
    "name": "github",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."
    }
  }]
}
```

**Capabilities:**
- Create issues/PRs
- Search code
- List commits
- Add comments

**Usage:**
```
> Create issue: "Fix memory leak in worker"
> List open PRs in this repo
> Review the latest commits
```

---

### Filesystem MCP

**Built-in, no install needed:**
```
> Read file ./src/config.ts
> List directory ./docs/
> Search for TODO in ./src/
```

---

## Managing MCP Servers

### List All Servers
```
> /mcp list
[1] ceoclaw-pm — 6 tools
[2] 1c-odata — 5 tools
[3] slack (project) — 4 tools
```

### Add Server
```bash
freeclaude --mcp-config ./new-server.json
```

Or interactively:
```
> /mcp add
Name: custom-server
Command: npx
Args: -y @custom/server
Env vars (key=value): API_KEY=abc123
✓ Server added
```

### Disable/Enable
```
> /mcp disable slack
> /mcp enable slack
```

### Remove Server
```
> /mcp remove slack
```

---

## Developing Custom MCP Servers

### Basic Structure

```javascript
// my-server.js
const { Server } = require('@modelcontextprotocol/sdk');

const server = new Server({
  name: 'my-custom-server',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {}
  }
});

server.setToolHandler('my_tool', async (args) => {
  return {
    content: [{ type: 'text', text: `Result: ${args.input}` }]
  };
});

server.run();
```

### Tool Definition

```typescript
{
  name: 'search_database',
  description: 'Search records in the database',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', default: 10 }
    },
    required: ['query']
  }
}
```

### Testing Your Server

```bash
# Start your server
node my-server.js

# Test connection
freeclaude --mcp-config ./test.json -p "Test my_tool with query='hello'"
```

---

## Troubleshooting

### "MCP server not found"
```bash
# Check if command exists
which npx

# Use full path
{
  "command": "node",
  "args": ["/full/path/to/server.js"]
}
```

### "Connection refused"
```bash
# Check server is running
ps aux | grep mcp

# Check port availability
lsof -i :3456
```

### "Tool not available"
```
> /mcp list
# Verify server shows "connected"

# Reload MCP
> /reload
```

### Debug Mode
```bash
freeclaude --mcp-debug -p "Test MCP"
# Or
freeclaude -d mcp -p "Test"
```

### Strict Mode
```bash
# Only use MCP from --mcp-config
freeclaude --strict-mcp-config --mcp-config ./only-this.json
```

---

## Best Practices

1. **Use `.mcp.json` for projects** — Share MCP config with your team
2. **Use env vars for secrets** — Never commit API keys
3. **Name servers clearly** — Use descriptive names like "slack-work" not "server1"
4. **Set timeouts** — Prevent hanging requests
5. **Test locally first** — Verify MCP works before relying on it

---

## Resources

- **MCP Specification:** https://modelcontextprotocol.io
- **Server Registry:** https://github.com/modelcontextprotocol/servers
- **SDK Docs:** https://github.com/modelcontextprotocol/typescript-sdk
