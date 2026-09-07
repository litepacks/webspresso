# `defineService(definition)` API Reference

> **Module:** `webspresso`  
> **Signature:** `defineService(definition: ServiceDefinition): ServiceDefinition`  
> **TypeScript Definition:** [`index.d.ts`](https://github.com/litepacks/webspresso/blob/current/index.d.ts#L45)

---

## 1. Parameters (`ServiceDefinition`)

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`handler`** *(required)* | `(input: TInput, ctx: ServiceContext) => Promise<TOutput>` | — | The execution logic of the service. |
| **`schema`** | `ZodType \| (({ z }) => ZodType) \| Object` | `null` | Declarative input validation schema. |
| **`auth`** | `boolean \| string \| string[] \| Predicate` | `false` | Access control guard (`true`, role array, or `(user, ctx) => boolean`). |
| **`transaction`** | `boolean` | `false` | When `true`, automatically opens or inherits an ambient ACID Knex transaction. |
| **`cache`** | `boolean \| { ttl?: string \| number, key?: (input) => string }` | `false` | Service-level result memoization and caching. |
| **`timeout`** | `number \| string` | `null` | Maximum duration allowed for handler execution (e.g. `5000` or `'5s'`). |

---

## 2. `ServiceContext` Object

Every service handler receives a `ctx` object as its second argument:

| Property | Type | Description |
| :--- | :--- | :--- |
| **`ctx.db`** | `DatabaseInstance` | Scoped Knex database instance auto-bound to ambient transaction. |
| **`ctx.req`** | `Request` | Express request object (if called from an HTTP flow). |
| **`ctx.res`** | `Response` | Express response object (if called from an HTTP flow). |
| **`ctx.user`** | `User \| null` | Authenticated user record. |
| **`ctx.service`** | `(name, input, opts) => Promise<any>` | Invoke sibling services with ambient context propagation. |
| **`ctx.locale`** | `string` | Active locale code (e.g. `'en'`, `'tr'`). |
| **`ctx.t`** | `(key, params) => string` | Translation function. |
| **`ctx.fsy`** | `TemplateHelpers` | Full template helper catalog. |
