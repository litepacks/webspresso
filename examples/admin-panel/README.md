# Admin panel example

SQLite + `adminPanelPlugin` + `Post` model with admin CRUD.

## Setup

```bash
cd examples/admin-panel
npm install
cp .env.example .env
npx webspresso db:make create_posts
npx webspresso db:migrate
npx webspresso admin:setup
npx webspresso doctor --db --strict
npm run dev
```

Admin: http://localhost:3000/_admin

## Scaffold equivalent

```bash
npx webspresso new my-admin --template admin --yes --install
```
