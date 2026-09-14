/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { parseRouteAndMethod } from '../../../bin/commands/api.js';

describe('API CLI helpers', () => {
  it('parses route and method from suffix or arguments', () => {
    expect(parseRouteAndMethod('users.get')).toEqual({
      route: 'users',
      method: 'GET',
    });

    expect(parseRouteAndMethod('notes.post.js')).toEqual({
      route: 'notes',
      method: 'POST',
    });

    expect(parseRouteAndMethod('/api/products/[id].delete')).toEqual({
      route: 'products/[id]',
      method: 'DELETE',
    });

    expect(parseRouteAndMethod('orders', 'PUT')).toEqual({
      route: 'orders',
      method: 'PUT',
    });

    expect(parseRouteAndMethod('/api/items')).toEqual({
      route: 'items',
      method: 'GET',
    });
  });
});
