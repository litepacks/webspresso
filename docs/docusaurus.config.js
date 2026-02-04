// @ts-check
// Note: type annotations cause type errors in JS files
// `@ts-check` and `@type` JSDoc annotations are optional, but type checking is disabled

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Webspresso',
  tagline: 'Minimal, production-ready SSR framework for Node.js',
  favicon: 'img/favicon.ico',

  // Set the production url of your site here
  url: 'https://webspresso.dev',
  // Set the /<baseUrl>/ pathname under which your site is served
  baseUrl: '/',

  // GitHub pages deployment config.
  organizationName: 'everytools',
  projectName: 'webspresso',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  // Even if you don't use internalization, you can use this field to set useful
  // metadata like html lang. For example, if your site is Chinese, you may want
  // to set "zh-Hans" here.
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl: 'https://github.com/everytools/webspresso/tree/main/',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      // Replace with your project's social card
      image: 'img/webspresso-social-card.jpg',
      navbar: {
        title: 'Webspresso',
        logo: {
          alt: 'Webspresso Logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'tutorialSidebar',
            position: 'left',
            label: 'Documentation',
          },
          {
            href: 'https://github.com/everytools/webspresso',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {
                label: 'Getting Started',
                to: '/getting-started/installation',
              },
              {
                label: 'CLI Commands',
                to: '/cli/overview',
              },
              {
                label: 'Database/ORM',
                to: '/database/overview',
              },
            ],
          },
          {
            title: 'Community',
            items: [
              {
                label: 'GitHub',
                href: 'https://github.com/everytools/webspresso',
              },
            ],
          },
          {
            title: 'More',
            items: [
              {
                label: 'GitHub',
                href: 'https://github.com/everytools/webspresso',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Webspresso. Built with Docusaurus.`,
      },
      prism: {
        theme: require('prism-react-renderer').themes.github,
        darkTheme: require('prism-react-renderer').themes.dracula,
        additionalLanguages: ['bash', 'json'],
      },
    }),
};

module.exports = config;
