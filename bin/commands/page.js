/**
 * Page Command
 * Add a new page to the current project
 */

const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');

function registerCommand(program) {
  program
    .command('page')
    .description('Add a new page to the current project')
    .action(async () => {
      if (!fs.existsSync('pages')) {
        console.error('❌ Not a Webspresso project! Run this command in your project directory.');
        process.exit(1);
      }
      
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'route',
          message: 'Route path (e.g., /about or /blog/post):',
          validate: (input) => {
            if (!input.startsWith('/')) {
              return 'Route must start with /';
            }
            return true;
          }
        },
        {
          type: 'confirm',
          name: 'hasConfig',
          message: 'Add route config file (.js)?',
          default: false
        },
        {
          type: 'confirm',
          name: 'hasLocales',
          message: 'Add locale files?',
          default: false
        }
      ]);
      
      const route = answers.route.replace(/^\//, '');
      const routePath = path.join('pages', route);
      const dirPath = path.dirname(routePath);
      const fileName = path.basename(routePath);
      
      // Create directory
      fs.mkdirSync(dirPath, { recursive: true });
      
      // Create .njk file
      const templateName = fileName === 'index' ? 'index' : fileName;
      const njkFile = path.join(dirPath, `${templateName}.njk`);
      
      const njkContent = `{% extends "layout.njk" %}

{% block content %}
<div>
  <h1>{{ t('title') or '${route}' }}</h1>
  <p>{{ t('description') or 'Page content' }}</p>
</div>
{% endblock %}
`;
      
      fs.writeFileSync(njkFile, njkContent);
      console.log(`✅ Created ${njkFile}`);
      
      // Create config file if requested
      if (answers.hasConfig) {
        const jsFile = path.join(dirPath, `${templateName}.js`);
        const jsContent = `module.exports = {
  async load(req, ctx) {
    return {
      // Add your data here
    };
  },
  
  meta(req, ctx) {
    return {
      title: ctx.t('meta.title') || '${route}',
      description: ctx.t('meta.description') || ''
    };
  }
};
`;
        
        fs.writeFileSync(jsFile, jsContent);
        console.log(`✅ Created ${jsFile}`);
      }
      
      // Create locales if requested
      if (answers.hasLocales) {
        const localesDir = path.join(dirPath, 'locales');
        fs.mkdirSync(localesDir, { recursive: true });
        
        const enContent = {
          title: route,
          description: 'Page description',
          meta: {
            title: `${route} - Webspresso`,
            description: 'Page description'
          }
        };
        
        fs.writeFileSync(
          path.join(localesDir, 'en.json'),
          JSON.stringify(enContent, null, 2) + '\n'
        );
        
        const deContent = {
          title: route,
          description: 'Seitenbeschreibung',
          meta: {
            title: `${route} - Webspresso`,
            description: 'Seitenbeschreibung'
          }
        };
        
        fs.writeFileSync(
          path.join(localesDir, 'de.json'),
          JSON.stringify(deContent, null, 2) + '\n'
        );
        
        console.log(`✅ Created locale files in ${localesDir}`);
      }
      
      console.log(`\n✅ Page created at ${route}\n`);
    });
}

module.exports = { registerCommand };
