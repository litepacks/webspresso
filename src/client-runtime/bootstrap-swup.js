/* global Swup, SwupHeadPlugin, SwupScriptsPlugin */
(function () {
  if (typeof Swup === 'undefined' || typeof SwupHeadPlugin === 'undefined' || typeof SwupScriptsPlugin === 'undefined') {
    return;
  }

  function ignoreVisit(url, ctx) {
    var el = ctx && ctx.el;
    if (el && el.closest && el.closest('[data-no-swup]')) return true;
    try {
      var u = new URL(url, window.location.origin);
      var p = u.pathname;
      if (p.indexOf('/_admin') === 0 || p.indexOf('/_webspresso') === 0) return true;
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  var swup = new Swup({
    containers: ['#swup'],
    plugins: [new SwupHeadPlugin(), new SwupScriptsPlugin()],
    ignoreVisit: ignoreVisit,
  });

  // Re-initialize Alpine components after swup replaces page content if Alpine is loaded on the page
  swup.hooks.on('content:replace', function () {
    var root = document.querySelector('#swup');
    if (root && typeof window !== 'undefined' && window.Alpine && typeof window.Alpine.initTree === 'function') {
      window.Alpine.initTree(root);
    }
  });

  window.__webspressoSwup = swup;
})();
