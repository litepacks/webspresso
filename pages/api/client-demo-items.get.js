/**
 * Example JSON endpoint for client `fetch()` on the marketing site.
 * e.g. @click → fetch('/api/client-demo-items').then(r => r.json())
 */
module.exports = async (req, res) => {
  res.json({
    items: [
      { id: '1', label: 'Demo A' },
      { id: '2', label: 'Demo B' },
    ],
  });
};
