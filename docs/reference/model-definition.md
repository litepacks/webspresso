# `defineModel(definition)` API Reference

> **Module:** `webspresso`  
> **Signature:** `defineModel(definition: ModelDefinition): ModelDefinition`  
> **TypeScript Definition:** [`index.d.ts`](https://github.com/litepacks/webspresso/blob/current/index.d.ts#L80)

---

## 1. Parameters (`ModelDefinition`)

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`name`** *(required)* | `string` | — | Model identifier (e.g. `'User'`, `'Product'`). |
| **`table`** *(required)* | `string` | — | Database table name in SQL (e.g. `'users'`, `'products'`). |
| **`schema`** *(required)* | `ZdbSchema` | — | Column definition built via `zdb.schema({ ... })`. |
| **`relations`** | `Record<string, RelationConfig>` | `{}` | Model relations (`hasMany`, `belongsTo`, `hasOne`). |
| **`softDelete`** | `boolean \| { column?: string }` | `false` | Enable soft delete scoping (`deletedAt`). |
| **`hidden`** | `string[]` | `[]` | Field names to automatically exclude from JSON serialization. |
| **`cache`** | `boolean \| 'auto' \| 'smart'` | `false` | Enable query-level caching for model reads. |
| **`queryLimits`** | `QueryLimitsConfig` | `{}` | Maximum allowed query limits and includes for DoS protection. |

---

## 2. `zdb` Column Builder

| Builder Function | SQL Mapping | Options |
| :--- | :--- | :--- |
| **`zdb.id()`** | Auto-increment Primary Key | `{ primary?: boolean }` |
| **`zdb.string()`** | `VARCHAR(255)` / `TEXT` | `{ length?: number, unique?: boolean, default?: string }` |
| **`zdb.integer()`** | `INTEGER` | `{ unsigned?: boolean, default?: number }` |
| **`zdb.boolean()`** | `BOOLEAN` | `{ default?: boolean }` |
| **`zdb.datetime()`** | `TIMESTAMP` / `DATETIME` | `{ autoNowAdd?: boolean, autoNow?: boolean }` |
| **`zdb.enum(values)`** | `VARCHAR` with validation | `{ default?: string }` |
| **`zdb.json()`** | `JSON` / `TEXT` (Auto serialized) | `{ default?: object }` |
| **`zdb.file()`** | Multipart uploaded file reference | `{ mimetypes?: string[], maxSize?: number }` |

---

## 3. Repositories API Methods (`Repository<T>`)

| Method | Signature | Description |
| :--- | :--- | :--- |
| **`find()`** | `(criteria?: object, opts?: QueryOptions) => Promise<T[]>` | Find all records matching criteria. |
| **`findById()`** | `(id: number \| string, opts?: QueryOptions) => Promise<T \| null>` | Find record by primary key. |
| **`findOne()`** | `(criteria: object, opts?: QueryOptions) => Promise<T \| null>` | Find first matching record. |
| **`create()`** | `(data: DeepPartial<T>) => Promise<T>` | Insert a new record. |
| **`update()`** | `(id: number \| string, data: DeepPartial<T>) => Promise<T>` | Update existing record. |
| **`delete()`** | `(id: number \| string) => Promise<boolean>` | Delete record (or soft delete if enabled). |
| **`paginate()`** | `(opts: PaginationOptions) => Promise<PaginatedResult<T>>` | Perform paginated query with metadata. |
| **`query()`** | `() => Knex.QueryBuilder` | Access underlying Knex query builder bound to ambient transaction. |
