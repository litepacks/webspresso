/**
 * DB Make Command
 * Create a new migration file
 */

const fs = require('fs');
const path = require('path');
const { loadDbConfig } = require('../utils/db');
const { getDefaultMigrationContent } = require('../utils/migration');

function registerCommand(program) {
  program
    .command('db:make <name>')
    .description('Create a new migration file')
    .option('-c, --config <path>', 'Path to database config file')
    .option('-m, --model <model>', 'Generate migration from model (requires models directory)')
    .action(async (name, options) => {
      const { config, path: configPath } = loadDbConfig(options.config);
      console.log(`\n📦 Using config: ${configPath}\n`);
      
      const migrationDir = config.migrations?.directory || './migrations';
      
      // Ensure migrations directory exists
      if (!fs.existsSync(migrationDir)) {
        fs.mkdirSync(migrationDir, { recursive: true });
        console.log(`Created directory: ${migrationDir}`);
      }
      
      // Generate filename with timestamp
      const now = new Date();
      const timestamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        '_',
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
      ].join('');
      
      const filename = `${timestamp}_${name}.js`;
      const filepath = path.join(migrationDir, filename);
      
      let content;
      
      if (options.model) {
        // Try to load model and generate migration from schema
        const modelsDir = config.models || './models';
        const modelPath = path.resolve(process.cwd(), modelsDir, `${options.model}.js`);
        
        if (fs.existsSync(modelPath)) {
          try {
            const model = require(modelPath);
            const { scaffoldMigration } = require('../../core/orm/migrations/scaffold');
            content = scaffoldMigration(model);
            console.log(`Generated migration from model: ${options.model}`);
          } catch (err) {
            console.warn(`⚠️  Could not generate from model: ${err.message}`);
            console.log('   Creating empty migration instead.\n');
            content = getDefaultMigrationContent(name);
          }
        } else {
          console.warn(`⚠️  Model not found: ${modelPath}`);
          console.log('   Creating empty migration instead.\n');
          content = getDefaultMigrationContent(name);
        }
      } else {
        content = getDefaultMigrationContent(name);
      }
      
      fs.writeFileSync(filepath, content);
      console.log(`✅ Created: ${filepath}\n`);
    });
}

module.exports = { registerCommand };
