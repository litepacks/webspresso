'use strict';

/**
 * Page Command
 * Add a new SSR page with Nunjucks template and companion data loader
 * @module bin/commands/page
 */

let _inquirer;
const inquirer = {
  prompt: (...args) => {
    if (!_inquirer) _inquirer = require('inquirer');
    return _inquirer.prompt(...args);
  },
};
const fs = require('fs');
const path = require('path');

function registerCommand(program) {
  program
    .command('page [route]')
    .description('Add a new SSR page (Nunjucks template + companion load() loader)')
    .option('--no-loader', 'Skip creating companion .js loader file')
    .option('--locales', 'Create page-level locale files')
    .action(async (routeArg, options) => {
      const pagesDir = path.resolve(process.cwd(), 'pages');
      if (!fs.existsSync(pagesDir)) {
        console.error('❌ Not a Webspresso project! (pages/ directory not found)');
        process.exit(1);
      }

      let route = routeArg ? String(routeArg).trim() : '';

      if (!route) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'route',
            message: 'Page route path (e.g., about or blog/[slug]):',
            validate: (input) => {
              if (!input || !input.trim()) return 'Route path is required';
              return true;
            },
          },
        ]);
        route = answers.route.trim();
      }

      // Normalize leading slash
      route = route.replace(/^\/+/, '');
      const routePath = path.join(pagesDir, route);
      const dirPath = path.dirname(routePath);
      const fileName = path.basename(routePath);

      fs.mkdirSync(dirPath, { recursive: true });

      const templateName = fileName === 'index' ? 'index' : fileName;
      const njkFile = path.join(dirPath, `${templateName}.njk`);

      const njkContent = `{% extends "layout.njk" %}

{% block content %}
<main class="max-w-4xl mx-auto px-4 py-8">
  <h1 class="text-3xl font-bold tracking-tight text-gray-900 mb-4">{{ title or "${templateName}" }}</h1>
  <p class="text-gray-600">Page content for <code>${route}</code>.</p>
</main>
{% endblock %}
`;

      fs.writeFileSync(njkFile, njkContent, 'utf8');
      console.log(`\n✅ Created template:\n   ${path.relative(process.cwd(), njkFile)}`);

      // Create companion loader if requested (default: true)
      if (options.loader !== false) {
        const jsFile = path.join(dirPath, `${templateName}.js`);
        const jsContent = `'use strict';

/**
 * Server-side data loader for ${templateName}.njk
 * @type {import('webspresso').PageRouteModule}
 */
module.exports = {
  // Server data loader executed before template rendering
  async load({ req, res, db, ctx }) {
    return {
      title: '${templateName.charAt(0).toUpperCase() + templateName.slice(1)}',
    };
  },

  // Dynamic page metadata
  meta({ data, ctx }) {
    return {
      title: data.title || '${templateName}',
      description: 'Page description for ${route}',
    };
  },
};
`;

        fs.writeFileSync(jsFile, jsContent, 'utf8');
        console.log(`✅ Created companion loader:\n   ${path.relative(process.cwd(), jsFile)}`);
      }

      // Create locales if requested
      if (options.locales) {
        const localesDir = path.join(dirPath, 'locales');
        fs.mkdirSync(localesDir, { recursive: true });

        const enContent = {
          title: templateName,
          description: 'Page description',
        };
        fs.writeFileSync(
          path.join(localesDir, 'en.json'),
          JSON.stringify(enContent, null, 2) + '\n',
          'utf8'
        );

        console.log(`✅ Created locales in:\n   ${path.relative(process.cwd(), localesDir)}`);
      }

      console.log(`\n🎉 Page ready at: /${route}\n`);
    });
}

module.exports = { registerCommand };
