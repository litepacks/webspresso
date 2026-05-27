/**
 * Optional custom worker entry — webspresso build generates .webspresso/worker/index.mjs
 * Use this file only if you need custom fetch middleware around the built app.
 */
export { default } from '../../.webspresso/worker/index.mjs';
