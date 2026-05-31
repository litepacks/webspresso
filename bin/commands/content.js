/**
 * webspresso content:* CLI commands
 */

const fs = require('fs');
const path = require('path');
const { resolveContentConfig } = require('../../core/content/config');
const { ContentIndex } = require('../../core/content/index');

/**
 * @param {import('commander').Command} program
 */
function registerContentCommands(program) {
  program
    .command('content:list')
    .alias('content list')
    .description('List content collections and item counts')
    .description('List content collections and item counts')
    .action(() => {
      const config = resolveContentConfig({ enabled: true }, process.env.NODE_ENV || 'development');
      if (!config?.enabled) {
        console.log('Content layer is disabled. Set content.enabled in createApp or run from project with content/.');
        return;
      }
      const index = new ContentIndex(config);
      const cols = index.listCollections();
      if (!cols.length) {
        console.log('No collections found under', config.dir);
        return;
      }
      for (const c of cols) {
        console.log(`${c.name}: ${c.count} published, ${c.draftCount} drafts (${c.total} total)`);
      }
    });

  program
    .command('content:validate')
    .alias('content validate')
    .description('Validate content frontmatter against collection schemas')
    .option('--strict', 'Exit with code 1 on validation errors')
    .action((opts) => {
      const config = resolveContentConfig(
        { enabled: true, failOnInvalid: opts.strict },
        process.env.NODE_ENV || 'development'
      );
      if (!config?.enabled) {
        console.error('Content not enabled or content/ missing');
        process.exit(1);
      }
      let errors = 0;
      try {
        new ContentIndex(config);
      } catch (err) {
        console.error(err.message);
        process.exit(1);
      }
      const index = new ContentIndex(config);
      for (const item of index.items.values()) {
        if (item.validationErrors?.length) {
          errors += item.validationErrors.length;
          console.warn(`${item.path}: ${item.validationErrors.join('; ')}`);
        }
        if (!item.title) {
          errors++;
          console.warn(`${item.path}: missing title`);
        }
      }
      if (errors && opts.strict) {
        process.exit(1);
      }
      console.log(errors ? `Validation finished with ${errors} issue(s)` : 'Validation OK');
    });

  program
    .command('content:build-index')
    .alias('content build-index')
    .description('Build content index JSON to stdout or cache file')
    .option('-o, --output <file>', 'Write JSON to file')
    .action((opts) => {
      const config = resolveContentConfig({ enabled: true }, 'production');
      if (!config?.enabled) {
        console.error('Content not enabled');
        process.exit(1);
      }
      const index = new ContentIndex(config);
      const payload = {
        version: 1,
        builtAt: new Date().toISOString(),
        items: [...index.items.values()],
      };
      const json = JSON.stringify(payload, null, 2);
      if (opts.output) {
        const out = path.resolve(opts.output);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, json);
        console.log('Wrote', out);
      } else {
        process.stdout.write(json);
      }
    });

  program
    .command('content:new <collection> <slug>')
    .alias('content new')
    .description('Create a new markdown content file')
    .option('-t, --title <title>', 'Post title')
    .action((collection, slug, opts) => {
      const config = resolveContentConfig({ enabled: true }, 'development');
      const dir = config?.absoluteDir || path.resolve('content');
      const collDir = path.join(dir, collection);
      fs.mkdirSync(collDir, { recursive: true });
      const file = path.join(collDir, `${slug}.md`);
      if (fs.existsSync(file)) {
        console.error('File already exists:', file);
        process.exit(1);
      }
      const title = opts.title || slug.replace(/-/g, ' ');
      const body = `---
title: "${title}"
description: ""
slug: "${slug}"
date: "${new Date().toISOString().slice(0, 10)}"
tags: []
draft: true
---

# ${title}

Write your content here.
`;
      fs.writeFileSync(file, body);
      console.log('Created', file);
    });
}

module.exports = { registerContentCommands };
