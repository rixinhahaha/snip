import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Load a renderer IIFE script and return the named export it creates.
 *
 * Renderer tools use the pattern `const Foo = (() => { ... })();` which
 * doesn't expose `Foo` as a global. We execute the source in a new Function
 * so the const binding is captured in scope, then return it explicitly.
 *
 * @param {string} filePath - Path relative to project root, or absolute
 * @param {string} exportName - The const variable name created by the IIFE
 */
export function loadIIFE(filePath, exportName) {
  const absPath = filePath.startsWith('/') ? filePath : resolve(process.cwd(), filePath);
  const source = readFileSync(absPath, 'utf-8');
  // Execute source + capture the const binding via return
  // eslint-disable-next-line no-new-func
  const fn = new Function(`${source}\nreturn ${exportName};`);
  return fn();
}
