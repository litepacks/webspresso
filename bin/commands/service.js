/**
 * Webspresso CLI: Service Command
 * Run and test services interactively without starting the HTTP server
 * @module bin/commands/service
 */

const path = require('path');
let _inquirer;
const inquirer = {
  prompt: (...args) => {
    if (!_inquirer) _inquirer = require('inquirer');
    return _inquirer.prompt(...args);
  },
};
const { resolveDbConfigIfExists, createDbInstance } = require('../utils/db');

/**
 * Parse input string into an object
 * @param {string} inputStr
 * @returns {*}
 */
function parseInputPayload(inputStr) {
  if (!inputStr || typeof inputStr !== 'string') {
    return {};
  }

  const trimmed = inputStr.trim();
  if (!trimmed) return {};

  // Try JSON first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`Invalid JSON input: ${e.message}`);
    }
  }

  // Try key=value pairs (e.g. "id=42 name=Alice" or "id=42&name=Alice")
  const result = {};
  const pairs = trimmed.includes('&') ? trimmed.split('&') : trimmed.split(/\s+/);

  for (const pair of pairs) {
    if (!pair.includes('=')) continue;
    const [rawKey, ...valParts] = pair.split('=');
    const key = rawKey.trim();
    const val = valParts.join('=').trim();

    // Auto coerce simple types
    if (val === 'true') result[key] = true;
    else if (val === 'false') result[key] = false;
    else if (val === 'null') result[key] = null;
    else if (!Number.isNaN(Number(val)) && val !== '') result[key] = Number(val);
    else result[key] = val;
  }

  return Object.keys(result).length > 0 ? result : trimmed;
}

function registerCommand(program) {
  program
    .command('service [name]')
    .alias('service:run')
    .alias('service:call')
    .description('Run and test services interactively without starting the HTTP server')
    .option('-i, --input <payload>', 'Input payload as JSON string or key=val pairs')
    .option('-d, --dir <path>', 'Path to services directory (default: ./services)')
    .option('-c, --config <path>', 'Path to database config file (optional)')
    .option('-E, --env <environment>', 'Environment (development, production)', 'development')
    .action(async (nameArg, options) => {
      let db = null;
      try {
        const servicesDir = options.dir
          ? path.resolve(process.cwd(), options.dir)
          : path.resolve(process.cwd(), 'services');

        const { createServiceRegistry } = require('../../src/services');
        const registry = createServiceRegistry({
          servicesDir,
          isDev: true,
        });

        const serviceNames = registry.list();

        if (serviceNames.length === 0) {
          console.log(`\n⚠️  No services found in "${path.relative(process.cwd(), servicesDir) || '.'}".`);
          console.log('   Create your first service file in services/user/get.js\n');
          return;
        }

        let serviceName = nameArg;

        // Interactive Service Selection if not provided
        if (!serviceName) {
          console.log(`\n⚡ Discovered ${serviceNames.length} service(s) in ${path.relative(process.cwd(), servicesDir) || 'services/'}:\n`);

          const answer = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedService',
              message: 'Select a service to execute:',
              choices: serviceNames.map((name) => {
                const def = registry.get(name);
                const hasSchema = !!def?.schema;
                return {
                  name: `${name.padEnd(25)} ${hasSchema ? '📋 (has schema)' : ''}`,
                  value: name,
                };
              }),
            },
          ]);

          serviceName = answer.selectedService;
        }

        if (!registry.has(serviceName)) {
          console.error(`\n❌ Error: Service "${serviceName}" not found.`);
          console.log(`   Available services: ${serviceNames.join(', ')}\n`);
          process.exit(1);
        }

        const serviceDef = registry.get(serviceName);

        // Input gathering
        let input = {};
        if (options.input) {
          input = parseInputPayload(options.input);
        } else {
          console.log(`\n⚙️  Target: \x1b[36m${serviceName}\x1b[0m (${serviceDef.filePath ? path.relative(process.cwd(), serviceDef.filePath) : 'in-memory'})`);

          const inputAnswer = await inquirer.prompt([
            {
              type: 'input',
              name: 'rawInput',
              message: 'Enter input (JSON or key=val pairs, leave empty for {}):',
              default: '{}',
            },
          ]);

          input = parseInputPayload(inputAnswer.rawInput);
        }

        // Initialize DB if config exists
        const dbConfigResult = resolveDbConfigIfExists(options.config);
        if (dbConfigResult) {
          try {
            db = await createDbInstance(dbConfigResult.config, options.env);
          } catch (dbErr) {
            console.warn(`\n⚠️  Could not connect to database: ${dbErr.message}`);
          }
        }

        const ctx = {
          db,
          user: { id: 1, role: 'admin', email: 'cli-admin@webspresso.local' },
          logger: console,
        };

        console.log(`\n🚀 Executing \x1b[36m${serviceName}\x1b[0m with input:`, JSON.stringify(input));
        const startTime = Date.now();

        try {
          const result = await registry.call(serviceName, input, ctx);
          const duration = Date.now() - startTime;

          console.log(`\n✅ \x1b[32mExecution succeeded (${duration}ms)\x1b[0m\n`);
          console.log(JSON.stringify(result, null, 2));
          console.log('');
        } catch (execErr) {
          const duration = Date.now() - startTime;
          console.error(`\n❌ \x1b[31mExecution failed (${duration}ms): ${execErr.message}\x1b[0m\n`);

          if (execErr.fields) {
            console.error('Validation Details:');
            for (const [f, msg] of Object.entries(execErr.fields)) {
              console.error(`  - ${f}: ${msg}`);
            }
            console.error('');
          } else if (execErr.stack) {
            console.error(execErr.stack);
            console.error('');
          }
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(`\n❌ CLI Error: ${err.message}\n`);
        process.exitCode = 1;
      } finally {
        if (db && typeof db.destroy === 'function') {
          await db.destroy();
        }
      }
    });
}

module.exports = {
  registerCommand,
  parseInputPayload,
};
