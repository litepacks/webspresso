---
sidebar_position: 6
---

# webspresso add tailwind

Add Tailwind CSS to your existing project with build process.

## Usage

```bash
webspresso add tailwind
```

## What It Does

This command will:

1. Install Tailwind CSS, PostCSS, and Autoprefixer as dev dependencies
2. Create `tailwind.config.js` configuration file
3. Create `postcss.config.js` for PostCSS processing
4. Create `src/input.css` with Tailwind directives
5. Add build scripts to `package.json`
6. Update your layout to use the built CSS instead of CDN
7. Create `public/css/style.css` for the compiled output

## After Running

Install dependencies:

```bash
npm install
```

Build CSS:

```bash
npm run build:css      # Build CSS once
npm run watch:css      # Watch and rebuild CSS on changes
npm run dev            # Starts both CSS watch and dev server
```

## Generated Files

### tailwind.config.js

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{njk,js}',
    './views/**/*.njk',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

### postcss.config.js

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

### src/input.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

## Scripts Added

The following scripts are added to `package.json`:

```json
{
  "scripts": {
    "build:css": "tailwindcss -i ./src/input.css -o ./public/css/style.css --minify",
    "watch:css": "tailwindcss -i ./src/input.css -o ./public/css/style.css --watch"
  }
}
```

## Layout Update

Your `views/layout.njk` is updated to use the built CSS:

```njk
<link rel="stylesheet" href="/css/style.css">
```

## Next Steps

- [Learn about templates](/templates/nunjucks)
- [Customize Tailwind config](https://tailwindcss.com/docs/configuration)
