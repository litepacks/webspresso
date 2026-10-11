'use strict';

/**
 * Webspresso CLI - make:job Command
 * Scaffolds a background queue job worker in jobs/<name>.js
 * @module bin/commands/make-job
 */

const fs = require('fs');
const path = require('path');

function generateJobContent(jobName, queueName = 'default', retries = 3) {
  return `'use strict';

/**
 * Background Job: ${jobName}
 * Dispatched via: req.queue.dispatch('${jobName}', payload)
 */
module.exports = {
  name: '${jobName}',
  queue: '${queueName}',
  retries: ${retries},
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  handler: async (payload, ctx) => {
    const { db, logger } = ctx;
    if (logger) logger.info('[Job:${jobName}] Processing job:', payload);

    // Business logic goes here:
    // const repo = db ? db.getRepository('...') : null;
  },
};
`;
}

function registerCommand(program) {
  program
    .command('make:job <name>')
    .alias('job:make')
    .description('Scaffold a background queue job worker in jobs/<name>.js')
    .option('-q, --queue <queue>', 'Target queue name', 'default')
    .option('-r, --retries <number>', 'Number of retries upon failure', '3')
    .option('--root <dir>', 'Root directory of the project', process.cwd())
    .action((nameArg, options) => {
      const rootDir = path.resolve(options.root || process.cwd());
      const jobsDir = path.join(rootDir, 'jobs');

      if (!fs.existsSync(jobsDir)) {
        fs.mkdirSync(jobsDir, { recursive: true });
      }

      const jobName = String(nameArg || '').trim();
      if (!jobName) {
        console.error('❌ Job name is required.');
        process.exitCode = 1;
        return;
      }

      // Support nested folders e.g. emails/welcome
      const targetFilePath = path.join(jobsDir, `${jobName}.js`);
      const targetDir = path.dirname(targetFilePath);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      if (fs.existsSync(targetFilePath)) {
        console.error(`❌ Job file already exists: jobs/${jobName}.js`);
        process.exitCode = 1;
        return;
      }

      const retries = parseInt(options.retries, 10) || 3;
      const content = generateJobContent(jobName, options.queue || 'default', retries);

      fs.writeFileSync(targetFilePath, content, 'utf-8');
      console.log(`\n✅ Created background job: jobs/${jobName}.js (queue: "${options.queue || 'default'}", retries: ${retries})\n`);
    });
}

module.exports = {
  registerCommand,
  generateJobContent,
};
