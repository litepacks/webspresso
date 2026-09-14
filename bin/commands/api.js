'use strict';

/**
 * API Command
 * Add a new API endpoint with modern Webspresso schema & handler contract
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

function registerCommand(program) {
  program
    .command('api [route]')
    .description('Add a new API endpoint to pages/api/ with schema validation and handler')
    .option('-m, --method <method>', 'HTTP method (GET, POST, PUT, PATCH, DELETE)', 'GET')
    .option('--auth', 'Protect with session auth middleware')
    .option('--jwt', 'Protect with JWT bearer middleware')
    .action(async (routeArg, options) => {
      const pagesDir = path.resolve(process.cwd(), 'pages');
      if (!fs.existsSync(pagesDir)) {
        console.error('❌ Not a Webspresso project! (pages/ directory not found)');
        process.exit(1);
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
          },
        ]);

        const parsed = parseRouteAndMethod(answers.route, answers.method);
        route = parsed.route;
        method = parsed.method;
      }

      const methodUpper = String(method).toUpperCase();
      const methodLower = methodUpper.toLowerCase();
      const routePath = path.join(pagesDir, 'api', route);
      const dirPath = path.dirname(routePath);
      const fileName = path.basename(routePath);

      fs.mkdirSync(dirPath, { recursive: true });

      const apiFile = path.join(dirPath, `${fileName}.${methodLower}.js`);

      const middlewares = [];
      if (options.auth) middlewares.push("'auth'");
      if (options.jwt) middlewares.push("'jwt'");
      const middlewareStr = middlewares.length > 0 ? `\n  middleware: [${middlewares.join(', ')}],` : '';

      const hasParams = route.includes('[');
      const hasBody = ['POST', 'PUT', 'PATCH'].includes(methodUpper);

      const apiContent = `'use strict';

/**
 * ${methodUpper} /api/${route}
 */
module.exports = {
  // Input validation schema (Zod)
  schema: ({ z }) => ({
    ${hasParams ? 'params: z.object({ id: z.string().min(1) }),\n    ' : ''}${hasBody ? 'body: z.object({\n      // Define body schema here\n    }),\n    ' : ''}query: z.object({\n      // Define query params here\n    }),
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
};
`;

      fs.writeFileSync(apiFile, apiContent, 'utf8');
      console.log(`\n✅ Created API endpoint:\n   ${path.relative(process.cwd(), apiFile)}\n`);
    });
}

module.exports = { registerCommand, parseRouteAndMethod };
