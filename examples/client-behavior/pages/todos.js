'use strict';

const { defineFragment } = require('../../../core/client');
const {
  queryTodos,
  getTodoById,
  getSharedWorkspaceSnapshot,
  getActivityFeed,
  metrics,
  serverHooks,
} = require('../store');

module.exports = {
  async load({ req, query, ctx }) {
    const isDev =
      req && req.app && req.app.locals && req.app.locals.isDev !== undefined
        ? Boolean(req.app.locals.isDev)
        : process.env.NODE_ENV !== 'production';
    const search = typeof query.search === 'string' ? query.search : '';
    const status = typeof query.status === 'string' ? query.status : 'all';
    const priority = typeof query.priority === 'string' ? query.priority : 'all';
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const limit = Number(query.limit) > 0 ? Number(query.limit) : 4;

    const overview = await ctx.memo('todos:overview', () => getSharedWorkspaceSnapshot());
    const data = await ctx.memo(
      `todos:${search}:${status}:${priority}:${page}:${limit}`,
      () => queryTodos({ search, status, priority, page, limit })
    );

    const initialEditTodo = getTodoById(3) || {
      id: 3,
      title: 'Preserve unsaved draft and cursor focus during list refresh',
      priority: 'high',
      category: 'frontend',
      notes: 'In-place DOM morphing keeps active form inputs and cursor position intact while fragments refresh.',
    };

    return {
      pageTitle: 'Client Behavior Stress Lab & Todo Workspace',
      isDev,
      initialSearch: search,
      initialStatus: status,
      initialPriority: priority,
      initialPage: page,
      initialEditTodo,
      activity: overview.activity,
      sharedSnapshotCount: overview.computedCount,
      ...data,
    };
  },

  fragments: {
    summary: defineFragment({
      template: 'partials/todos-summary.njk',
      dependsOn: ['todos'],
      staleTime: '5s',
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      async load({ input, memo }) {
        metrics.summaryLoaderCalls += 1;
        if (typeof serverHooks.beforeFragmentLoad === 'function') {
          await serverHooks.beforeFragmentLoad('summary', input);
        }
        const overview = await memo('todos:overview', () => getSharedWorkspaceSnapshot());
        return {
          summary: overview.summary,
          sharedSnapshotCount: overview.computedCount,
          initialSearch: '',
          initialStatus: 'all',
          initialPriority: 'all',
          initialPage: 1,
        };
      },
    }),

    list: defineFragment({
      template: 'partials/todos-list.njk',
      dependsOn: ['todos'],
      staleTime: '5s',
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      schema: ({ z }) => ({
        search: z.string().max(100).optional().default(''),
        status: z.enum(['all', 'active', 'completed']).optional().default('all'),
        priority: z.enum(['all', 'high', 'medium', 'low']).optional().default('all'),
        page: z.coerce.number().int().min(1).max(1000).optional().default(1),
        limit: z.coerce.number().int().min(1).max(50).optional().default(4),
      }),
      async load({ input, memo }) {
        metrics.listLoaderCalls += 1;
        if (typeof serverHooks.beforeFragmentLoad === 'function') {
          await serverHooks.beforeFragmentLoad('list', input);
        }
        const result = await memo(
          `todos:${input.search || ''}:${input.status || 'all'}:${input.priority || 'all'}:${input.page || 1}:${input.limit || 4}`,
          () =>
            queryTodos({
              search: input.search || '',
              status: input.status || 'all',
              priority: input.priority || 'all',
              page: input.page || 1,
              limit: input.limit || 4,
            })
        );
        return result;
      },
    }),

    activity: defineFragment({
      template: 'partials/todos-activity.njk',
      dependsOn: ['todos'],
      staleTime: '5s',
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      schema: ({ z }) => ({
        limit: z.coerce.number().int().min(1).max(30).optional().default(6),
      }),
      async load({ input, memo }) {
        metrics.activityLoaderCalls += 1;
        if (typeof serverHooks.beforeFragmentLoad === 'function') {
          await serverHooks.beforeFragmentLoad('activity', input);
        }
        const overview = await memo('todos:overview', () => getSharedWorkspaceSnapshot());
        const feed =
          input.limit && input.limit !== 6
            ? getActivityFeed({ limit: input.limit })
            : overview.activity;
        return {
          activity: feed,
          summary: overview.summary,
          sharedSnapshotCount: overview.computedCount,
        };
      },
    }),
  },
};

