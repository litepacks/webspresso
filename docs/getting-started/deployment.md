# Deployment & Production Configuration

> **Goal:** Configure, build, and deploy a production-ready Webspresso application with zero downtime, graceful shutdown, and optimal performance.

---

## 1. Environment Configuration

In production, always set `NODE_ENV=production`:

```bash
export NODE_ENV=production
export PORT=3000
```

Ensure all variables declared in `config/env.schema.js` (e.g. `DATABASE_URL`, `SESSION_SECRET`, `BASE_URL`) are provided in your production environment or secret manager.

---

## 2. Production Build

Compile static assets (e.g. Tailwind CSS) before starting the server:

```bash
npm run build:css
```

---

## 3. Graceful Shutdown & Lifecycle Management

Webspresso includes native, zero-dependency graceful shutdown support. Configure it in `server.js`:

```javascript
const { createApp } = require('webspresso');

const { app } = createApp({
  pagesDir: path.join(__dirname, 'pages'),
  viewsDir: path.join(__dirname, 'views'),
  server: {
    shutdown: {
      enabled: true,
      mode: 'graceful',
      timeout: 10000, // 10 seconds before force closing
    },
    compression: true, // Native zlib Brotli/Gzip streaming compression
    trustProxy: 1,    // Trust 1 reverse proxy hop (Nginx / Cloudflare)
  },
});
```

When a `SIGTERM` or `SIGINT` signal is received (e.g., during a Docker container rotation or deployment restart):
1. The server stops accepting new incoming TCP connections.
2. In-flight requests are allowed up to `timeout` milliseconds to finish.
3. Keep-alive connections receive `Connection: close` headers.
4. Plugin disposers and database connections are closed in reverse registration order.
5. The Node process exits cleanly with code `0`.

---

## 4. Process Management (PM2)

Using [PM2](https://pm2.keymetrics.io/) to manage clustered Node.js processes:

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'webspresso-app',
      script: 'server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      kill_timeout: 12000, // Slightly higher than Webspresso shutdown timeout
      wait_ready: true,
      listen_timeout: 10000,
    },
  ],
};
```

Start the cluster:

```bash
pm2 start ecosystem.config.js
```

---

## 5. Docker Deployment

Minimal Dockerfile for Webspresso applications:

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:css

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/pages ./pages
COPY --from=builder /app/views ./views
COPY --from=builder /app/services ./services
COPY --from=builder /app/models ./models
COPY --from=builder /app/config ./config
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/webspresso.db.js ./webspresso.db.js

EXPOSE 3000

USER node

CMD ["node", "server.js"]
```

---

## 6. Reverse Proxy Configuration (Nginx)

When running behind Nginx, configure proper headers for proxy pass:

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 7. Database Migrations in Production

Run database migrations before rolling out new application processes:

```bash
npx webspresso db:migrate
```
