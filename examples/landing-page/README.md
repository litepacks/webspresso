# Landing page example

Static SSR landing with `healthCheckPlugin` and `sitemapPlugin` — no database.

## Setup

```bash
cd examples/landing-page
npm install
cp .env.example .env
npx webspresso doctor
npm run dev
```

- Home: http://localhost:3000/
- Health: http://localhost:3000/health
- Sitemap: http://localhost:3000/sitemap.xml

## Scaffold equivalent

```bash
npx webspresso new my-landing --template landing --yes --install
```
