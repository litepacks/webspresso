'use strict';

/**
 * Webspresso CLI - make:factory Command
 * Scaffolds an ORM model factory in factories/<name>.factory.js
 * @module bin/commands/make-factory
 */

const fs = require('fs');
const path = require('path');

function generateFactoryContent(modelName) {
  const cleanName = modelName.charAt(0).toUpperCase() + modelName.slice(1);

  return `'use strict';

const { defineFactory } = require('webspresso');

/**
 * Model Factory: ${cleanName}
 * Used in tests and seeders:
 *   const ${cleanName.toLowerCase()} = await ${cleanName}Factory.create({ status: 'active' });
 */
module.exports = defineFactory('${cleanName}', ({ faker, seq }) => ({
  title: faker ? faker.lorem.words(3) : \`${cleanName} \${seq}\`,
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
}));
`;
}

function registerCommand(program) {
  program
    .command('make:factory <name>')
    .alias('factory:make')
    .description('Scaffold an ORM model factory in factories/<name>.factory.js')
    .option('--root <dir>', 'Root directory of the project', process.cwd())
    .action((nameArg, options) => {
      const rootDir = path.resolve(options.root || process.cwd());
      const factoriesDir = path.join(rootDir, 'factories');

      if (!fs.existsSync(factoriesDir)) {
        fs.mkdirSync(factoriesDir, { recursive: true });
      }

      const rawName = String(nameArg || '').trim();
      if (!rawName) {
        console.error('❌ Model name is required for factory.');
        process.exitCode = 1;
        return;
      }

      const cleanName = rawName.replace(/\.factory(\.js)?$/, '').replace(/\.js$/, '');
      const targetFilePath = path.join(factoriesDir, `${cleanName.toLowerCase()}.factory.js`);

      if (fs.existsSync(targetFilePath)) {
        console.error(`❌ Factory file already exists: ${path.relative(rootDir, targetFilePath)}`);
        process.exitCode = 1;
        return;
      }

      const content = generateFactoryContent(cleanName);
      fs.writeFileSync(targetFilePath, content, 'utf-8');
      console.log(`\n✅ Created model factory: ${path.relative(rootDir, targetFilePath)}\n`);
    });
}

module.exports = {
  registerCommand,
  generateFactoryContent,
};
