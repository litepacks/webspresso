# Webspresso Coding Standards & Conventions

[← Back to AGENTS.md](.agents/AGENTS.md)

---

## 1. Core Policies

1. **Zero External Dependencies Policy**: Core framework functionality (Auth, JWT, CORS, Routing, Nunjucks helpers) must avoid unnecessary third-party npm dependencies. Rely strictly on native Node.js standard library modules (`crypto`, `path`, `fs`, `events`, `async_hooks`).
2. **Strict Signature & Schema Verification**: Always verify function signatures and object schemas by inspecting authoritative source files before calling or extending them.
3. **File & Component Separation**: Keep client-side components in clean standalone JS files (`component.js` / `componentFile`) rather than escaping inline template strings.
4. **Log & Traceback Inspection**: Base all bug fixes strictly on exact runtime error log tracebacks and empirical test output. Never swallow errors or return dummy fallbacks.
5. **No Superficial Symptom Patches**: Never resolve errors by masking symptoms or deleting failing unit tests. Always resolve the underlying contract breakage.
