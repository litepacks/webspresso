/**
 * Seed Command
 * Run database seeders to populate database with fake data
 */

const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadDbConfig } = require('../utils/db');
const { getSeedFileTemplate } = require('../utils/seed');

function registerCommand(program) {
  program
    .command('seed')
    .description('Run database seeders to populate database with fake data')
    .option('-c, --config <path>', 'Path to database config file')
    .option('-e, --env <environment>', 'Environment (development, production)', 'development')
    .option('--setup', 'Setup seed files if they don\'t exist')
    .action(async (options) => {
      // Check if it's a Webspresso project
      if (!fs.existsSync(path.join(process.cwd(), 'server.js')) && 
          !fs.existsSync(path.join(process.cwd(), 'pages'))) {
        console.error('❌ Not a Webspresso project! Run this command in your project directory.');
        process.exit(1);
      }

      // Check for faker in the project's node_modules
      // Use require.resolve with paths to ensure we load from the project directory
      let faker;
      try {
        // Try to resolve from project's node_modules first
        const resolvedPath = require.resolve('@faker-js/faker', { 
          paths: [process.cwd(), path.join(process.cwd(), 'node_modules')] 
        });
        faker = require(resolvedPath);
      } catch {
        console.error('❌ @faker-js/faker not installed.');
        
        // Check if it's in package.json
        const packageJsonPath = path.join(process.cwd(), 'package.json');
        let shouldInstall = false;
        
        if (fs.existsSync(packageJsonPath)) {
          try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            const hasFaker = packageJson.dependencies?.['@faker-js/faker'] || 
                            packageJson.devDependencies?.['@faker-js/faker'];
            
            if (hasFaker) {
              console.log('   @faker-js/faker is in package.json but not installed.');
              console.log('   Run: npm install');
              process.exit(1);
            } else {
              // Ask if user wants to install it
              const { install } = await inquirer.prompt([
                {
                  type: 'confirm',
                  name: 'install',
                  message: 'Install @faker-js/faker now?',
                  default: true
                }
              ]);
              
              if (install) {
                shouldInstall = true;
              } else {
                console.log('   Install it manually with: npm install @faker-js/faker');
                process.exit(1);
              }
            }
          } catch (err) {
            console.log('   Install it with: npm install @faker-js/faker');
            process.exit(1);
          }
        } else {
          console.log('   Install it with: npm install @faker-js/faker');
          process.exit(1);
        }
        
        // Install faker if user confirmed
        if (shouldInstall) {
          console.log('\n📦 Installing @faker-js/faker...\n');
          try {
            execSync('npm install @faker-js/faker', {
              stdio: 'inherit',
              cwd: process.cwd()
            });
            console.log('\n✅ @faker-js/faker installed successfully!\n');
            
            // Try to require again from project's node_modules
            const resolvedPath = require.resolve('@faker-js/faker', { 
              paths: [process.cwd(), path.join(process.cwd(), 'node_modules')] 
            });
            // Clear cache to ensure fresh load
            delete require.cache[resolvedPath];
            faker = require(resolvedPath);
          } catch (err) {
            console.error('\n❌ Failed to install @faker-js/faker:', err.message);
            console.log('   Install it manually with: npm install @faker-js/faker');
            process.exit(1);
          }
        }
      }

      // Load database config
      const { config, path: configPath } = loadDbConfig(options.config);
      console.log(`\n📦 Using config: ${configPath}`);
      console.log(`   Environment: ${options.env}\n`);

      // Check if models directory exists
      const modelsDir = path.join(process.cwd(), 'models');
      if (!fs.existsSync(modelsDir)) {
        console.error('❌ models/ directory not found.');
        console.log('   Create models first, then run: webspresso seed');
        process.exit(1);
      }

      // Check if seeds directory exists
      const seedsDir = path.join(process.cwd(), 'seeds');
      const seedIndexPath = path.join(seedsDir, 'index.js');
      
      if (!fs.existsSync(seedsDir) || !fs.existsSync(seedIndexPath)) {
        if (options.setup) {
          console.log('📝 Setting up seed files...\n');
          
          // Create seeds directory
          if (!fs.existsSync(seedsDir)) {
            fs.mkdirSync(seedsDir, { recursive: true });
          }
          
          // Create seed index file
          const seedIndex = getSeedFileTemplate();
          
          fs.writeFileSync(seedIndexPath, seedIndex);
          console.log('✅ Seed files created!\n');
        } else {
          console.error('❌ seeds/index.js not found.');
          console.log('   Run with --setup flag to create seed files: webspresso seed --setup');
          process.exit(1);
        }
      }

      // Run the seed script
      try {
        require(seedIndexPath);
      } catch (error) {
        console.error('❌ Failed to run seed:', error.message);
        process.exit(1);
      }
    });
}

module.exports = { registerCommand };
