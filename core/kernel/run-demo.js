#!/usr/bin/env node
/**
 * Demo: PostRepository + plugin + flow. Run: node core/kernel/run-demo.js
 */

const { createApp, defineFlow, BaseRepository } = require('./app');
const sampleSeo = require('./plugins/sample-seo');

class PostRepository extends BaseRepository {
  constructor(events) {
    super(events, { resource: 'post', source: 'orm' });
  }
}

async function main() {
  const app = createApp();

  app.events.on('orm.post.beforeCreate', async () => {
    console.log('[beforeCreate]');
  });
  app.events.on('orm.post.afterCreate', async () => {
    console.log('[afterCreate]');
  });

  app.registerPlugin(sampleSeo);

  app.registerFlow(
    defineFlow({
      id: 'sitemap-on-publish',
      trigger: 'orm.post.afterCreate',
      when: (ctx) => ctx.payload.record?.status === 'published',
      actions: [
        async () => {
          console.log('[flow] Run sitemap update');
        },
      ],
    }),
  );

  const posts = new PostRepository(app.events);

  console.log('--- create post (published) ---');
  await posts.create({ title: 'Hello', status: 'published' });

  console.log('\n--- view render (inline plugin template) ---');
  const html = app.view.renderView('seo::home', { title: 'Kernel' }, {
    layout: 'seo::main',
  });
  console.log(html.slice(0, 120).replace(/\s+/g, ' ') + '...');

  console.log('\n--- partial ---');
  console.log(app.view.renderPartial('seo::badge', { label: 'new' }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
