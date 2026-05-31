# Blog example

Minimal SSR app with SQLite, `Post` model, public pages, and JSON API.

## Setup

```bash
cd examples/blog
npm install
cp .env.example .env
npx webspresso db:make create_posts
npx webspresso db:migrate
npx webspresso doctor --db
npm run dev
```

- Home: http://localhost:3000/
- Blog: http://localhost:3000/blog
- API: http://localhost:3000/api/posts

## Scaffold equivalent

```bash
npx webspresso new my-blog --template blog --yes --install
```
