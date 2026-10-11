'use strict';

/**
 * API Command
 * Add a new API endpoint or full REST CRUD suite with modern Webspresso schema & handler contract
 * @module bin/commands/api
 */

let _inquirer;
const inquirer = {
  prompt: (...args) => {
    if (!_inquirer) _inquirer = require('inquirer');
    return _inquirer.prompt(...args);
  },
};
const fs = require('fs');
const path = require('path');

const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function singularize(word) {
  if (!word) return '';
  const lower = word.toLowerCase();
  if (lower.endsWith('ies')) {
    return lower.slice(0, -3) + 'y';
  }
  if (lower.endsWith('ses')) {
    return lower.slice(0, -2);
  }
  if (lower.endsWith('s') && !lower.endsWith('ss')) {
    return lower.slice(0, -1);
  }
  return lower;
}

function toPascalCase(str) {
  if (!str) return '';
  const clean = str.replace(/[^a-zA-Z0-9]/g, ' ');
  return clean
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function parseRouteAndMethod(rawInput, optionMethod) {
  let route = String(rawInput || '').trim();
  let method = optionMethod ? String(optionMethod).toUpperCase() : null;

  // Normalize /api/ prefix if present
  route = route.replace(/^\/?api\/?/, '');

  // Check if route has method suffix (e.g. notes.post or notes.post.js or [id].get)
  for (const m of VALID_METHODS) {
    const lower = m.toLowerCase();
    if (route.endsWith(`.${lower}.js`)) {
      method = m;
      route = route.slice(0, -(lower.length + 4));
      break;
    } else if (route.endsWith(`.${lower}`)) {
      method = m;
      route = route.slice(0, -(lower.length + 1));
      break;
    }
  }

  return {
    route: route.replace(/^\/+|\/+$/g, ''),
    method: method || 'GET',
  };
}

function generateCrudFiles(apiDir, route, modelName, middlewareStr) {
  const cleanRoute = route.replace(/^\/+|\/+$/g, '');
  const baseDir = path.join(apiDir, cleanRoute);
  const detailDir = path.join(baseDir, '[id]');
  fs.mkdirSync(detailDir, { recursive: true });

  const files = [
    {
      path: path.join(apiDir, `${cleanRoute}.get.js`),
      label: `GET /api/${cleanRoute} (List)`,
      content: `'use strict';

const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    query: z.object({
      page: z.coerce.number().optional().default(1),
      limit: z.coerce.number().optional().default(20),
    }),
  }),${middlewareStr}
  handler: async (req, res) => {
    const repo = req.db ? req.db.getRepository('${modelName}') : null;
    const { page, limit } = req.input.query;
    const items = repo ? await repo.query().paginate({ page, limit }) : [];
    return res.json(items);
  },
});
`,
    },
    {
      path: path.join(apiDir, `${cleanRoute}.post.js`),
      label: `POST /api/${cleanRoute} (Create)`,
      content: `'use strict';

const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    body: z.object({
      title: z.string().min(1).optional(),
    }).passthrough(),
  }),${middlewareStr}
  handler: async (req, res) => {
    const repo = req.db ? req.db.getRepository('${modelName}') : null;
    const created = repo ? await repo.create(req.input.body) : req.input.body;
    return res.status(201).json(created);
  },
});
`,
    },
    {
      path: path.join(detailDir, '[id].get.js'),
      label: `GET /api/${cleanRoute}/:id (Detail)`,
      content: `'use strict';

const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    params: z.object({
      id: z.coerce.number().or(z.string().min(1)),
    }),
  }),${middlewareStr}
  handler: async (req, res) => {
    const repo = req.db ? req.db.getRepository('${modelName}') : null;
    const item = repo ? await repo.findById(req.params.id) : null;
    if (!item) {
      return res.status(404).json({ error: '${modelName} not found' });
    }
    return res.json(item);
  },
});
`,
    },
    {
      path: path.join(detailDir, '[id].patch.js'),
      label: `PATCH /api/${cleanRoute}/:id (Update)`,
      content: `'use strict';

const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    params: z.object({
      id: z.coerce.number().or(z.string().min(1)),
    }),
    body: z.record(z.unknown()).optional(),
  }),${middlewareStr}
  handler: async (req, res) => {
    const repo = req.db ? req.db.getRepository('${modelName}') : null;
    const updated = repo ? await repo.update(req.params.id, req.input.body || {}) : null;
    if (!updated) {
      return res.status(404).json({ error: '${modelName} not found' });
    }
    return res.json(updated);
  },
});
`,
    },
    {
      path: path.join(detailDir, '[id].delete.js'),
      label: `DELETE /api/${cleanRoute}/:id (Delete)`,
      content: `'use strict';

const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    params: z.object({
      id: z.coerce.number().or(z.string().min(1)),
    }),
  }),${middlewareStr}
  handler: async (req, res) => {
    const repo = req.db ? req.db.getRepository('${modelName}') : null;
    if (repo) {
      await repo.delete(req.params.id);
    }
    return res.status(204).end();
  },
});
`,
    },
  ];

  for (const f of files) {
    fs.writeFileSync(f.path, f.content, 'utf8');
  }

  return files;
}

function registerCommand(program) {
  program
    .command('api [route]')
    .alias('make:api')
    .alias('api:make')
    .description('Add a new API endpoint to pages/api/ with schema validation and handler')
    .option('-m, --method <method>', 'HTTP method (GET, POST, PUT, PATCH, DELETE)', 'GET')
    .option('--crud', 'Generate full REST CRUD endpoints (list, create, get, update, delete)')
    .option('--model <model>', 'Associated ORM model name for repository calls')
    .option('--auth', 'Protect with session auth middleware')
    .option('--jwt', 'Protect with JWT bearer middleware')
    .option('--root <dir>', 'Root directory of the project', process.cwd())
    .action(async (routeArg, options) => {
      const rootDir = path.resolve(options.root || process.cwd());
      const pagesDir = path.join(rootDir, 'pages');
      if (!fs.existsSync(pagesDir)) {
        fs.mkdirSync(pagesDir, { recursive: true });
      }

      const apiDir = path.join(pagesDir, 'api');
      if (!fs.existsSync(apiDir)) {
        fs.mkdirSync(apiDir, { recursive: true });
      }

      let route;
      let method;

      if (routeArg) {
        const parsed = parseRouteAndMethod(routeArg, options.method);
        route = parsed.route;
        method = parsed.method;
      } else {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'route',
            message: 'API route path (e.g., users or users/[id] or /api/notes):',
            validate: (input) => {
              if (!input || !input.trim()) return 'API route is required';
              return true;
            },
          },
          {
            type: 'list',
            name: 'method',
            message: 'HTTP method:',
            choices: VALID_METHODS,
            default: options.method ? options.method.toUpperCase() : 'GET',
            when: () => !options.crud,
          },
        ]);

        const parsed = parseRouteAndMethod(answers.route, answers.method || options.method);
        route = parsed.route;
        method = parsed.method;
      }

      const middlewares = [];
      if (options.auth) middlewares.push("'auth'");
      if (options.jwt) middlewares.push("'jwt'");
      const middlewareStr = middlewares.length > 0 ? `\n  middleware: [${middlewares.join(', ')}],` : '';

      // CRUD Generation Mode
      if (options.crud) {
        const lastSegment = route.split('/').filter(Boolean).pop() || route;
        const singular = singularize(lastSegment);
        const modelName = options.model ? String(options.model).trim() : toPascalCase(singular);

        const createdFiles = generateCrudFiles(apiDir, route, modelName, middlewareStr);
        console.log(`\n✅ Generated REST CRUD API endpoints for "${modelName}" in pages/api/${route}:`);
        for (const cf of createdFiles) {
          console.log(`   - ${cf.label} → ${path.relative(process.cwd(), cf.path)}`);
        }
        console.log('');
        return;
      }

      // Single Route Generation Mode
      const methodUpper = String(method).toUpperCase();
      const methodLower = methodUpper.toLowerCase();
      const routePath = path.join(apiDir, route);
      const dirPath = path.dirname(routePath);
      const fileName = path.basename(routePath);

      fs.mkdirSync(dirPath, { recursive: true });

      const apiFile = path.join(dirPath, `${fileName}.${methodLower}.js`);

      const hasParams = route.includes('[');
      const hasBody = ['POST', 'PUT', 'PATCH'].includes(methodUpper);

      const apiContent = `'use strict';

/**
 * ${methodUpper} /api/${route}
 */
const { defineApi } = require('webspresso');

module.exports = defineApi({
  // Input validation schema (Zod)
  schema: ({ z }) => ({
    ${hasParams ? 'params: z.object({ id: z.coerce.number().or(z.string().min(1)) }),\n    ' : ''}${hasBody ? 'body: z.object({\n      // Define body schema here\n    }).passthrough(),\n    ' : ''}query: z.object({\n      // Define query params here\n    }),
  }),${middlewareStr}

  // Request Handler
  handler: async (req, res) => {
    // req.db.getRepository('ModelName') -> Access ORM models
    // req.service('service.name', payload) -> Invoke service
    // req.input -> Type-safe validated body, query, params
    return res.json({
      success: true,
      message: 'Hello from /api/${route}',
      timestamp: new Date().toISOString(),
    });
  },
});
`;

      fs.writeFileSync(apiFile, apiContent, 'utf8');
      console.log(`\n✅ Created API endpoint:\n   ${path.relative(process.cwd(), apiFile)}\n`);
    });
}

module.exports = {
  registerCommand,
  parseRouteAndMethod,
  singularize,
  toPascalCase,
  generateCrudFiles,
};
