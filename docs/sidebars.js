/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */

// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  tutorialSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/installation',
        'getting-started/quick-start',
        'getting-started/project-structure',
      ],
    },
    {
      type: 'category',
      label: 'CLI Commands',
      items: [
        'cli/overview',
        'cli/new',
        'cli/page',
        'cli/api',
        'cli/dev-start',
        'cli/tailwind',
      ],
    },
    {
      type: 'category',
      label: 'Routing',
      items: [
        'routing/file-based-routing',
        'routing/dynamic-routes',
        'routing/api-routes',
        'routing/schema-validation',
      ],
    },
    {
      type: 'category',
      label: 'Templates',
      items: [
        'templates/nunjucks',
        'templates/layouts',
        'templates/helpers',
        'templates/i18n',
      ],
    },
    {
      type: 'category',
      label: 'Hooks & Middleware',
      items: [
        'hooks/lifecycle',
        'hooks/middleware',
      ],
    },
    {
      type: 'category',
      label: 'Database/ORM',
      items: [
        'database/overview',
        'database/schema-helpers',
        'database/models',
        'database/repository',
        'database/query-builder',
        'database/relations',
        'database/migrations',
        'database/seeding',
        'database/transactions',
      ],
    },
    {
      type: 'category',
      label: 'Plugins',
      items: [
        'plugins/overview',
        'plugins/custom-plugins',
        {
          type: 'category',
          label: 'Built-in Plugins',
          items: [
            'plugins/built-in/dashboard',
            'plugins/built-in/sitemap',
            'plugins/built-in/analytics',
            'plugins/built-in/schema-explorer',
            'plugins/built-in/admin-panel',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Advanced',
      items: [
        'advanced/configuration',
        'advanced/error-handling',
        'advanced/asset-management',
        'advanced/deployment',
      ],
    },
  ],
};

module.exports = sidebars;
