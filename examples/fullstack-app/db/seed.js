'use strict';

/**
 * Deterministic seed data (repository API only — no raw table queries).
 *
 * Volumes are configurable so benchmarks can exercise realistic table sizes.
 */
const { auth } = require('../lib/webspresso');

const CATEGORY_NAMES = ['Engineering', 'Product', 'Design', 'Performance', 'Security', 'Release Notes'];

const LOREM =
  'Webspresso renders HTML on the server, validates every request with Zod, and keeps business ' +
  'logic inside transactional services. This paragraph is repeated to give templates and JSON ' +
  'serializers a realistic payload size. ';

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * @param {import('../../../core/orm/types').DatabaseInstance} db
 * @param {{ users?: number, posts?: number, commentsPerPost?: number, password?: string }} [opts]
 */
async function seed(db, opts = {}) {
  const userCount = opts.users ?? 10;
  const postCount = opts.posts ?? 200;
  const commentsPerPost = opts.commentsPerPost ?? 3;
  const password = opts.password ?? 'secret-password';

  const UserRepo = db.getRepository('User');
  const CategoryRepo = db.getRepository('Category');
  const PostRepo = db.getRepository('Post');
  const CommentRepo = db.getRepository('Comment');

  // Hash once; every seeded account shares the same demo password.
  const passwordHash = await auth.hash(password);

  return db.transaction(async () => {
    const users = await UserRepo.createMany(
      Array.from({ length: userCount }, (_, i) => ({
        email: i === 0 ? 'admin@example.com' : `author${i}@example.com`,
        name: i === 0 ? 'Admin' : `Author ${i}`,
        password: passwordHash,
        role: i === 0 ? 'admin' : 'author',
      }))
    );

    const categories = await CategoryRepo.createMany(
      CATEGORY_NAMES.map((name) => ({ name, slug: slugify(name) }))
    );

    const userIds = (await UserRepo.find()).map((u) => u.id);
    const categoryIds = (await CategoryRepo.find()).map((c) => c.id);
    const baseTime = Date.UTC(2026, 0, 1);

    await PostRepo.createMany(
      Array.from({ length: postCount }, (_, i) => {
        const title = `Building fast server-rendered apps, part ${i + 1}`;
        const published = i % 5 !== 0; // 80% published, 20% drafts
        return {
          title,
          slug: `${slugify(title)}-${i + 1}`,
          excerpt: LOREM.slice(0, 160),
          body: LOREM.repeat(8),
          status: published ? 'published' : 'draft',
          views: (i * 37) % 1000,
          author_id: userIds[i % userIds.length],
          category_id: categoryIds[i % categoryIds.length],
          published_at: published ? new Date(baseTime + i * 3_600_000) : null,
        };
      })
    );

    const postIds = (await PostRepo.find()).map((p) => p.id);
    const comments = [];
    for (const postId of postIds) {
      for (let c = 0; c < commentsPerPost; c++) {
        comments.push({ post_id: postId, author_name: `Reader ${c + 1}`, body: 'Great write-up, thanks!' });
      }
    }
    if (comments.length) await CommentRepo.createMany(comments);

    return {
      users: users.length || userIds.length,
      categories: categories.length || categoryIds.length,
      posts: postIds.length,
      comments: comments.length,
    };
  });
}

module.exports = { seed, slugify };

