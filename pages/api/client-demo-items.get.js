/**
 * Example JSON endpoint for Alpine `fetch()` on the marketing site (no HTMX).
 * e.g. x-init or @click → fetch('/api/client-demo-items').then(r => r.json())
 */
module.exports = async (req, res) => {
  res.json({
    items: [
      { id: '1', label: 'Demo A' },
      { id: '2', label: 'Demo B' },
    ],
  });
};
