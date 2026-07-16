/**
 * Auth ↔ email plugin bridge
 * @module plugins/email/auth-bridge
 */

const { createKnexAuthTokensAdapter } = require('../../core/auth/tokens');
const { registerBundledAuthTemplates } = require('./bundled-templates');

const DEFAULT_AUTH_EMAILS = {
  passwordReset: {
    enabled: true,
    template: 'auth-password-reset',
    subject: 'Reset your password',
    path: '/reset-password',
    tokenTtlMs: 60 * 60 * 1000,
  },
  emailVerification: {
    enabled: true,
    template: 'auth-email-verify',
    subject: 'Verify your email',
    path: '/verify-email',
    tokenTtlMs: 24 * 60 * 60 * 1000,
  },
  welcome: {
    enabled: false,
    template: 'auth-welcome',
    subject: 'Welcome',
  },
  registerRoutes: true,
  routePrefix: '/api/auth',
};

/**
 * @param {Object} authManager
 * @param {Object} emailService
 * @param {import('./template-registry').TemplateRegistry} registry
 * @param {Object} config
 * @param {Object} db
 */
function wireAuthEmails(authManager, emailService, registry, config, db) {
  if (!authManager || !emailService) return null;

  const merged = {
    ...DEFAULT_AUTH_EMAILS,
    ...config,
    passwordReset: { ...DEFAULT_AUTH_EMAILS.passwordReset, ...config.passwordReset },
    emailVerification: { ...DEFAULT_AUTH_EMAILS.emailVerification, ...config.emailVerification },
    welcome: { ...DEFAULT_AUTH_EMAILS.welcome, ...config.welcome },
  };

  registerBundledAuthTemplates(registry);

  if (!authManager.authTokens && db) {
    authManager.authTokens = createKnexAuthTokensAdapter(db);
  }

  const baseUrl = (merged.baseUrl || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const identifierField = authManager.identifierField || 'email';

  function userDisplayName(user) {
    return user.name || user[identifierField] || 'there';
  }

  function buildUrl(pathSegment, token) {
    const sep = pathSegment.includes('?') ? '&' : '?';
    return `${baseUrl}${pathSegment}${sep}token=${encodeURIComponent(token)}`;
  }

  if (merged.passwordReset?.enabled) {
    authManager.notifications.passwordReset = async (user, { token, resetUrl }) => {
      const url = resetUrl || buildUrl(merged.passwordReset.path, token);
      await emailService.sendTemplate(merged.passwordReset.template, {
        to: user[identifierField],
        subject: merged.passwordReset.subject,
        data: {
          name: userDisplayName(user),
          token,
          resetUrl: url,
          email: user[identifierField],
        },
      });
    };
  }

  if (merged.emailVerification?.enabled) {
    authManager.notifications.emailVerification = async (user, { token, verifyUrl }) => {
      const url = verifyUrl || buildUrl(merged.emailVerification.path, token);
      await emailService.sendTemplate(merged.emailVerification.template, {
        to: user[identifierField],
        subject: merged.emailVerification.subject,
        data: {
          name: userDisplayName(user),
          token,
          verifyUrl: url,
          email: user[identifierField],
        },
      });
    };
  }

  if (merged.welcome?.enabled) {
    authManager.notifications.welcome = async (user) => {
      await emailService.sendTemplate(merged.welcome.template, {
        to: user[identifierField],
        subject: merged.welcome.subject,
        data: {
          name: userDisplayName(user),
          email: user[identifierField],
        },
      });
    };
  }

  return merged;
}

/**
 * @param {Object} options
 * @param {Object} options.authManager
 * @param {Object} options.ctx - RoutesReadyContext
 * @param {Object} options.authEmailsConfig
 */
function registerAuthEmailRoutes(options) {
  const { authManager, ctx, authEmailsConfig } = options;
  if (!authEmailsConfig?.registerRoutes) return;

  const prefix = authEmailsConfig.routePrefix || '/api/auth';
  const guest = ctx.middlewares?.guest;
  const authMw = ctx.middlewares?.auth;

  const base = (authEmailsConfig.baseUrl || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

  async function forgotPasswordHandler(req, res) {
    try {
      const email = req.body?.email || req.body?.identifier;
      if (email) {
        await authManager.requestPasswordReset(String(email), {
          tokenTtlMs: authEmailsConfig.passwordReset?.tokenTtlMs,
          buildResetUrl: (token) => {
            const pathSeg = authEmailsConfig.passwordReset?.path || '/reset-password';
            return `${base}${pathSeg}?token=${encodeURIComponent(token)}`;
          },
        });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async function resetPasswordHandler(req, res) {
    try {
      const { token, password } = req.body || {};
      if (!token || !password) {
        return res.status(400).json({ error: 'token and password are required' });
      }
      await authManager.completePasswordReset(String(token), String(password));
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message, code: err.code });
    }
  }

  async function verifyEmailHandler(req, res) {
    try {
      const { token } = req.body || {};
      if (!token) {
        return res.status(400).json({ error: 'token is required' });
      }
      const result = await authManager.verifyEmail(String(token));
      res.json(result);
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message, code: err.code });
    }
  }

  async function resendVerificationHandler(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      await authManager.requestEmailVerification(userId, {
        tokenTtlMs: authEmailsConfig.emailVerification?.tokenTtlMs,
        buildVerifyUrl: (token) => {
          const pathSeg = authEmailsConfig.emailVerification?.path || '/verify-email';
          return `${base}${pathSeg}?token=${encodeURIComponent(token)}`;
        },
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  const forgotMw = guest ? [guest, forgotPasswordHandler] : [forgotPasswordHandler];
  const resetMw = guest ? [guest, resetPasswordHandler] : [resetPasswordHandler];
  const resendMw = authMw ? [authMw, resendVerificationHandler] : [resendVerificationHandler];

  ctx.addRoute('post', `${prefix}/forgot-password`, ...forgotMw);
  ctx.addRoute('post', `${prefix}/reset-password`, ...resetMw);
  ctx.addRoute('post', `${prefix}/verify-email`, verifyEmailHandler);
  ctx.addRoute('post', `${prefix}/resend-verification`, ...resendMw);
}

module.exports = {
  wireAuthEmails,
  registerAuthEmailRoutes,
};
