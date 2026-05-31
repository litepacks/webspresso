module.exports = async function get(req, res) {
  const db = req.db || req.app?.getDb?.();
  if (!db || !db.models?.Post) {
    return res.status(503).json({ error: 'Database or Post model not configured' });
  }
  const posts = await db.models.Post.query().where({ published: true }).orderBy('created_at', 'desc').limit(20);
  return res.json({ posts });
};
