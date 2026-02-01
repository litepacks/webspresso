/**
 * API Command
 * Add a new API endpoint to the current project
 */

const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');

function registerCommand(program) {
  program
    .command('api')
    .description('Add a new API endpoint to the current project')
    .action(async () => {
      if (!fs.existsSync('pages')) {
        console.error('❌ Not a Webspresso project! Run this command in your project directory.');
        process.exit(1);
      }
      
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'route',
          message: 'API route path (e.g., /api/users or /api/users/[id]):',
          validate: (input) => {
            if (!input.startsWith('/api/')) {
              return 'API route must start with /api/';
            }
            return true;
          }
        },
        {
          type: 'list',
          name: 'method',
          message: 'HTTP method:',
          choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
          default: 'GET'
        }
      ]);
      
      const route = answers.route.replace(/^\/api\//, '');
      const routePath = path.join('pages', 'api', route);
      const dirPath = path.dirname(routePath);
      const fileName = path.basename(routePath);
      
      // Create directory
      fs.mkdirSync(dirPath, { recursive: true });
      
      // Create API file
      const apiFile = path.join(dirPath, `${fileName}.${answers.method.toLowerCase()}.js`);
      
      const apiContent = `/**
 * ${answers.method} ${answers.route}
 */

module.exports = async function handler(req, res) {
  res.json({
    message: 'Hello from ${answers.route}',
    method: '${answers.method}',
    timestamp: new Date().toISOString()
  });
};
`;
      
      fs.writeFileSync(apiFile, apiContent);
      console.log(`\n✅ Created ${apiFile}\n`);
    });
}

module.exports = { registerCommand };
