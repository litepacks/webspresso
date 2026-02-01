/**
 * Authentication Middleware
 * Session-based authentication for admin panel
 * @module plugins/admin-panel/auth
 */

/**
 * Check if admin user exists in database
 * @param {Object} adminUserRepo - AdminUser repository
 * @returns {Promise<boolean>}
 */
async function checkAdminExists(adminUserRepo) {
  try {
    const count = await adminUserRepo.count();
    return count > 0;
  } catch (error) {
    // Table might not exist yet
    return false;
  }
}

/**
 * Create first admin user
 * @param {Object} adminUserRepo - AdminUser repository
 * @param {Object} data - User data { email, password, name }
 * @param {Function} hashPassword - Password hashing function (bcrypt)
 * @returns {Promise<Object>} Created admin user
 */
async function setupAdmin(adminUserRepo, data, hashPassword) {
  const { email, password, name } = data;
  
  if (!email || !password || !name) {
    throw new Error('Email, password, and name are required');
  }

  // Check if admin already exists
  const exists = await checkAdminExists(adminUserRepo);
  if (exists) {
    throw new Error('Admin user already exists');
  }

  // Hash password
  const hashedPassword = await hashPassword(password, 10);

  // Create admin user
  const admin = await adminUserRepo.create({
    email,
    password: hashedPassword,
    name,
    role: 'admin',
    active: true,
  });

  // Remove password from response
  delete admin.password;

  return admin;
}

/**
 * Verify password against hash
 * @param {string} password - Plain password
 * @param {string} hash - Hashed password
 * @param {Function} compare - Password comparison function (bcrypt.compare)
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, hash, compare) {
  return await compare(password, hash);
}

/**
 * Login user and set session
 * @param {Object} adminUserRepo - AdminUser repository
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {Function} compare - Password comparison function
 * @returns {Promise<Object|null>} User object or null if invalid
 */
async function login(adminUserRepo, email, password, compare) {
  // Find user by email
  const user = await adminUserRepo.query().where('email', email).first();
  
  if (!user || !user.active) {
    return null;
  }

  // Verify password
  const isValid = await verifyPassword(password, user.password, compare);
  
  if (!isValid) {
    return null;
  }

  // Remove password from response
  const { password: _, ...userWithoutPassword } = user;
  
  return userWithoutPassword;
}

/**
 * Logout user (clear session)
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 */
async function logout(req, res) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Require authentication middleware
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.adminUser) {
    return next();
  }
  
  // If it's an API request, return JSON error
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Otherwise redirect to login (handled by frontend)
  return res.status(401).json({ error: 'Unauthorized', redirect: '/_admin/login' });
}

/**
 * Optional auth middleware (doesn't fail if not authenticated)
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next
 */
function optionalAuth(req, res, next) {
  // Just pass through, frontend will handle auth state
  next();
}

module.exports = {
  checkAdminExists,
  setupAdmin,
  verifyPassword,
  login,
  logout,
  requireAuth,
  optionalAuth,
};
