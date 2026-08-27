/**
 * Unit Tests for Redis Distributed Realtime Adapter
 * @module tests/unit/realtime/redis-adapter
 */

const {
  RedisAdapter,
  createRedisAdapter,
  redis,
  InMemoryDistributedBus,
} = require('../../../core/realtime/adapters/redis');
const { createRealtime } = require('../../../core/realtime');

describe('Redis Distributed Realtime Adapter (core/realtime/adapters/redis)', () => {
  describe('Initialization & Capabilities', () => {
    it('should initialize with default options and distributed capability', () => {
      const adapter = createRedisAdapter();
      expect(adapter).toBeInstanceOf(RedisAdapter);
      expect(adapter.capabilities.distributed).toBe(true);
      expect(adapter.capabilities.send).toBe(true);
      expect(adapter.capabilities.perform).toBe(true);
      expect(adapter.capabilities.multiplexing).toBe(true);
      expect(adapter.capabilities.serverEvents).toBe(true);
      expect(adapter.channelPrefix).toBe('webspresso:rt:');
      expect(typeof adapter.nodeId).toBe('string');
      expect(adapter.isInMemory).toBe(true);
    });

    it('should respect custom channelPrefix and nodeId', () => {
      const adapter = createRedisAdapter({
        channelPrefix: 'myapp:events:',
        nodeId: 'worker_1',
      });
      expect(adapter.channelPrefix).toBe('myapp:events:');
      expect(adapter.nodeId).toBe('worker_1');
      expect(adapter._resolveChannel('chat')).toBe('myapp:events:chat');
    });
  });

  describe('Multi-Node In-Memory Simulation (Cluster Emulation)', () => {
    let bus;
    let nodeA;
    let nodeB;
    let nodeC;

    beforeEach(async () => {
      bus = new InMemoryDistributedBus();
      nodeA = createRedisAdapter({ inMemoryBus: bus, nodeId: 'node_a', inMemory: true });
      nodeB = createRedisAdapter({ inMemoryBus: bus, nodeId: 'node_b', inMemory: true });
      nodeC = createRedisAdapter({ inMemoryBus: bus, nodeId: 'node_c', inMemory: true });

      await nodeA.connect();
      await nodeB.connect();
      await nodeC.connect();
    });

    afterEach(async () => {
      await nodeA.destroy();
      await nodeB.destroy();
      await nodeC.destroy();
    });

    it('should distribute broadcast messages across multiple cluster nodes', async () => {
      const receivedNodeA = [];
      const receivedNodeC = [];

      nodeA.subscribe('room:lobby', {}, {
        received: (data, envelope) => receivedNodeA.push({ data, envelope }),
      });

      nodeC.subscribe('room:lobby', {}, {
        received: (data, envelope) => receivedNodeC.push({ data, envelope }),
      });

      // Node B broadcasts to room:lobby
      await nodeB.publish('room:lobby', { text: 'Hello from Node B!' });

      expect(receivedNodeA.length).toBe(1);
      expect(receivedNodeA[0].data).toEqual({ text: 'Hello from Node B!' });
      expect(receivedNodeA[0].envelope.senderId).toBe('node_b');
      expect(receivedNodeA[0].envelope.type).toBe('message');

      expect(receivedNodeC.length).toBe(1);
      expect(receivedNodeC[0].data).toEqual({ text: 'Hello from Node B!' });
    });

    it('should distribute RPC actions across cluster nodes', async () => {
      const actionsNodeA = [];

      nodeA.subscribe('editor:doc1', {}, {
        action: (actionName, data, envelope) => actionsNodeA.push({ actionName, data, envelope }),
      });

      // Node B dispatches an action
      await nodeB.perform('editor:doc1', 'cursor_move', { x: 120, y: 340, user: 'Bob' });

      expect(actionsNodeA.length).toBe(1);
      expect(actionsNodeA[0].actionName).toBe('cursor_move');
      expect(actionsNodeA[0].data).toEqual({ x: 120, y: 340, user: 'Bob' });
      expect(actionsNodeA[0].envelope.senderId).toBe('node_b');
    });

    it('should stop receiving messages after unsubscribing', async () => {
      const received = [];
      const sub = nodeA.subscribe('alerts', {}, {
        received: (data) => received.push(data),
      });

      await nodeB.publish('alerts', { alert: 'first' });
      expect(received.length).toBe(1);

      sub.unsubscribe();

      await nodeB.publish('alerts', { alert: 'second' });
      expect(received.length).toBe(1); // not incremented
    });
  });

  describe('Mock Redis Client Pub/Sub Lifecycle', () => {
    let mockPubClient;
    let mockSubClient;
    let subListeners;
    let publishedCalls;
    let subCalls;
    let unsubCalls;

    beforeEach(() => {
      subListeners = new Map();
      publishedCalls = [];
      subCalls = [];
      unsubCalls = [];

      mockPubClient = {
        publish: async (channel, rawMessage) => {
          publishedCalls.push({ channel, rawMessage });
        },
      };

      mockSubClient = {
        on: (event, handler) => {
          if (!subListeners.has(event)) subListeners.set(event, new Set());
          subListeners.get(event).add(handler);
        },
        subscribe: (channel) => {
          subCalls.push(channel);
        },
        unsubscribe: (channel) => {
          unsubCalls.push(channel);
        },
      };
    });

    it('should wire subClient message events and publish via pubClient', async () => {
      const adapter = createRedisAdapter({
        pubClient: mockPubClient,
        subClient: mockSubClient,
        channelPrefix: 'custom:rt:',
      });

      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);

      const received = [];
      const sub = adapter.subscribe('topic:tech', {}, {
        received: (data) => received.push(data),
      });

      expect(subCalls).toContain('custom:rt:topic:tech');

      // Publish via subscription send
      await sub.send({ update: 'v1.0' });
      expect(publishedCalls.length).toBe(1);
      expect(publishedCalls[0].channel).toBe('custom:rt:topic:tech');
      const payload = JSON.parse(publishedCalls[0].rawMessage);
      expect(payload.data).toEqual({ update: 'v1.0' });
      expect(payload.type).toBe('message');

      // Simulate incoming message event from Redis subClient
      const messageHandlers = subListeners.get('message');
      expect(messageHandlers).toBeDefined();

      for (const handler of messageHandlers) {
        handler('custom:rt:topic:tech', JSON.stringify({
          type: 'message',
          identifier: 'topic:tech',
          data: { fromRemote: true },
          senderId: 'remote_node',
        }));
      }

      expect(received.length).toBe(1);
      expect(received[0]).toEqual({ fromRemote: true });

      // Unsubscribe
      sub.unsubscribe();
      expect(unsubCalls).toContain('custom:rt:topic:tech');

      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('should support duplicate() on redis instance option', async () => {
      const duplicatedSubClient = {
        on: () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        quit: async () => {},
      };

      const mockRedis = {
        publish: async () => {},
        duplicate: () => duplicatedSubClient,
        quit: async () => {},
      };

      const adapter = createRedisAdapter({
        redis: mockRedis,
      });

      await adapter.connect();
      expect(adapter.pubClient).toBe(mockRedis);
      expect(adapter.subClient).toBe(duplicatedSubClient);

      await adapter.destroy();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe('RealtimeClient Integration', () => {
    it('should integrate seamlessly with createRealtime client', async () => {
      const bus = new InMemoryDistributedBus();
      const adapter = redis({ inMemoryBus: bus, inMemory: true });

      const client = createRealtime({
        adapter,
        isBrowser: true, // Force browser environment simulation
      });

      await client.connect();
      expect(client.isConnected()).toBe(true);

      const received = [];
      const sub = client.subscribe('notifications', {}, {
        received: (data) => received.push(data),
      });

      // Broadcast directly via adapter
      await adapter.publish('notifications', { title: 'System alert' });

      expect(received.length).toBe(1);
      expect(received[0]).toEqual({ title: 'System alert' });

      sub.unsubscribe();
      client.destroy();
    });
  });
});
