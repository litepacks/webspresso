# Webspresso Development & Testing Workflow

[← Back to AGENTS.md](.agents/AGENTS.md)

---

## 1. Essential Commands

- **Dev Server**: `npm run dev` or `webspresso dev`
- **Run Unit Tests**: `npm test` or `npx vitest run`
- **Run Targeted Test File**: `npx vitest run tests/unit/auth/jwt.test.js`
- **Check TypeScript Types**: `npm run check:types` (`tsc --project tests/ts-smoke/tsconfig.json`)
- **Run E2E Tests**: `npm run test:e2e` (Playwright)
- **Run Migrations**: `npx webspresso db:migrate`
- **Project Sanity Check**: `npx webspresso doctor`

---

## 2. Testing & Quality Assurance Rules

### 2.1 Zero Regression Policy
- Always run Vitest tests (`npm test` or `npx vitest run`) before declaring any task complete.
- Verify clean 100% test passes across unit, integration, and E2E test suites.

### 2.2 API Backward Compatibility
- Never break existing public APIs (`registerModule`, `registerPage`, `adminApi`, `createApp`, `defineModel`).
- Always add new options or parameters as optional or backward-compatible enhancements.
