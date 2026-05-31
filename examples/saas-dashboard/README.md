# SaaS dashboard example

`siteAnalyticsPlugin` + `adminPanelPlugin` on SQLite — analytics in admin sidebar.

## Setup

```bash
cd examples/saas-dashboard
npm install
cp .env.example .env
npx webspresso db:migrate
npx webspresso admin:setup
npm run dev
```

- Site: http://localhost:3000/
- Admin: http://localhost:3000/_admin (Site Analytics section after migrations)

## Scaffold equivalent

```bash
npx webspresso new my-saas --template dashboard --yes --install
```
