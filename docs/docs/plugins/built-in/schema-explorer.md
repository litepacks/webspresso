---
sidebar_position: 4
---

# Schema Explorer Plugin

Exposes ORM schema information via API endpoints. Useful for frontend code generation, documentation, or admin tools.

## Setup

```javascript
const { createApp } = require('webspresso');
const { schemaExplorerPlugin } = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  plugins: [
    schemaExplorerPlugin({
      path: '/_schema',
      enabled: true,
      exclude: ['Secret'],
      includeColumns: true,
      includeRelations: true,
      includeScopes: true,
      authorize: (req) => {
        return req.headers['x-api-key'] === 'secret';
      },
    }),
  ],
});
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `path` | Endpoint path | `/_schema` |
| `enabled` | Force enable/disable | Auto based on NODE_ENV |
| `exclude` | Exclude specific models | `[]` |
| `includeColumns` | Include column metadata | `true` |
| `includeRelations` | Include relation metadata | `true` |
| `includeScopes` | Include scope configuration | `true` |
| `authorize` | Custom authorization function | `undefined` |

## Endpoints

### List All Models

```bash
GET /_schema
```

Response:

```json
{
  "meta": {
    "version": "1.0.0",
    "generatedAt": "2024-01-01T12:00:00.000Z",
    "modelCount": 2
  },
  "models": [
    {
      "name": "User",
      "table": "users",
      "primaryKey": "id",
      "columns": [...],
      "relations": [...],
      "scopes": {...}
    }
  ]
}
```

### Get Single Model

```bash
GET /_schema/:modelName
```

Response:

```json
{
  "name": "User",
  "table": "users",
  "primaryKey": "id",
  "columns": [
    {
      "name": "id",
      "type": "bigint",
      "primary": true,
      "autoIncrement": true
    },
    {
      "name": "email",
      "type": "string",
      "unique": true
    }
  ],
  "relations": [
    {
      "name": "company",
      "type": "belongsTo",
      "relatedModel": "Company",
      "foreignKey": "company_id"
    }
  ],
  "scopes": {
    "softDelete": true,
    "timestamps": true
  }
}
```

### OpenAPI Export

```bash
GET /_schema/openapi
```

Exports schema in OpenAPI 3.0 format.

## Authorization

Add custom authorization:

```javascript
schemaExplorerPlugin({
  authorize: (req) => {
    // Check API key
    return req.headers['x-api-key'] === 'secret';
    
    // Or check session
    return req.session?.user?.role === 'admin';
  },
})
```

## Programmatic Usage

Access plugin API:

```javascript
const plugin = schemaExplorerPlugin();

// Get all models
const models = plugin.api.getModels();

// Get single model
const user = plugin.api.getModel('User');

// Get model names
const names = plugin.api.getModelNames();
```

## Next Steps

- [Admin Panel Plugin](/plugins/built-in/admin-panel)
