'use strict';

const { defineFragment } = require('../../../core/client');
const { queryTodos, getTodosSummary } = require('../store');

module.exports = {
  async load({ query, ctx }) {
    const search = typeof query.search === 'string' ? query.search : '';
    const status = typeof query.status === 'string' ? query.status : 'all';
    const priority = typeof query.priority === 'string' ? query.priority : 'all';
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const limit = Number(query.limit) > 0 ? Number(query.limit) : 4;

    const data = await ctx.memo(
      `todos:${search}:${status}:${priority}:${page}:${limit}`,
      () => queryTodos({ search, status, priority, page, limit })
    );

    return {
      pageTitle: 'SSR + Datastar Todo List',
      initialSearch: search,
      initialStatus: status,
      initialPriority: priority,
      initialPage: page,
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
      async load({ memo }) {
        const summary = await memo('todos:summary', () => getTodosSummary());
        return { summary };
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
  },
};

