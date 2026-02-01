/**
 * Project Setup Utilities
 * Functions for installing dependencies and starting development server
 */

const { execSync, spawn } = require('child_process');

/**
 * Run installation and build process
 * @param {string} projectPath - Project directory path
 * @param {boolean} useTailwind - Whether Tailwind CSS is enabled
 * @returns {Promise<void>}
 */
async function runInstallation(projectPath, useTailwind) {
  console.log('\n📦 Installing dependencies...\n');
  try {
    execSync('npm install', { 
      stdio: 'inherit', 
      cwd: projectPath 
    });
    
    if (useTailwind) {
      console.log('\n🎨 Building Tailwind CSS...\n');
      execSync('npm run build:css', { 
        stdio: 'inherit', 
        cwd: projectPath 
      });
    }
    
    console.log('\n✅ Installation complete!\n');
  } catch (err) {
    console.error('❌ Installation failed:', err.message);
    process.exit(1);
  }
}

/**
 * Start development server
 * @param {string} projectPath - Project directory path
 * @param {boolean} useTailwind - Whether Tailwind CSS is enabled
 * @returns {void}
 */
function startDevServer(projectPath, useTailwind) {
  console.log('\n🚀 Starting development server...\n');
  console.log('Press Ctrl+C to stop\n');
  
  if (useTailwind) {
    // Start CSS watch and server together
    const cssWatch = spawn('npm', ['run', 'watch:css'], {
      stdio: 'inherit',
      shell: true,
      cwd: projectPath
    });
    
    const server = spawn('node', ['--watch', 'server.js'], {
      stdio: 'inherit',
      shell: true,
      cwd: projectPath,
      env: { ...process.env, PORT: process.env.PORT || '3000', NODE_ENV: 'development' }
    });
    
    // Handle exit
    const cleanup = () => {
      cssWatch.kill();
      server.kill();
      process.exit(0);
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    
    cssWatch.on('exit', cleanup);
    server.on('exit', cleanup);
  } else {
    // Just start server
    const server = spawn('node', ['--watch', 'server.js'], {
      stdio: 'inherit',
      shell: true,
      cwd: projectPath,
      env: { ...process.env, PORT: process.env.PORT || '3000', NODE_ENV: 'development' }
    });
    
    server.on('exit', (code) => {
      process.exit(code || 0);
    });
    
    process.on('SIGINT', () => {
      server.kill();
      process.exit(0);
    });
  }
}

module.exports = {
  runInstallation,
  startDevServer
};
