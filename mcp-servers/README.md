# FreeClaude MCP Servers

Model Context Protocol servers for FreeClaude.

## CEOClaw PM (Project Management)

EVM-powered project management: tasks, budgets, CPI, SPI, EAC.

### Install & Run

```bash
cd mcp-servers/ceoclaw-pm
npm install
npm start
```

### Tools (7)

| Tool | Description |
|------|-------------|
| `pm_project_create` | Create project (name, budget, currency) |
| `pm_project_list` | List all projects with task counts |
| `pm_task_create` | Create task (projectId, title, priority, hours) |
| `pm_task_update` | Update task (status, actualHours, assignee) |
| `pm_evm` | EVM metrics (CPI, SPI, EAC, health) |
| `pm_evm_record` | Record PV/EV/AC data point |
| `pm_status` | Overall PM dashboard |

### EVM Metrics

- **CPI** (Cost Performance Index) — EV/AC. ≥1 = under budget
- **SPI** (Schedule Performance Index) — EV/PV. ≥1 = ahead of schedule
- **EAC** (Estimate at Completion) — BAC/CPI
- **ETC** (Estimate to Complete) — EAC - AC
- **Health** — 🟢 Healthy / 🟡 Warning / 🔴 Critical

### Storage

`~/.freeclaude/pm/projects.json` — projects
`~/.freeclaude/pm/tasks.json` — tasks
`~/.freeclaude/pm/evm.json` — EVM data points

---

## 1С OData

Read-only access to 1С:Enterprise via OData protocol.

### Setup

Create `~/.freeclaude/onec-config.json`:
```json
{
  "baseUrl": "https://1c.company.ru/your_db/odata/standard.odata",
  "username": "odata_user",
  "password": "odata_password"
}
```

### Install & Run

```bash
cd mcp-servers/onec-odata
npm install
npm start
```

### Tools (6)

| Tool | Description |
|------|-------------|
| `odata_config` | Check configuration status |
| `odata_list_entities` | List all OData entities |
| `odata_metadata` | Get entity types and properties |
| `odata_query` | Query entity with filter/select/top/expand |
| `odata_count` | Count records with optional filter |
| `odata_financial_summary` | Auto-detect financial entities |

### Compatible 1С Configs

- Альфа-Авто (автодилеры)
- БАЗИС (строительство)
- ERP Управление предприятием
- Бухгалтерия
- Any custom config with OData enabled
