---
sidebar_position: 2
---

# Custom Plugins

Create custom plugins to extend Webspresso functionality.

## Basic Plugin

A plugin is an object with a `name` and `register` function:

```javascript
const myPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  
  register(ctx) {
    // Access Express app
    ctx.app.use((req, res, next) => next());
    
    // Add template helpers
    ctx.addHelper('myHelper', () => 'Hello!');
    
    // Add Nunjucks filters
    ctx.addFilter('myFilter', (val) => val.toUpperCase());
  },
};
```

## Plugin Factory

Use a factory function for configuration:

```javascript
function myPluginFactory(options = {}) {
  return {
    name: 'my-plugin',
    version: '1.0.0',
    _options: options,
    
    register(ctx) {
      // Use options
      const { apiKey } = options;
      
      // Register routes
      ctx.addRoute('get', '/my-route', (req, res) => {
        res.json({ hello: 'world' });
      });
    },
  };
}

// Use
const { app } = createApp({
  plugins: [
    myPluginFactory({ apiKey: 'secret' }),
  ],
});
```

## Plugin Dependencies

Declare dependencies on other plugins:

```javascript
const myPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  
  // Optional: depend on other plugins
  dependencies: {
    'analytics': '^1.0.0',
  },
  
  register(ctx) {
    // Use other plugin
    const analytics = ctx.usePlugin('analytics');
    if (analytics) {
      // Use analytics API
    }
  },
};
```

## Plugin API

Expose API for other plugins:

```javascript
const myPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  
  // Optional: expose API for other plugins
  api: {
    getData() {
      return this.data;
    },
    setData(data) {
      this.data = data;
    },
  },
  
  register(ctx) {
    // Initialize
    this.data = {};
  },
};
```

## Lifecycle Hooks

### onRoutesReady

Called after all routes are mounted:

```javascript
const myPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  
  register(ctx) {
    // Register during registration
  },
  
  onRoutesReady(ctx) {
    // Access route metadata
    console.log('Routes:', ctx.routes);
    
    // Add custom routes
    ctx.addRoute('get', '/my-route', (req, res) => {
      res.json({ hello: 'world' });
    });
  },
};
```

### onReady

Called before server starts:

```javascript
const myPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  
  onReady(ctx) {
    console.log('Server ready!');
  },
};
```

## Complete Example

```javascript
// plugins/my-plugin.js
function myPluginFactory(options = {}) {
  return {
    name: 'my-plugin',
    version: '1.0.0',
    _options: options,
    
    dependencies: {
      'analytics': '^1.0.0',
    },
    
    api: {
      getConfig() {
        return this._options;
      },
    },
    
    register(ctx) {
      // Add middleware
      ctx.app.use((req, res, next) => {
        req.myPlugin = { config: this._options };
        next();
      });
      
      // Add template helper
      ctx.addHelper('myHelper', (value) => {
        return `Processed: ${value}`;
      });
      
      // Add Nunjucks filter
      ctx.addFilter('myFilter', (val) => {
        return val.toUpperCase();
      });
    },
    
    onRoutesReady(ctx) {
      // Add custom route
      ctx.addRoute('get', '/api/my-plugin', (req, res) => {
        res.json({
          name: this.name,
          version: this.version,
          config: this._options,
        });
      });
    },
    
    onReady(ctx) {
      console.log(`${this.name} v${this.version} is ready`);
    },
  };
}

module.exports = myPluginFactory;
```

Use in your app:

```javascript
const myPlugin = require('./plugins/my-plugin');

const { app } = createApp({
  plugins: [
    myPlugin({ apiKey: 'secret' }),
  ],
});
```

## Next Steps

- [Built-in Plugins](/plugins/built-in/dashboard) - Use built-in plugins
