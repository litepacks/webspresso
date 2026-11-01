/**
 * index.d.ts and the runtime entry point must describe the same public API:
 * a typed export that is undefined at runtime type-checks but crashes when used,
 * and an untyped runtime export is invisible to TypeScript users.
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';

const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..', '..');

function typedExports() {
  const file = path.join(ROOT, 'index.d.ts');
  const program = ts.createProgram([file], { noEmit: true });
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(file));
  const values = new Set();
  const all = new Set();
  for (const sym of checker.getExportsOfModule(moduleSymbol)) {
    all.add(sym.name);
    const decl = sym.declarations && sym.declarations[0];
    if (decl && !ts.isInterfaceDeclaration(decl) && !ts.isTypeAliasDeclaration(decl)) {
      values.add(sym.name);
    }
  }
  return { values, all };
}

describe('public API: index.d.ts vs runtime exports', () => {
  const runtime = require(path.join(ROOT, 'index.js'));
  const { values, all } = typedExports();

  it('every typed value export exists at runtime', () => {
    const missing = [...values].filter((name) => runtime[name] === undefined);
    expect(missing).toEqual([]);
  });

  it('no runtime export resolves to undefined', () => {
    const undefinedExports = Object.keys(runtime).filter((name) => runtime[name] === undefined);
    expect(undefinedExports).toEqual([]);
  });

  it('every runtime export is declared in index.d.ts', () => {
    const untyped = Object.keys(runtime).filter((name) => !all.has(name));
    expect(untyped).toEqual([]);
  });
});
