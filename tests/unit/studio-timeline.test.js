import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRequestTimelineStore,
  resetRequestTimelineStore,
} from '../../plugins/studio/services/request-timeline.js';

describe('studio request timeline', () => {
  beforeEach(() => {
    resetRequestTimelineStore();
  });

  it('caps ring buffer at maxEntries', () => {
    const store = createRequestTimelineStore({
      requestTimeline: { maxEntries: 3 },
    });
    for (let i = 0; i < 10; i++) {
      store.push({ path: `/r${i}` });
    }
    expect(store.getAll()).toHaveLength(3);
    expect(store.getAll()[0].path).toBe('/r9');
  });
});
