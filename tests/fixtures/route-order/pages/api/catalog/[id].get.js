module.exports = async (req, res) => {
  res.json({ which: 'API_DYNAMIC', id: req.params.id });
};
