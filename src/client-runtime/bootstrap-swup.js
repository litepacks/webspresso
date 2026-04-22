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
  window.__webspressoSwup = swup;
})();
