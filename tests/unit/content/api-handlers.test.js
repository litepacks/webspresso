/**
 * Unit tests for Content Plugin API Handlers
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createContentApiHandlers } from '../../../plugins/content/api-handlers';
import { createMockSpyRes } from '../../utils/http.js';

describe('Content API Handlers', () => {
  let mockContentService;
  let handlers;

  beforeEach(() => {
    mockContentService = {
      listTypes: vi.fn(),
      createType: vi.fn(),
      getTypeById: vi.fn(),
      getTypeBySlug: vi.fn(),
      updateType: vi.fn(),
      deleteType: vi.fn(),
      listEntries: vi.fn(),
      createEntry: vi.fn(),
      getEntryById: vi.fn(),
      getEntry: vi.fn(),
      updateEntry: vi.fn(),
      deleteEntry: vi.fn(),
    };

    handlers = createContentApiHandlers({ contentService: mockContentService });
  });

  const createMockRes = () => createMockSpyRes();

  describe('Content Types API Handlers', () => {
    it('listTypesHandler returns data array on success', async () => {
      mockContentService.listTypes.mockResolvedValue([{ id: 1, name: 'Article', slug: 'articles' }]);
      const res = createMockRes();

      await handlers.listTypesHandler({}, res);

      expect(mockContentService.listTypes).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ data: [{ id: 1, name: 'Article', slug: 'articles' }] });
    });

    it('listTypesHandler forwards errors via sendError', async () => {
      mockContentService.listTypes.mockRejectedValue(new Error('Database timeout'));
      const res = createMockRes();

      await handlers.listTypesHandler({}, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Database timeout' });
    });

    it('createTypeHandler returns 201 with created type', async () => {
      const payload = { name: 'Post', slug: 'posts', schema: {} };
      mockContentService.createType.mockResolvedValue({ id: 2, ...payload });
      const res = createMockRes();

      await handlers.createTypeHandler({ body: payload }, res);

      expect(mockContentService.createType).toHaveBeenCalledWith(payload);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ data: { id: 2, ...payload } });
    });

    it('getTypeHandler returns type when found', async () => {
      mockContentService.getTypeById.mockResolvedValue({ id: 5, name: 'Product', slug: 'products' });
      const res = createMockRes();

      await handlers.getTypeHandler({ params: { id: 5 } }, res);

      expect(mockContentService.getTypeById).toHaveBeenCalledWith(5);
      expect(res.json).toHaveBeenCalledWith({ data: { id: 5, name: 'Product', slug: 'products' } });
    });

    it('getTypeHandler returns 404 when type is not found', async () => {
      mockContentService.getTypeById.mockResolvedValue(null);
      const res = createMockRes();

      await handlers.getTypeHandler({ params: { id: 99 } }, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Content type not found' });
    });

    it('updateTypeHandler updates type and returns result', async () => {
      mockContentService.updateType.mockResolvedValue({ id: 3, name: 'Updated' });
      const res = createMockRes();

      await handlers.updateTypeHandler({ params: { id: 3 }, body: { name: 'Updated' } }, res);

      expect(mockContentService.updateType).toHaveBeenCalledWith(3, { name: 'Updated' });
      expect(res.json).toHaveBeenCalledWith({ data: { id: 3, name: 'Updated' } });
    });

    it('deleteTypeHandler deletes type and returns success', async () => {
      mockContentService.deleteType.mockResolvedValue();
      const res = createMockRes();

      await handlers.deleteTypeHandler({ params: { id: 4 } }, res);

      expect(mockContentService.deleteType).toHaveBeenCalledWith(4);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('getTypeSchemaHandler returns schema information', async () => {
      mockContentService.getTypeBySlug.mockResolvedValue({
        slug: 'pages',
        name: 'Pages',
        schema: { fields: [] },
      });
      const res = createMockRes();

      await handlers.getTypeSchemaHandler({ params: { typeSlug: 'pages' } }, res);

      expect(res.json).toHaveBeenCalledWith({
        data: { slug: 'pages', name: 'Pages', schema: { fields: [] } },
      });
    });

    it('getTypeSchemaHandler returns 404 when slug does not exist', async () => {
      mockContentService.getTypeBySlug.mockResolvedValue(null);
      const res = createMockRes();

      await handlers.getTypeSchemaHandler({ params: { typeSlug: 'missing' } }, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Content type not found' });
    });
  });

  describe('Content Entries API Handlers', () => {
    it('listEntriesHandler passes query parameters to service', async () => {
      mockContentService.listEntries.mockResolvedValue([{ id: 10, title: 'Hello' }]);
      const res = createMockRes();

      await handlers.listEntriesHandler(
        { params: { typeSlug: 'articles' }, query: { status: 'published', locale: 'en' } },
        res
      );

      expect(mockContentService.listEntries).toHaveBeenCalledWith('articles', {
        status: 'published',
        locale: 'en',
      });
      expect(res.json).toHaveBeenCalledWith({ data: [{ id: 10, title: 'Hello' }] });
    });

    it('createEntryHandler returns 201 with created entry', async () => {
      mockContentService.createEntry.mockResolvedValue({ id: 20, slug: 'first-entry' });
      const res = createMockRes();

      await handlers.createEntryHandler(
        { params: { typeSlug: 'articles' }, body: { title: 'First Entry' } },
        res
      );

      expect(mockContentService.createEntry).toHaveBeenCalledWith('articles', { title: 'First Entry' });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ data: { id: 20, slug: 'first-entry' } });
    });

    it('getEntryHandler returns entry and type bundle', async () => {
      mockContentService.getEntryById.mockResolvedValue({
        entry: { id: 30, title: 'Sample' },
        type: { slug: 'articles', name: 'Articles' },
      });
      const res = createMockRes();

      await handlers.getEntryHandler({ params: { id: 30 } }, res);

      expect(mockContentService.getEntryById).toHaveBeenCalledWith(30);
      expect(res.json).toHaveBeenCalledWith({
        data: { id: 30, title: 'Sample' },
        type: { slug: 'articles', name: 'Articles' },
      });
    });

    it('getEntryHandler returns 404 when entry does not exist', async () => {
      mockContentService.getEntryById.mockResolvedValue(null);
      const res = createMockRes();

      await handlers.getEntryHandler({ params: { id: 999 } }, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Content entry not found' });
    });

    it('updateEntryHandler updates entry and returns result', async () => {
      mockContentService.updateEntry.mockResolvedValue({ id: 40, title: 'Updated Title' });
      const res = createMockRes();

      await handlers.updateEntryHandler({ params: { id: 40 }, body: { title: 'Updated Title' } }, res);

      expect(mockContentService.updateEntry).toHaveBeenCalledWith(40, { title: 'Updated Title' });
      expect(res.json).toHaveBeenCalledWith({ data: { id: 40, title: 'Updated Title' } });
    });

    it('deleteEntryHandler deletes entry and returns success', async () => {
      mockContentService.deleteEntry.mockResolvedValue();
      const res = createMockRes();

      await handlers.deleteEntryHandler({ params: { id: 50 } }, res);

      expect(mockContentService.deleteEntry).toHaveBeenCalledWith(50);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('publicGetEntryHandler returns public view of content entry', async () => {
      mockContentService.getEntry.mockResolvedValue({
        meta: { typeSlug: 'blog', slug: 'my-post' },
        data: { title: 'My Post', body: 'Post content' },
      });
      const res = createMockRes();

      await handlers.publicGetEntryHandler(
        { params: { typeSlug: 'blog', entrySlug: 'my-post' }, query: { locale: 'tr' } },
        res
      );

      expect(mockContentService.getEntry).toHaveBeenCalledWith('blog', 'my-post', { locale: 'tr' });
      expect(res.json).toHaveBeenCalledWith({
        type: 'blog',
        slug: 'my-post',
        data: { title: 'My Post', body: 'Post content' },
        meta: { typeSlug: 'blog', slug: 'my-post' },
      });
    });

    it('publicGetEntryHandler returns 404 when entry is not found', async () => {
      mockContentService.getEntry.mockResolvedValue(null);
      const res = createMockRes();

      await handlers.publicGetEntryHandler(
        { params: { typeSlug: 'blog', entrySlug: 'unknown' }, query: {} },
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Content not found' });
    });

    it('sendError returns 404 status when error message includes not found', async () => {
      mockContentService.listEntries.mockRejectedValue(new Error('Resource not found in storage'));
      const res = createMockRes();

      await handlers.listEntriesHandler({ params: { typeSlug: 'test' }, query: {} }, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Resource not found in storage' });
    });

    it('sendError handles undefined error object with fallback message', async () => {
      mockContentService.deleteEntry.mockRejectedValue(null);
      const res = createMockRes();

      await handlers.deleteEntryHandler({ params: { id: 1 } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Request failed' });
    });
  });
});
