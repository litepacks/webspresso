/**
 * Webspresso SSR Streaming & Chunked Transfer Engine
 * @module core/ssr/stream
 */

'use strict';

const { Readable } = require('stream');

/**
 * Creates a readable HTML stream for Nunjucks templates supporting deferred data slots
 * @param {Object} options
 * @param {import('nunjucks').Environment} options.env - Nunjucks environment
 * @param {string} options.templatePath - Template name or path
 * @param {Object} [options.context={}] - Render context
 * @param {Object} [options.defer] - Map of deferred promises { [slotName]: Promise<any> | { promise: Promise<any>, template?: string } }
 * @returns {Readable}
 */
function createHtmlStream(options = {}) {
  const { env, templatePath, context = {}, defer = {}, nonce: optionNonce } = options;
  const nonce = optionNonce || context.nonce || context.cspNonce || '';
  const scriptTag = nonce ? `<script nonce="${nonce}">` : '<script>';

  if (!env) {
    throw new Error('createHtmlStream requires a valid Nunjucks environment in options.env');
  }

  const stream = new Readable({
    read() {}, // No-op, data is pushed asynchronously
  });

  (async () => {
    try {
      const deferredKeys = Object.keys(defer);

      if (deferredKeys.length === 0) {
        // Standard template streaming (render and stream)
        const html = env.render(templatePath, context);
        stream.push(html);
        stream.push(null);
        return;
      }

      // Initial shell rendering with deferred slot placeholders
      const shellContext = {
        ...context,
        __streaming: true,
      };

      for (const key of deferredKeys) {
        shellContext[key] = null;
      }

      let shellHtml = env.render(templatePath, shellContext);

      // Check if template contains streaming slot markers, or split at first slot
      // We push the initial shell chunk immediately to start browser TTFB & CSS download
      stream.push(shellHtml);

      // Resolve deferred promises in parallel
      const resolutionPromises = deferredKeys.map(async (key) => {
        const deferredItem = defer[key];
        const promise = deferredItem && typeof deferredItem.then === 'function' ? deferredItem : deferredItem.promise;
        const slotTemplate = deferredItem.template || null;

        try {
          const resolvedData = await promise;
          if (stream.destroyed) {
            return;
          }
          let slotHtml = '';
          if (slotTemplate) {
            slotHtml = env.render(slotTemplate, { ...context, [key]: resolvedData });
          } else {
            slotHtml = typeof resolvedData === 'string' ? resolvedData : JSON.stringify(resolvedData);
          }

          // Push an out-of-order streaming chunk with inline replacement script or comment
          const slotChunk = `
<template data-stream-slot="${key}">${slotHtml}</template>
${scriptTag}
(function(){
  var t = document.querySelector('template[data-stream-slot="${key}"]');
  var target = document.querySelector('[data-stream-target="${key}"]') || document.getElementById('stream-target-${key}');
  if (t && target) {
    target.innerHTML = '';
    target.appendChild(t.content.cloneNode(true));
  }
})();
</script>`;
          if (!stream.destroyed) {
            stream.push(slotChunk);
          }
        } catch (slotErr) {
          if (stream.destroyed) {
            return;
          }
          const errorChunk = `
<template data-stream-slot="${key}">
  <!-- Slot Error (${key}): ${slotErr.message} -->
</template>`;
          if (!stream.destroyed) {
            stream.push(errorChunk);
          }
        }
      });

      await Promise.all(resolutionPromises);
      if (!stream.destroyed) {
        stream.push(null); // End of stream
      }
    } catch (err) {
      stream.destroy(err);
    }
  })();

  return stream;
}

/**
 * Render template directly to Express response as a chunked stream
 * @param {import('express').Response} res - Express response object
 * @param {string} templatePath - Template name
 * @param {Object} [context={}] - Context data
 * @param {Object} [options] - Additional options
 * @param {import('nunjucks').Environment} options.env - Nunjucks environment
 * @param {Object} [options.defer] - Deferred slot promises
 * @param {number} [options.status=200] - HTTP status code
 * @param {boolean} [options.flushImmediately=true] - Flush headers immediately
 * @returns {Promise<void>}
 */
function renderStream(res, templatePath, context = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      env,
      defer = {},
      status = 200,
      flushImmediately = true,
      nonce: optionNonce,
    } = options;

    const nonce =
      optionNonce ||
      res?.locals?.cspNonce ||
      res?.locals?.nonce ||
      context?.cspNonce ||
      context?.nonce ||
      '';

    if (!env) {
      return reject(new Error('renderStream requires a valid Nunjucks environment in options.env'));
    }

    if (res.headersSent) {
      return reject(new Error('Cannot render stream: headers already sent'));
    }

    res.status(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    if (flushImmediately && typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const stream = createHtmlStream({
      env,
      templatePath,
      context,
      defer,
      nonce,
    });

    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (!stream.destroyed) {
        stream.destroy();
      }
      resolve();
    };

    res.on('close', cleanup);

    stream.on('data', (chunk) => {
      if (!finished && !res.writableEnded) {
        res.write(chunk);
      }
    });

    stream.on('end', () => {
      if (!finished) {
        finished = true;
        res.end();
        resolve();
      }
    });

    stream.on('error', (err) => {
      if (!finished) {
        finished = true;
        if (!res.headersSent) {
          res.status(500).send('Streaming Render Error');
        } else if (!res.writableEnded) {
          res.write(`<!-- Streaming Error: ${err.message} -->`);
          res.end();
        }
        reject(err);
      }
    });
  });
}

module.exports = {
  createHtmlStream,
  renderStream,
};
