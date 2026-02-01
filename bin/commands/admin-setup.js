/**
 * Admin Setup Command
 * Create admin_users table migration for admin panel
 */

const fs = require('fs');
const path = require('path');
const { loadDbConfig } = require('../utils/db');
const { generateAdminUsersMigration } = require('../../plugins/admin-panel/migration-template');

function registerCommand(program) {
  program
    .command('admin:setup')
    .description('Create admin_users table migration for admin panel')
    .option('-c, --config <path>', 'Path to database config file')
    .action(async (options) => {
      try {
        const { config, path: configPath } = loadDbConfig(options.config);
        console.log(`\n📦 Using config: ${configPath}\n`);
        
        const migrationDir = config.migrations?.directory || './migrations';
        
        // Ensure migrations directory exists
        if (!fs.existsSync(migrationDir)) {
          fs.mkdirSync(migrationDir, { recursive: true });
          console.log(`Created directory: ${migrationDir}`);
        }
        
        // Check if migration already exists
        const existingMigrations = fs.readdirSync(migrationDir)
          .filter(f => f.includes('admin_users') || f.includes('admin-users'));
        
        if (existingMigrations.length > 0) {
          console.log(`⚠️  Admin users migration already exists:`);
          existingMigrations.forEach(m => console.log(`   - ${m}`));
          console.log(`\n   If you want to recreate it, delete the existing migration first.\n`);
          return;
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
        
        const filename = `${timestamp}_create_admin_users_table.js`;
        const filepath = path.join(migrationDir, filename);
        
        // Generate migration content
        const content = generateAdminUsersMigration();
        
        // Write migration file
        fs.writeFileSync(filepath, content);
        
        console.log(`✅ Created admin users migration: ${filepath}\n`);
        console.log(`📝 Next steps:`);
        console.log(`   1. Run migration: webspresso db:migrate`);
        console.log(`   2. Create first admin user via admin panel setup page\n`);
      } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
      }
    });
}

module.exports = { registerCommand };
