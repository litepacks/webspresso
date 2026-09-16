const { defineModule } = require('../../../../../../src/modules/define-module');

module.exports = defineModule({
  name: 'auth',
  pages: { prefix: '/auth' },
  api: { prefix: '/api/auth' },
  middlewares: {
    authGuard: (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      req.user = { id: 'usr_1', email: 'test@example.com' };
      next();
    },
  },
});
