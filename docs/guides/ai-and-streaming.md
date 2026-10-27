---
title: AI & Real-Time Streaming
description: High-performance, zero-dependency HTTP chunked text, NDJSON, and Server-Sent Events (SSE) streaming for LLMs (OpenAI, Claude, Gemini) and real-time data feeds.
---

# AI & Real-Time Streaming Guide

Webspresso provides a high-performance, zero-dependency streaming engine (`core/stream` and `core/sse`) natively attached to every response object via `res.streamText()`, `res.streamJson()`, and `res.sse()`.

It is purpose-built for:
1. **LLM & AI Token Streaming**: Streaming text and NDJSON tokens from OpenAI, Anthropic Claude, Google Gemini, or Ollama to the browser with zero buffering.
2. **Server-Sent Events (SSE)**: W3C-compliant live event streams with automatic reconnection retry, event IDs, and keep-alive heartbeats.
3. **Backpressure & Cancellation**: Automatic AbortSignal propagation when clients disconnect or close their tab.

---

## 1. AI Token Streaming (`res.streamText`)

`res.streamText(callback, options)` sets up an unbuffered HTTP 1.1 chunked transfer stream with headers configured to bypass proxy buffers:

```javascript
// pages/api/ai/chat.post.js
const { defineApi } = require('webspresso');

module.exports = defineApi({
  schema: ({ z }) => ({
    body: z.object({
      prompt: z.string().min(1),
    }),
  }),
  async handler(req, res) {
    const { prompt } = req.input.body;

    return res.streamText(async (stream) => {
      // Example with OpenAI, Claude, or local Ollama SDK
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          stream: true,
        }),
        signal: req.signal, // Propagate client abort
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        // Forward raw chunk or parsed text delta directly to client
        stream.write(chunk);
      }
    });
  },
});
```

### Stream Controller API
The `stream` controller passed to your callback provides:
- `stream.write(chunk)`: Writes a text chunk to the client. Returns `false` if backpressure is detected.
- `stream.close()`: Gracefully ends the response stream.
- `stream.on('abort', () => ...)`: Triggered when the client cancels or closes the HTTP connection.
- `stream.isOpen`: Boolean indicating if the connection is still active.

---

## 2. Structured NDJSON Streaming (`res.streamJson`)

When emitting structured events, metrics, or pipeline progress objects line-by-line, use `res.streamJson()`:

```javascript
// pages/api/reports/generate.post.js
const { defineApi } = require('webspresso');

module.exports = defineApi({
  async handler(req, res) {
    return res.streamJson(async (stream) => {
      stream.write({ step: 'init', progress: 10 });
      await doStepOne();

      stream.write({ step: 'processing', progress: 60 });
      await doStepTwo();

      stream.write({ step: 'complete', progress: 100, downloadUrl: '/reports/123.pdf' });
    });
  },
});
```
Each object is automatically serialized with `JSON.stringify(obj) + '\n'` with `Content-Type: application/x-ndjson`.

---

## 3. Server-Sent Events (SSE) (`res.sse`)

For live real-time feeds, pub/sub notifications, and agent status bars, use `res.sse(callback, options)`:

```javascript
// pages/api/notifications/live.get.js
const { defineApi } = require('webspresso');

module.exports = defineApi({
  middleware: ['auth'],
  async handler(req, res) {
    const sse = res.sse({
      retry: 5000,          // Tell browser to reconnect after 5s on disconnect
      pingInterval: 15000,  // Send automatic keep-alive comment every 15s
    });

    // Send initial greeting
    sse.send({ message: 'Connected to live feed' }, 'connected', 1);

    // Listen to decoupled system events
    const onNotification = (data) => {
      if (data.userId === req.user.id) {
        sse.send(data, 'notification');
      }
    };

    req.events.on('user.notification', onNotification);

    // Clean up when client disconnects
    sse.on('close', () => {
      req.events.off('user.notification', onNotification);
    });
  },
});
```

### SSE Stream Methods
- `sse.send(data, eventName, id)`: Sends a formatted W3C SSE frame (`event: ...\nid: ...\ndata: ...\n\n`). Data objects are automatically JSON stringified.
- `sse.comment(text)`: Sends an SSE comment frame (`: ping\n\n`) to prevent proxy timeout.
- `sse.close()`: Ends the SSE connection.

---

## 4. Frontend Client Consumption

### Consuming `res.streamText` with Fetch API
```javascript
const response = await fetch('/api/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'Explain quantum computing' }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let result = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  result += decoder.decode(value, { stream: true });
  document.getElementById('output').textContent = result;
}
```

### Consuming `res.sse` with EventSource
```javascript
const eventSource = new EventSource('/api/notifications/live');

eventSource.addEventListener('notification', (event) => {
  const data = JSON.parse(event.data);
  console.log('New notification:', data);
});

eventSource.onerror = (err) => {
  console.error('SSE Error:', err);
};
```
