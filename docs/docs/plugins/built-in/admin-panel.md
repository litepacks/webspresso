---
sidebar_position: 5
---

# Admin Panel Plugin

Full-featured admin panel for managing your application data.

## Setup

```javascript
const { createApp } = require('webspresso');
const { adminPanelPlugin } = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  plugins: [
    adminPanelPlugin({
      path: '/admin',
      models: ['User', 'Post', 'Category'],
    }),
  ],
});
```

## Features

- **CRUD Operations**: Create, read, update, delete records
- **Model Management**: Automatically generates forms from model schemas
- **Relations**: Manage related records
- **File Uploads**: Handle file uploads
- **Rich Text**: Rich text editor for content fields
- **Authentication**: Built-in authentication system

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `path` | Admin panel path | `/admin` |
| `models` | Models to expose | All models |

## Authentication

Set up admin users:

```bash
webspresso admin:setup
```

This creates:
- `migrations/YYYYMMDD_HHMMSS_create_admin_users_table.js`
- Admin user model

## Field Renderers

The admin panel automatically detects field types and uses appropriate renderers:

- **Basic**: Text, number, email, etc.
- **Rich Text**: For text fields
- **File Upload**: For file fields
- **Relations**: For foreign keys
- **JSON**: For JSON fields
- **Array**: For array fields

## Customization

Customize field rendering:

```javascript
adminPanelPlugin({
  fieldRenderers: {
    customField: (field, value) => {
      // Custom renderer
    },
  },
})
```

## Next Steps

- [Custom Plugins](/plugins/custom-plugins)
- [Advanced Configuration](/advanced/configuration)
