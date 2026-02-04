---
sidebar_position: 4
---

# Deployment

Deploy your Webspresso application to production.

## Environment Setup

Set production environment variables:

```bash
NODE_ENV=production
PORT=3000
BASE_URL=https://example.com
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

## Build Process

### 1. Install Dependencies

```bash
npm install --production
```

### 2. Build Assets

If using Tailwind CSS:

```bash
npm run build:css
```

### 3. Run Migrations

```bash
webspresso db:migrate
```

### 4. Start Server

```bash
webspresso start
# or
npm start
```

## Process Managers

### PM2

```bash
npm install -g pm2

# Start
pm2 start server.js --name webspresso

# Save configuration
pm2 save

# Setup startup script
pm2 startup
```

### systemd

Create `/etc/systemd/system/webspresso.service`:

```ini
[Unit]
Description=Webspresso Application
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/webspresso
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable webspresso
sudo systemctl start webspresso
```

## Docker

### Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN npm run build:css

EXPOSE 3000

CMD ["node", "server.js"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://user:pass@db:5432/dbname
    depends_on:
      - db

  db:
    image: postgres:15
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=dbname
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

## Reverse Proxy

### Nginx

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Apache

```apache
<VirtualHost *:80>
    ServerName example.com
    
    ProxyPreserveHost On
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
</VirtualHost>
```

## Security Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use HTTPS
- [ ] Configure Helmet security headers
- [ ] Set secure session cookies
- [ ] Use environment variables for secrets
- [ ] Enable rate limiting
- [ ] Keep dependencies updated
- [ ] Use database connection pooling
- [ ] Enable logging and monitoring

## Monitoring

### Health Check Endpoint

```javascript
// pages/api/health.get.js
module.exports = async function handler(req, res) {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
};
```

### Logging

Use a logging service or file-based logging:

```javascript
const fs = require('fs');
const { createWriteStream } = require('fs');

const logStream = createWriteStream('logs/app.log', { flags: 'a' });

// In error handler
module.exports = {
  onError(ctx, err) {
    logStream.write(`${new Date().toISOString()} - ${err.message}\n`);
    // ...
  },
};
```

## Next Steps

- [Configuration](/advanced/configuration)
- [Error Handling](/advanced/error-handling)
