/**
 * Repository and query builder results must not serialize the model's hidden columns,
 * while keeping them readable in code (e.g. password hash checks during login).
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const { createDatabase, defineModel, zdb } = require('../../../index');
const { clearRegistry } = require('../../../core/orm/model');

describe('hidden column serialization', () => {
  let db;
  let users;

  beforeEach(async () => {
    clearRegistry();
    db = createDatabase({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    defineModel({
      name: 'HsUser',
      table: 'hs_users',
      hidden: ['password'],
      schema: { id: zdb.id(), email: zdb.string(100), password: zdb.string(100) },
      relations: { posts: { type: 'hasMany', model: 'HsPost', foreignKey: 'userId' } },
    });
    defineModel({
      name: 'HsPost',
      table: 'hs_posts',
      hidden: ['secretNote'],
      schema: { id: zdb.id(), userId: zdb.integer(), title: zdb.string(100), secretNote: zdb.string(100) },
      relations: { author: { type: 'belongsTo', model: 'HsUser', foreignKey: 'userId' } },
    });
    await db.knex.schema.createTable('hs_users', (t) => { t.increments('id'); t.string('email'); t.string('password'); });
    await db.knex.schema.createTable('hs_posts', (t) => {
      t.increments('id'); t.integer('userId'); t.string('title'); t.string('secretNote');
    });
    users = db.getRepository('HsUser');
  });

  afterEach(async () => {
    await db.knex.destroy();
    clearRegistry();
  });

  it('omits hidden columns from JSON but keeps them on the record', async () => {
    const created = await users.create({ email: 'a@b.c', password: 'hash-1' });
    expect(created.password).toBe('hash-1');
    expect(JSON.parse(JSON.stringify(created))).toEqual({ id: created.id, email: 'a@b.c' });

    const results = {
      findById: await users.findById(created.id),
      findOne: await users.findOne({ email: 'a@b.c' }),
      first: await users.query().where({ email: 'a@b.c' }).first(),
    };
    for (const [name, record] of Object.entries(results)) {
      expect(record.password, name).toBe('hash-1');
      expect(JSON.stringify(record), name).not.toContain('hash-1');
    }

    for (const list of [await users.find(), await users.findAll(), await users.query().find()]) {
      expect(JSON.stringify(list)).not.toContain('hash-1');
      expect(list[0].password).toBe('hash-1');
    }

    const page = await users.query().paginate(1, 10);
    expect(JSON.stringify(page)).not.toContain('hash-1');
    expect(page.total).toBe(1);

    const updated = await users.update(created.id, { email: 'new@b.c' });
    if (updated && typeof updated === 'object') {
      expect(JSON.stringify(updated)).not.toContain('hash-1');
    }
  });

  it('applies each related model\'s hidden columns to eager-loaded relations', async () => {
    const user = await users.create({ email: 'a@b.c', password: 'hash-2' });
    await db.getRepository('HsPost').create({ userId: user.id, title: 'hello', secretNote: 'internal-note' });

    const [withPosts] = await users.query().include('posts').find();
    const json = JSON.stringify(withPosts);
    expect(json).toContain('hello');
    expect(json).not.toContain('hash-2');
    expect(json).not.toContain('internal-note');
    expect(withPosts.posts[0].secretNote).toBe('internal-note');

    const [post] = await db.getRepository('HsPost').query().include('author').find();
    expect(JSON.stringify(post)).not.toContain('hash-2');
    expect(post.author.password).toBe('hash-2');
  });

  it('does not enumerate the serializer as a column', async () => {
    const created = await users.create({ email: 'a@b.c', password: 'x' });
    expect(Object.keys(created)).toEqual(['id', 'email', 'password']);
    expect({ ...created }.toJSON).toBeUndefined();
  });
});
