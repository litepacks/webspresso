/**
 * Webspresso build compiler types
 */

export type AdapterName = 'node' | 'cloudflare' | 'bun' | 'deno';
export type RouteType = 'ssr' | 'api';

export interface BuildConfig {
  adapter: AdapterName;
  pagesDir?: string;
  viewsDir?: string;
  publicDir?: string;
  plugins?: unknown[];
  alias?: Record<string, string>;
  experimental?: { incremental?: boolean };
  hooks?: Record<string, (...args: unknown[]) => unknown>;
}

export interface AdapterCapabilities {
  fetch: boolean;
  listen: boolean;
  fs: boolean;
  nativeModules: boolean;
  d1?: boolean;
  kv?: boolean;
  r2?: boolean;
  assets?: boolean;
}

export interface RouteManifestEntry {
  id: string;
  type: RouteType;
  method: string;
  pattern: string;
  tier: 0 | 1 | 2;
  registrationIndex: number;
  source: Record<string, string>;
  handler: Record<string, unknown>;
  middleware: (string | [string, unknown])[];
  template?: { id: string; renderMode: 'string' | 'precompiled' };
  schema?: { compiled: boolean; jsonSchema: unknown };
  i18n?: { namespaces: string[] };
  seo?: Record<string, unknown>;
}

export interface TemplateChunk {
  body: string;
  includes: string[];
  extends: string | null;
  frontmatter: { metaPatch: Record<string, unknown>; dataPatch: Record<string, unknown> };
  hash: string;
}

export interface PluginBuildMeta {
  name: string;
  edgeCompatible: boolean;
  nodeOnly?: boolean;
  build?: { assets?: string[] };
}

export interface WebspressoManifest {
  version: 3;
  framework: { name: string; version: string; schema: string };
  adapter: { name: AdapterName; version: string; capabilities: string[] };
  buildId: string;
  builtAt: string;
  compatibility: { minFramework: string; maxFramework: string; requiredCapabilities: string[] };
  routes: RouteManifestEntry[];
  templates: Record<string, TemplateChunk>;
  i18n: Record<string, Record<string, unknown>>;
  middleware: Record<string, unknown>;
  plugins: PluginBuildMeta[];
  assets: Record<string, unknown>;
  models: Record<string, unknown>;
  hooks: { global?: string };
  seo: Record<string, unknown>;
}

export interface ValidationIssue {
  code: string;
  message: string;
  file?: string;
  hint?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface BuildAdapter {
  name: AdapterName;
  version: string;
  capabilities: AdapterCapabilities;
  validate(manifest: WebspressoManifest): ValidationResult;
  generateEntry(manifest: WebspressoManifest): string;
  bundleOptions(manifest: WebspressoManifest, outputDir: string): Record<string, unknown>;
}

export interface BuildContext {
  cwd: string;
  config: BuildConfig;
  adapter: BuildAdapter;
  pagesDir: string;
  viewsDir: string | null;
  publicDir: string;
  graph: import('./graph/build-graph').BuildGraph;
}
