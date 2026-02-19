/**
 * Admin Password Command
 * Reset admin user password via CLI
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function registerCommand(program) {
  program
    .command('admin:password')
    .description('Reset admin user password')
    .option('-e, --email <email>', 'Admin user email')
    .option('-p, --password <password>', 'New password (not recommended, use interactive mode)')
    .option('-c, --config <path>', 'Path to database config file')
    .action(async (options) => {
      try {
        // Find project root and load database
        const cwd = process.cwd();
        
        // Try to find and load the database config
        let dbConfig = null;
        const configPaths = [
          options.config,
          path.join(cwd, 'webspresso.config.js'),
          path.join(cwd, 'database.config.js'),
          path.join(cwd, 'db.config.js'),
        ].filter(Boolean);
        
        for (const configPath of configPaths) {
          if (fs.existsSync(configPath)) {
            const config = require(configPath);
            dbConfig = config.database || config;
            break;
          }
        }
        
        if (!dbConfig) {
          console.error('❌ Error: Could not find database configuration.');
          console.error('   Please run this command from your project root.');
          process.exit(1);
        }
        
        // Lazy load dependencies
        const bcrypt = require('bcrypt');
        const knex = require('knex');
        
        // Initialize database connection
        const db = knex(dbConfig);
        
        // Check if admin_users table exists
        const hasTable = await db.schema.hasTable('admin_users');
        if (!hasTable) {
          console.error('❌ Error: admin_users table does not exist.');
          console.error('   Run "webspresso admin:setup" and "webspresso db:migrate" first.');
          await db.destroy();
          process.exit(1);
        }
        
        // Get email (interactive if not provided)
        let email = options.email;
        if (!email) {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          
          email = await new Promise((resolve) => {
            rl.question('Enter admin email: ', (answer) => {
              rl.close();
              resolve(answer.trim());
            });
          });
        }
        
        if (!email) {
          console.error('❌ Error: Email is required.');
          await db.destroy();
          process.exit(1);
        }
        
        // Check if user exists
        const user = await db('admin_users').where({ email }).first();
        if (!user) {
          console.error(`❌ Error: Admin user with email "${email}" not found.`);
          
          // Show available users
          const users = await db('admin_users').select('id', 'email', 'name');
          if (users.length > 0) {
            console.log('\nAvailable admin users:');
            users.forEach(u => console.log(`   - ${u.email} (${u.name || 'No name'})`));
          }
          
          await db.destroy();
          process.exit(1);
        }
        
        // Get new password (interactive if not provided)
        let password = options.password;
        if (!password) {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          
          // Disable echo for password input
          if (process.stdin.isTTY) {
            process.stdout.write('Enter new password: ');
            password = await new Promise((resolve) => {
              let pwd = '';
              process.stdin.setRawMode(true);
              process.stdin.resume();
              process.stdin.on('data', (char) => {
                char = char.toString();
                if (char === '\n' || char === '\r') {
                  process.stdin.setRawMode(false);
                  process.stdin.pause();
                  console.log(); // New line after password
                  resolve(pwd);
                } else if (char === '\u0003') {
                  // Ctrl+C
                  process.exit();
                } else if (char === '\u007F') {
                  // Backspace
                  if (pwd.length > 0) {
                    pwd = pwd.slice(0, -1);
                    process.stdout.write('\b \b');
                  }
                } else {
                  pwd += char;
                  process.stdout.write('*');
                }
              });
            });
            rl.close();
          } else {
            password = await new Promise((resolve) => {
              rl.question('Enter new password: ', (answer) => {
                rl.close();
                resolve(answer);
              });
            });
          }
        }
        
        if (!password || password.length < 6) {
          console.error('❌ Error: Password must be at least 6 characters.');
          await db.destroy();
          process.exit(1);
        }
        
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Update the password
        await db('admin_users')
          .where({ email })
          .update({
            password: hashedPassword,
            updated_at: new Date(),
          });
        
        console.log(`\n✅ Password updated successfully for: ${email}\n`);
        
        await db.destroy();
      } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
      }
    });
    
  // Also add a command to list admin users
  program
    .command('admin:list')
    .description('List all admin users')
    .option('-c, --config <path>', 'Path to database config file')
    .action(async (options) => {
      try {
        const cwd = process.cwd();
        
        // Try to find and load the database config
        let dbConfig = null;
        const configPaths = [
          options.config,
          path.join(cwd, 'webspresso.config.js'),
          path.join(cwd, 'database.config.js'),
          path.join(cwd, 'db.config.js'),
        ].filter(Boolean);
        
        for (const configPath of configPaths) {
          if (fs.existsSync(configPath)) {
            const config = require(configPath);
            dbConfig = config.database || config;
            break;
          }
        }
        
        if (!dbConfig) {
          console.error('❌ Error: Could not find database configuration.');
          process.exit(1);
        }
        
        const knex = require('knex');
        const db = knex(dbConfig);
        
        // Check if admin_users table exists
        const hasTable = await db.schema.hasTable('admin_users');
        if (!hasTable) {
          console.log('ℹ️  admin_users table does not exist yet.');
          console.log('   Run "webspresso admin:setup" and "webspresso db:migrate" first.');
          await db.destroy();
          return;
        }
        
        // Get all admin users
        const users = await db('admin_users')
          .select('id', 'email', 'name', 'role', 'active', 'created_at')
          .orderBy('id');
        
        if (users.length === 0) {
          console.log('\nNo admin users found.\n');
          console.log('Create the first admin user via the admin panel setup page.');
        } else {
          console.log(`\n📋 Admin Users (${users.length}):\n`);
          console.log('  ID  | Email                          | Name           | Role    | Active | Created');
          console.log('  ' + '-'.repeat(90));
          
          users.forEach(user => {
            const email = (user.email || '').padEnd(30).slice(0, 30);
            const name = (user.name || '-').padEnd(14).slice(0, 14);
            const role = (user.role || 'admin').padEnd(7).slice(0, 7);
            const active = user.active ? '  ✓   ' : '  ✗   ';
            const created = user.created_at 
              ? new Date(user.created_at).toLocaleDateString()
              : '-';
            
            console.log(`  ${String(user.id).padStart(3)} | ${email} | ${name} | ${role} | ${active} | ${created}`);
          });
          console.log();
        }
        
        await db.destroy();
      } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
      }
    });
}

module.exports = { registerCommand };
