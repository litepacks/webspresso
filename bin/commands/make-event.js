'use strict';

/**
 * Webspresso CLI - make:event Command
 * Scaffolds an event / signal listener in listeners/<name>.js
 * @module bin/commands/make-event
 */

const fs = require('fs');
const path = require('path');

function generateEventContent(eventName) {
  return `'use strict';

/**
 * Event Listener: ${eventName}
 * Triggered by: app.events.emit('${eventName}', payload)
 */
module.exports = {
  event: '${eventName}',

  /**
   * Handle incoming event
   * @param {Object} payload - Event payload
   * @param {Object} ctx - Injected context { events, db, queue, mailer, logger }
   */
  async handle(payload, ctx = {}) {
    const { logger, mailer, queue } = ctx;
    if (logger) {
      logger.log('[Event:${eventName}] Received event payload:', payload);
    }

    // Example: Dispatch background job or send notification email
    // if (queue) await queue.dispatch('notify', payload);
  },
};
`;
}

function registerCommand(program) {
  program
    .command('make:event <name>')
    .alias('event:make')
    .description('Scaffold an event listener in listeners/<name>.js')
    .option('--root <dir>', 'Root directory of the project', process.cwd())
    .action((nameArg, options) => {
      const rootDir = path.resolve(options.root || process.cwd());
      const listenersDir = path.join(rootDir, 'listeners');

      if (!fs.existsSync(listenersDir)) {
        fs.mkdirSync(listenersDir, { recursive: true });
      }

      const rawName = String(nameArg || '').trim();
      if (!rawName) {
        console.error('❌ Event name is required.');
        process.exitCode = 1;
        return;
      }

      const eventName = rawName.replace(/\.js$/, '');
      const fileName = eventName.replace(/:/g, '-');
      const targetFilePath = path.join(listenersDir, `${fileName}.js`);

      if (fs.existsSync(targetFilePath)) {
        console.error(`❌ Listener file already exists: ${path.relative(rootDir, targetFilePath)}`);
        process.exitCode = 1;
        return;
      }

      const content = generateEventContent(eventName);
      fs.writeFileSync(targetFilePath, content, 'utf-8');
      console.log(`\n✅ Created event listener: ${path.relative(rootDir, targetFilePath)} (event: "${eventName}")\n`);
    });
}

module.exports = {
  registerCommand,
  generateEventContent,
};
