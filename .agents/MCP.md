# Webspresso Model Context Protocol (MCP) Guide

The **Model Context Protocol (MCP)** plugin (`plugins/mcp`) connects Webspresso applications directly to AI agents, IDE assistants (Antigravity, Claude Desktop, Cursor, Zed, Windsurf), and autonomous coding tools.

---

## 1. Overview & Architecture

Webspresso's architecture seamlessly bridges to MCP:
- **Services (`services/`) → MCP Tools**: Every service defined in `services/` is automatically converted into an MCP tool with full JSON Schema input validation derived from its Zod `schema`.
- **ORM Models (`models/`) → MCP Tools & Resources**: Models defined with `defineModel` provide query tools (`orm_find`, `orm_findById`), mutation tools (`orm_create`, `orm_update`, `orm_delete`), metadata tools (`orm_describe_model`), and resources (`webspresso://models`, `webspresso://models/{model}`, `webspresso://schema`).
- **System Context → MCP Resources**: `webspresso://routes` (file routes, API routes, HTTP methods), `webspresso://services` (catalog of services), and `webspresso://health` (system metrics).
- **Dual Transport**:
  - **Stdio (`webspresso mcp`)**: Standard input/output JSON-RPC 2.0 lines for local IDEs and CLI.
  - **HTTP & SSE (`/_mcp/sse`, `/_mcp/messages`, `/_mcp`)**: Server-Sent Events stream and Streamable HTTP for remote or web-accessible agents.

---

## 2. Using the Plugin in Webspresso App

```javascript
const { createApp, mcpPlugin } = require('webspresso');
const db = require('./models');

const { app } = createApp({
  db,
  plugins: [
    mcpPlugin({
      path: '/_mcp', // default: '/_mcp'
      auth: {
        token: process.env.MCP_SECRET_TOKEN, // Bearer token validation
        localhostOnly: true, // Only allow connections from localhost
      },
      services: {
        include: ['user.*', 'catalog.*'], // optional filter
        readOnly: false, // set true to disable mutation services
      },
      orm: {
        readOnly: false, // set true to allow only find/describe queries
      },
      discovery: true, // auto-discover custom mcp/ folder
    }),
  ],
});
```

---

## 3. CLI Command: `webspresso mcp`

Start the MCP server over Stdio without starting the web server:

```bash
# Start MCP server over stdio
npx webspresso mcp

# Restrict to read-only mode (prevent mutations)
npx webspresso mcp --read-only

# Print configuration snippet for Claude Desktop / Cursor
npx webspresso mcp --print-config
```

### IDE Configuration

Add to `claude_desktop_config.json` or `.cursor/mcp.json` or Antigravity IDE `mcp_config.json`:

```json
{
  "mcpServers": {
    "my-webspresso-app": {
      "command": "npx",
      "args": ["webspresso", "mcp"]
    }
  }
}
```

---

## 4. Custom Tools, Resources, and Prompts (`mcp/` folder)

When `discovery: true` (default), Webspresso scans the project's `mcp/` directory:

```
mcp/
├── tools/
│   └── deploy_preview.js   # exports { name, description, inputSchema, handler }
├── resources/
│   └── docs.js             # exports { uri, name, description, handler }
└── prompts/
    └── review_code.js      # exports { name, description, arguments, handler }
```

### Programmatic Registration via Runtime API
```javascript
const mcp = app.usePlugin('mcp'); // or ctx.mcp inside plugins
mcp.registerTool({
  name: 'custom_action',
  description: 'Does something custom',
  handler: async (args, ctx) => { ... },
});
```
