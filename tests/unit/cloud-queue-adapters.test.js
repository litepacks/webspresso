'use strict';

/**
 * Cloud Native Queue Adapters Unit Tests
 * Tests SqsQueueAdapter (AWS SQS) and PubSubQueueAdapter (Google Cloud Pub/Sub)
 */

const {
  Job,
  QueueManager,
  createQueueManager,
  SqsQueueAdapter,
  PubSubQueueAdapter,
} = require('../../core/queue');
const { makeSqsRequest } = require('../../core/queue/adapters/sqs');
const { makePubSubRequest } = require('../../core/queue/adapters/pubsub');

describe('Cloud Native Queue Adapters', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ====================================================
  // 1. AWS SQS Queue Adapter
  // ====================================================
  describe('SqsQueueAdapter (AWS SQS)', () => {
    it('throws if neither queueUrl nor sqsClient is provided', () => {
      expect(() => new SqsQueueAdapter({})).toThrow(/Requires queueUrl or an initialized sqsClient/);
    });

    it('extracts AWS region from queueUrl or environment', () => {
      const adapter1 = new SqsQueueAdapter({
        queueUrl: 'https://sqs.eu-central-1.amazonaws.com/123456789012/test-queue',
      });
      expect(adapter1.region).toBe('eu-central-1');

      process.env.AWS_REGION = 'ap-southeast-1';
      const adapter2 = new SqsQueueAdapter({
        queueUrl: 'https://custom-domain.com/queue',
      });
      expect(adapter2.region).toBe('ap-southeast-1');
    });

    it('enqueues job with zero-dependency REST request and calculates delay seconds', async () => {
      let capturedUrl = null;
      let capturedOptions = null;

      const mockTransport = vi.fn().mockImplementation((url, opts) => {
        capturedUrl = url;
        capturedOptions = opts;
        return Promise.resolve({
          statusCode: 200,
          data: '{"MessageId":"sqs-msg-123"}',
          json: { MessageId: 'sqs-msg-123' },
        });
      });

      const adapter = new SqsQueueAdapter({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        httpTransport: mockTransport,
      });

      const futureDate = new Date(Date.now() + 60000); // 60 seconds from now
      const job = new Job({
        name: 'invoice.generate',
        data: { invoiceId: 42 },
        priority: 15,
        runAt: futureDate,
      });

      const enqueued = await adapter.enqueue(job);

      expect(mockTransport).toHaveBeenCalledTimes(1);
      expect(capturedUrl).toBe('https://sqs.us-east-1.amazonaws.com/123456789012/test-queue');
      expect(capturedOptions.headers['x-amz-target']).toBe('AmazonSQS.SendMessage');
      expect(capturedOptions.headers.authorization).toContain('AWS4-HMAC-SHA256');

      const body = JSON.parse(capturedOptions.body);
      expect(body.DelaySeconds).toBeGreaterThanOrEqual(58);
      expect(body.DelaySeconds).toBeLessThanOrEqual(60);
      expect(body.MessageAttributes.JobName.StringValue).toBe('invoice.generate');

      const parsedPayload = JSON.parse(body.MessageBody);
      expect(parsedPayload.name).toBe('invoice.generate');
      expect(parsedPayload.data.invoiceId).toBe(42);
      expect(enqueued._sqsMessageId).toBe('sqs-msg-123');
    });

    it('dequeues job, tracks receipt handle, and filters by jobNames', async () => {
      const mockMessages = [
        {
          MessageId: 'msg-456',
          ReceiptHandle: 'receipt-handle-abc',
          Body: JSON.stringify({
            id: 'job-99',
            name: 'email.welcome',
            data: { email: 'user@example.com' },
            attempts: 0,
            priority: 20,
          }),
        },
      ];

      const mockTransport = vi.fn().mockImplementation((url, opts) => {
        const target = opts.headers['x-amz-target'];
        if (target === 'AmazonSQS.ReceiveMessage') {
          return Promise.resolve({
            statusCode: 200,
            json: { Messages: mockMessages },
          });
        }
        if (target === 'AmazonSQS.ChangeMessageVisibility') {
          return Promise.resolve({
            statusCode: 200,
            json: {},
          });
        }
        return Promise.resolve({ statusCode: 200, json: {} });
      });

      const adapter = new SqsQueueAdapter({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        httpTransport: mockTransport,
      });

      // Mismatched job name returns null and releases visibility
      const mismatch = await adapter.dequeue(['other.job']);
      expect(mismatch).toBeNull();
      expect(mockTransport).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-amz-target': 'AmazonSQS.ChangeMessageVisibility',
          }),
        })
      );

      // Matched job name returns Job instance
      mockTransport.mockClear();
      const job = await adapter.dequeue(['email.welcome']);
      expect(job).not.toBeNull();
      expect(job.id).toBe('job-99');
      expect(job.name).toBe('email.welcome');
      expect(job.status).toBe('running');
      expect(job.attempts).toBe(1);
      expect(job._receiptHandle).toBe('receipt-handle-abc');
      expect(adapter.receiptHandles.get('job-99')).toBe('receipt-handle-abc');
    });

    it('completes, fails, and retries jobs by calling DeleteMessage / ChangeMessageVisibility', async () => {
      const calls = [];
      const mockTransport = vi.fn().mockImplementation((url, opts) => {
        calls.push(opts.headers['x-amz-target']);
        return Promise.resolve({ statusCode: 200, json: {} });
      });

      const adapter = new SqsQueueAdapter({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        httpTransport: mockTransport,
      });

      // Complete
      adapter.receiptHandles.set('job-1', 'receipt-1');
      const completed = await adapter.complete('job-1', { ok: true });
      expect(completed.status).toBe('completed');
      expect(completed.result).toEqual({ ok: true });
      expect(adapter.receiptHandles.has('job-1')).toBe(false);
      expect(calls[0]).toBe('AmazonSQS.DeleteMessage');

      // Fail
      adapter.receiptHandles.set('job-2', 'receipt-2');
      const failed = await adapter.fail('job-2', new Error('Permanent failure'));
      expect(failed.status).toBe('failed');
      expect(adapter.receiptHandles.has('job-2')).toBe(false);
      expect(calls[1]).toBe('AmazonSQS.DeleteMessage');

      // Retry
      adapter.receiptHandles.set('job-3', 'receipt-3');
      const retrying = await adapter.retry('job-3', 15000, new Error('Transient failure'));
      expect(retrying.status).toBe('pending');
      expect(adapter.receiptHandles.has('job-3')).toBe(false);
      expect(calls[2]).toBe('AmazonSQS.ChangeMessageVisibility');
    });

    it('retrieves queue statistics via GetQueueAttributes', async () => {
      const mockTransport = vi.fn().mockResolvedValue({
        statusCode: 200,
        json: {
          Attributes: {
            ApproximateNumberOfMessages: '5',
            ApproximateNumberOfMessagesNotVisible: '2',
            ApproximateNumberOfMessagesDelayed: '1',
          },
        },
      });

      const adapter = new SqsQueueAdapter({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        httpTransport: mockTransport,
      });

      const stats = await adapter.getStats();
      expect(stats.pending).toBe(5);
      expect(stats.running).toBe(2);
      expect(stats.delayed).toBe(1);
      expect(stats.total).toBe(8);
    });

    it('processes AWS Lambda SQS event batch via processBatch()', async () => {
      const queueManager = createQueueManager();
      const executed = [];

      queueManager.register('image.resize', async (job) => {
        executed.push(job.data);
        return { width: 800 };
      });

      const adapter = new SqsQueueAdapter({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
        accessKeyId: 'test',
        secretAccessKey: 'test',
      });

      const eventRecords = [
        {
          messageId: 'lambda-msg-1',
          body: JSON.stringify({
            id: 'job-img-1',
            name: 'image.resize',
            data: { path: '/tmp/1.jpg' },
          }),
        },
        {
          messageId: 'lambda-msg-2',
          body: JSON.stringify({
            id: 'job-img-2',
            name: 'unregistered.job',
            data: {},
          }),
        },
      ];

      const res = await adapter.processBatch(eventRecords, queueManager);
      expect(res.processed).toBe(1);
      expect(executed).toEqual([{ path: '/tmp/1.jpg' }]);
    });

    it('works with official / duck-typed @aws-sdk/client-sqs client', async () => {
      const sdkCommands = [];
      const mockSqsClient = {
        send: vi.fn().mockImplementation((cmd) => {
          sdkCommands.push(cmd);
          return Promise.resolve({
            MessageId: 'sdk-msg-999',
            Messages: [
              {
                MessageId: 'sdk-msg-999',
                ReceiptHandle: 'sdk-receipt',
                Body: JSON.stringify({ id: 'sdk-job', name: 'sync.data', data: {} }),
              },
            ],
          });
        }),
      };

      const adapter = new SqsQueueAdapter({
        queueUrl: 'https://sqs.us-west-2.amazonaws.com/123/queue',
        sqsClient: mockSqsClient,
      });

      const enqueued = await adapter.enqueue(new Job({ name: 'sync.data' }));
      expect(enqueued._sqsMessageId).toBe('sdk-msg-999');

      const dequeued = await adapter.dequeue();
      expect(dequeued.name).toBe('sync.data');
      expect(mockSqsClient.send).toHaveBeenCalledTimes(2);
    });
  });

  // ====================================================
  // 2. Google Cloud Pub/Sub Queue Adapter
  // ====================================================
  describe('PubSubQueueAdapter (Google Cloud Pub/Sub)', () => {
    it('normalizes topic and subscription resource names', () => {
      const adapter1 = new PubSubQueueAdapter({
        projectId: 'my-gcp-project',
        topic: 'orders-topic',
        subscription: 'orders-sub',
      });

      expect(adapter1.topic).toBe('projects/my-gcp-project/topics/orders-topic');
      expect(adapter1.subscription).toBe('projects/my-gcp-project/subscriptions/orders-sub');

      const adapter2 = new PubSubQueueAdapter({
        topic: 'projects/other-project/topics/custom-topic',
        subscription: 'projects/other-project/subscriptions/custom-sub',
      });

      expect(adapter2.topic).toBe('projects/other-project/topics/custom-topic');
      expect(adapter2.subscription).toBe('projects/other-project/subscriptions/custom-sub');
    });

    it('enqueues job by publishing base64 encoded message via zero-dependency REST', async () => {
      let capturedUrl = null;
      let capturedBody = null;

      const mockTransport = vi.fn().mockImplementation((url, opts) => {
        capturedUrl = url;
        capturedBody = JSON.parse(opts.body);
        return Promise.resolve({
          statusCode: 200,
          json: { messageIds: ['pubsub-msg-123'] },
        });
      });

      const adapter = new PubSubQueueAdapter({
        projectId: 'acme-corp',
        topic: 'task-queue',
        token: 'mock-oauth-token',
        httpTransport: mockTransport,
      });

      const job = new Job({
        name: 'report.export',
        data: { reportId: 77 },
        priority: 12,
      });

      const enqueued = await adapter.enqueue(job);

      expect(mockTransport).toHaveBeenCalledTimes(1);
      expect(capturedUrl).toBe('https://pubsub.googleapis.com/v1/projects/acme-corp/topics/task-queue:publish');
      expect(capturedBody.messages[0].attributes.jobName).toBe('report.export');

      const decodedPayload = JSON.parse(Buffer.from(capturedBody.messages[0].data, 'base64').toString('utf8'));
      expect(decodedPayload.name).toBe('report.export');
      expect(decodedPayload.data.reportId).toBe(77);
      expect(enqueued._pubsubMessageId).toBe('pubsub-msg-123');
    });

    it('dequeues job via :pull, decodes base64 data, and tracks ackId', async () => {
      const messagePayload = {
        id: 'job-pubsub-55',
        name: 'webhook.send',
        data: { url: 'https://example.com/hook' },
        attempts: 1,
      };

      const mockTransport = vi.fn().mockImplementation((url, opts) => {
        if (url.includes(':pull')) {
          return Promise.resolve({
            statusCode: 200,
            json: {
              receivedMessages: [
                {
                  ackId: 'ack-token-xyz',
                  message: {
                    messageId: 'msg-pubsub-1',
                    data: Buffer.from(JSON.stringify(messagePayload)).toString('base64'),
                    attributes: { jobName: 'webhook.send' },
                  },
                },
              ],
            },
          });
        }
        if (url.includes(':modifyAckDeadline')) {
          return Promise.resolve({ statusCode: 200, json: {} });
        }
        return Promise.resolve({ statusCode: 200, json: {} });
      });

      const adapter = new PubSubQueueAdapter({
        projectId: 'acme-corp',
        topic: 'task-queue',
        subscription: 'task-sub',
        httpTransport: mockTransport,
      });

      // Mismatched job name modifies ack deadline to 0 and returns null
      const mismatch = await adapter.dequeue(['other.service']);
      expect(mismatch).toBeNull();
      expect(mockTransport).toHaveBeenCalledWith(
        expect.stringContaining(':modifyAckDeadline'),
        expect.any(Object)
      );

      // Matched job
      mockTransport.mockClear();
      const job = await adapter.dequeue(['webhook.send']);
      expect(job).not.toBeNull();
      expect(job.id).toBe('job-pubsub-55');
      expect(job.name).toBe('webhook.send');
      expect(job._ackId).toBe('ack-token-xyz');
      expect(adapter.ackIds.get('job-pubsub-55')).toBe('ack-token-xyz');
    });

    it('completes, fails, and retries jobs via acknowledge / modifyAckDeadline', async () => {
      const executedEndpoints = [];
      const mockTransport = vi.fn().mockImplementation((url) => {
        executedEndpoints.push(url.split(':').pop());
        return Promise.resolve({ statusCode: 200, json: {} });
      });

      const adapter = new PubSubQueueAdapter({
        projectId: 'acme-corp',
        topic: 'task-queue',
        subscription: 'task-sub',
        httpTransport: mockTransport,
      });

      // Complete
      adapter.ackIds.set('j1', 'ack1');
      const c = await adapter.complete('j1', { processed: true });
      expect(c.status).toBe('completed');
      expect(adapter.ackIds.has('j1')).toBe(false);
      expect(executedEndpoints[0]).toBe('acknowledge');

      // Fail
      adapter.ackIds.set('j2', 'ack2');
      const f = await adapter.fail('j2', new Error('Permanent failure'));
      expect(f.status).toBe('failed');
      expect(adapter.ackIds.has('j2')).toBe(false);
      expect(executedEndpoints[1]).toBe('acknowledge');

      // Retry
      adapter.ackIds.set('j3', 'ack3');
      const r = await adapter.retry('j3', 10000, new Error('Temporary'));
      expect(r.status).toBe('pending');
      expect(adapter.ackIds.has('j3')).toBe(false);
      expect(executedEndpoints[2]).toBe('modifyAckDeadline');
    });

    it('processes Cloud Run push subscription webhooks via processPushRequest()', async () => {
      const queueManager = createQueueManager();
      const dispatched = [];

      queueManager.register('notification.push', async (job) => {
        dispatched.push(job.data);
        return { delivered: true };
      });

      const adapter = new PubSubQueueAdapter({
        topic: 'projects/p/topics/notifications',
      });

      const reqMock = {
        body: {
          message: {
            messageId: 'push-msg-99',
            data: Buffer.from(JSON.stringify({
              id: 'job-push-1',
              name: 'notification.push',
              data: { deviceId: 'dev_123' },
            })).toString('base64'),
          },
        },
      };

      const resStatus = vi.fn().mockReturnThis();
      const resSend = vi.fn();
      const resMock = { status: resStatus, send: resSend };

      const ok = await adapter.processPushRequest(reqMock, resMock, queueManager);
      expect(ok).toBe(true);
      expect(dispatched).toEqual([{ deviceId: 'dev_123' }]);
      expect(resStatus).toHaveBeenCalledWith(200);
      expect(resSend).toHaveBeenCalledWith('OK');
    });

    it('handles push subscription error scenarios gracefully', async () => {
      const queueManager = createQueueManager();
      queueManager.register('failing.job', async () => {
        throw new Error('Boom in worker');
      });

      const adapter = new PubSubQueueAdapter({
        topic: 'projects/p/topics/t',
      });

      // Missing message payload -> 400
      const res1 = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      const missingRes = await adapter.processPushRequest({ body: {} }, res1, queueManager);
      expect(missingRes).toBe(false);
      expect(res1.status).toHaveBeenCalledWith(400);

      // Unhandled job name -> 204 (acknowledged so Pub/Sub does not spam redelivery)
      const res2 = { status: vi.fn().mockReturnThis(), end: vi.fn() };
      const unhandledRes = await adapter.processPushRequest({
        body: {
          message: {
            data: Buffer.from(JSON.stringify({ name: 'unregistered.job' })).toString('base64'),
          },
        },
      }, res2, queueManager);
      expect(unhandledRes).toBe(true);
      expect(res2.status).toHaveBeenCalledWith(204);

      // Failing handler -> 500 & throws so Cloud Run / Pub/Sub retries with backoff
      const res3 = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      await expect(adapter.processPushRequest({
        body: {
          message: {
            data: Buffer.from(JSON.stringify({ name: 'failing.job' })).toString('base64'),
          },
        },
      }, res3, queueManager)).rejects.toThrow('Boom in worker');
      expect(res3.status).toHaveBeenCalledWith(500);
    });

    it('works with official / duck-typed @google-cloud/pubsub client', async () => {
      const mockTopicObj = {
        publishMessage: vi.fn().mockResolvedValue('sdk-pubsub-msg-1'),
      };
      const mockSubObj = {
        pull: vi.fn().mockResolvedValue([
          {
            receivedMessages: [
              {
                ackId: 'sdk-ack-1',
                message: {
                  messageId: 'sdk-pubsub-msg-1',
                  data: Buffer.from(JSON.stringify({ id: 'sdk-j', name: 'sync.orders' })).toString('base64'),
                },
              },
            ],
          },
        ]),
      };

      const mockClient = {
        topic: vi.fn().mockReturnValue(mockTopicObj),
        subscription: vi.fn().mockReturnValue(mockSubObj),
      };

      const adapter = new PubSubQueueAdapter({
        projectId: 'gcp-project',
        topic: 'sync-topic',
        subscription: 'sync-sub',
        pubsubClient: mockClient,
      });

      const enqueued = await adapter.enqueue(new Job({ name: 'sync.orders' }));
      expect(enqueued._pubsubMessageId).toBe('sdk-pubsub-msg-1');

      const dequeued = await adapter.dequeue();
      expect(dequeued.name).toBe('sync.orders');
      expect(dequeued._ackId).toBe('sdk-ack-1');
    });
  });
});
