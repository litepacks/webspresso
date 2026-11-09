/**
 * In-process service & ORM layer benchmarks on the fullstack-app database
 * (no HTTP): isolates services-layer and repository costs from network/render overhead.
 */

import { afterAll, bench, describe } from 'vitest';
import { bootFullstack } from './_fullstack-harness.mjs';

const app = await bootFullstack({ listen: false });
afterAll(() => app.stop());

const { db, samplePost } = app;
const service = (name, input) => app.app.service(name, input);
const PostRepo = db.getRepository('Post');
const UserRepo = db.getRepository('User');

let createCounter = 0;

describe('Services (fullstack-app)', () => {
  bench('post.list — validate + paginate + include(author, category)', async () => {
    await service('post.list', { page: 2, perPage: 10 });
  });

  bench('post.getBySlug — include(author, category, comments)', async () => {
    await service('post.getBySlug', { slug: samplePost.slug });
  });

  bench('stats.overview — memoized (cache hit)', async () => {
    await service('stats.overview', {});
  });

  bench('post.create — ACID transaction + event + queue dispatch', async () => {
    createCounter += 1;
    await service('post.create', {
      title: `Service bench ${createCounter}`,
      body: 'Service benchmark body',
      categoryId: samplePost.category_id,
      authorId: samplePost.author_id,
    });
  });
});

describe('ORM repositories (fullstack-app)', () => {
  bench('Post.findById — query cache (auto)', async () => {
    await PostRepo.findById(samplePost.id);
  });

  bench('Post.findOne({ slug })', async () => {
    await PostRepo.findOne({ slug: samplePost.slug });
  });

  bench('Post.query().where().orderBy().paginate()', async () => {
    await PostRepo.query().where('status', 'published').orderBy('published_at', 'desc').paginate({ page: 3, perPage: 20 });
  });

  bench('Post.query().include(author, category, comments).limit(20)', async () => {
    await PostRepo.query().include('author', 'category', 'comments').limit(20).find();
  });

  bench('User.query().include(posts) — hasMany batch loading', async () => {
    await UserRepo.query().include('posts').find();
  });

  bench('Post.count({ status })', async () => {
    await PostRepo.count({ status: 'published' });
  });

  bench('db.transaction — update inside ambient transaction', async () => {
    await db.transaction(async () => {
      await PostRepo.update(samplePost.id, { views: createCounter });
    });
  });
});

