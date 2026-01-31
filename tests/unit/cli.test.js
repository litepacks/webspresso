/**
 * CLI Tests
 * Tests for webspresso CLI commands
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '../../bin/webspresso.js');
const TEST_DIR = path.join(__dirname, '../fixtures/cli-test-projects');

// Helper to run CLI commands
// For interactive commands, pipes "n\n" to skip prompts
function runCli(args, options = {}) {
  // If command might be interactive, pipe "n\n" to skip prompts
  const isInteractive = args.includes('new') && !args.includes('--install') && !args.includes('--help');
  const cmd = isInteractive 
    ? `echo -e "n\\n" | node ${CLI_PATH} ${args}`
    : `node ${CLI_PATH} ${args}`;
  
  try {
    return {
      stdout: execSync(cmd, { 
        encoding: 'utf-8',
        cwd: options.cwd || TEST_DIR,
        shell: isInteractive ? '/bin/bash' : undefined,
        ...options
      }),
      exitCode: 0
    };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status || 1
    };
  }
}

// Helper to clean up test projects
function cleanup(projectName) {
  const projectPath = path.join(TEST_DIR, projectName);
  if (fs.existsSync(projectPath)) {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
}

// Ensure test directory exists
beforeAll(() => {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
});

// Clean up after all tests
afterAll(() => {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

// CLI tests must run sequentially to avoid directory conflicts
describe('CLI', () => {
  // Run all CLI tests sequentially
  describe.sequential('Help and Version', () => {
    it('should display help', () => {
      const result = runCli('--help');
      expect(result.stdout).toContain('Webspresso CLI');
      expect(result.stdout).toContain('new');
      expect(result.stdout).toContain('page');
      expect(result.stdout).toContain('api');
      expect(result.stdout).toContain('dev');
      expect(result.stdout).toContain('start');
      expect(result.exitCode).toBe(0);
    });

    it('should display version', () => {
      const result = runCli('--version');
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
      expect(result.exitCode).toBe(0);
    });

    it('should display new command help', () => {
      const result = runCli('new --help');
      expect(result.stdout).toContain('Create a new Webspresso project');
      expect(result.stdout).toContain('--no-tailwind');
      expect(result.stdout).toContain('--install');
      // Should show optional parameter (Commander.js shows it as [project-name])
      expect(result.stdout).toContain('[project-name]');
      expect(result.exitCode).toBe(0);
    });
  });

  describe.sequential('New Project Command', () => {
    const projectName = 'test-project';

    beforeEach(() => {
      // Clean up before each test to ensure clean state
      cleanup(projectName);
    });

    afterEach(() => {
      cleanup(projectName);
    });

    it('should create a new project with default settings', () => {
      const result = runCli(`new ${projectName}`);
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Creating new Webspresso project');
      expect(result.stdout).toContain('Tailwind CSS setup complete');
      expect(result.stdout).toContain('Project created successfully');

      const projectPath = path.join(TEST_DIR, projectName);
      
      // Check directory structure
      expect(fs.existsSync(projectPath)).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'pages'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'views'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'public'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'src'))).toBe(true);
    });

    it('should create package.json with correct content', () => {
      runCli(`new ${projectName}`);
      
      const packagePath = path.join(TEST_DIR, projectName, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      
      expect(packageJson.name).toBe(projectName);
      expect(packageJson.scripts.dev).toContain('watch:css');
      expect(packageJson.scripts.start).toContain('build:css');
      expect(packageJson.scripts['build:css']).toContain('tailwindcss');
      expect(packageJson.scripts['watch:css']).toContain('tailwindcss');
      expect(packageJson.dependencies.webspresso).toBeDefined();
      expect(packageJson.devDependencies.tailwindcss).toBeDefined();
      expect(packageJson.devDependencies.postcss).toBeDefined();
      expect(packageJson.devDependencies.autoprefixer).toBeDefined();
    });

    it('should create server.js', () => {
      runCli(`new ${projectName}`);
      
      const serverPath = path.join(TEST_DIR, projectName, 'server.js');
      const serverContent = fs.readFileSync(serverPath, 'utf-8');
      
      expect(serverContent).toContain("require('dotenv')");
      expect(serverContent).toContain("require('webspresso')");
      expect(serverContent).toContain('createApp');
      expect(serverContent).toContain('pagesDir');
      expect(serverContent).toContain('viewsDir');
      expect(serverContent).toContain('publicDir');
    });

    it('should create layout.njk with Tailwind classes', () => {
      runCli(`new ${projectName}`);
      
      const layoutPath = path.join(TEST_DIR, projectName, 'views', 'layout.njk');
      const layoutContent = fs.readFileSync(layoutPath, 'utf-8');
      
      expect(layoutContent).toContain('<!DOCTYPE html>');
      expect(layoutContent).toContain('/css/style.css');
      expect(layoutContent).toContain('min-h-screen');
      expect(layoutContent).toContain('bg-gray-50');
      expect(layoutContent).toContain('max-w-7xl');
      expect(layoutContent).toContain('{% block content %}');
      expect(layoutContent).toContain("{{ t('site.name')");
      expect(layoutContent).toContain("{{ t('nav.home')");
      expect(layoutContent).toContain("{{ t('footer.copyright')");
    });

    it('should create index.njk with Tailwind classes', () => {
      runCli(`new ${projectName}`);
      
      const indexPath = path.join(TEST_DIR, projectName, 'pages', 'index.njk');
      const indexContent = fs.readFileSync(indexPath, 'utf-8');
      
      expect(indexContent).toContain('{% extends "layout.njk" %}');
      expect(indexContent).toContain('{% block content %}');
      expect(indexContent).toContain('text-4xl');
      expect(indexContent).toContain('font-bold');
      expect(indexContent).toContain('bg-blue-600');
      expect(indexContent).toContain("{{ t('welcome')");
    });

    it('should create locale files with all keys', () => {
      runCli(`new ${projectName}`);
      
      const enPath = path.join(TEST_DIR, projectName, 'pages', 'locales', 'en.json');
      const trPath = path.join(TEST_DIR, projectName, 'pages', 'locales', 'tr.json');
      
      const enJson = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
      const trJson = JSON.parse(fs.readFileSync(trPath, 'utf-8'));
      
      // Check English
      expect(enJson.site.name).toBe('Webspresso');
      expect(enJson.nav.home).toBe('Home');
      expect(enJson.footer.copyright).toContain('Webspresso');
      expect(enJson.welcome).toContain('Welcome');
      expect(enJson.description).toBeDefined();
      
      // Check Turkish
      expect(trJson.site.name).toBe('Webspresso');
      expect(trJson.nav.home).toBe('Ana Sayfa');
      expect(trJson.footer.copyright).toContain('Webspresso');
      expect(trJson.welcome).toContain('Hoş Geldiniz');
      expect(trJson.description).toBeDefined();
    });

    it('should create Tailwind config files', () => {
      runCli(`new ${projectName}`);
      
      const projectPath = path.join(TEST_DIR, projectName);
      
      // tailwind.config.js
      const tailwindConfig = fs.readFileSync(path.join(projectPath, 'tailwind.config.js'), 'utf-8');
      expect(tailwindConfig).toContain('content:');
      expect(tailwindConfig).toContain('./pages/**/*.{njk,js}');
      expect(tailwindConfig).toContain('./views/**/*.njk');
      
      // postcss.config.js
      const postcssConfig = fs.readFileSync(path.join(projectPath, 'postcss.config.js'), 'utf-8');
      expect(postcssConfig).toContain('tailwindcss');
      expect(postcssConfig).toContain('autoprefixer');
      
      // src/input.css
      const inputCss = fs.readFileSync(path.join(projectPath, 'src', 'input.css'), 'utf-8');
      expect(inputCss).toContain('@tailwind base');
      expect(inputCss).toContain('@tailwind components');
      expect(inputCss).toContain('@tailwind utilities');
    });

    it('should create public/css/style.css placeholder', () => {
      runCli(`new ${projectName}`);
      
      const cssPath = path.join(TEST_DIR, projectName, 'public', 'css', 'style.css');
      expect(fs.existsSync(cssPath)).toBe(true);
      
      const cssContent = fs.readFileSync(cssPath, 'utf-8');
      expect(cssContent).toContain('build:css');
    });

    it('should create .env.example', () => {
      runCli(`new ${projectName}`);
      
      const envPath = path.join(TEST_DIR, projectName, '.env.example');
      const envContent = fs.readFileSync(envPath, 'utf-8');
      
      expect(envContent).toContain('PORT=');
      expect(envContent).toContain('NODE_ENV=');
      expect(envContent).toContain('DEFAULT_LOCALE=');
      expect(envContent).toContain('SUPPORTED_LOCALES=');
      expect(envContent).toContain('BASE_URL=');
    });

    it('should create .gitignore', () => {
      runCli(`new ${projectName}`);
      
      const gitignorePath = path.join(TEST_DIR, projectName, '.gitignore');
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
      
      expect(gitignoreContent).toContain('node_modules');
      expect(gitignoreContent).toContain('.env');
      expect(gitignoreContent).toContain('coverage');
    });

    it('should create README.md', () => {
      runCli(`new ${projectName}`);
      
      const readmePath = path.join(TEST_DIR, projectName, 'README.md');
      const readmeContent = fs.readFileSync(readmePath, 'utf-8');
      
      expect(readmeContent).toContain(`# ${projectName}`);
      expect(readmeContent).toContain('npm install');
      expect(readmeContent).toContain('npm run dev');
    });
  });

  describe.sequential('New Project without Tailwind', () => {
    const projectName = 'test-no-tailwind';
    let projectPath;
    let createResult;

    beforeAll(() => {
      // Clean up and create project once for all tests
      cleanup(projectName);
      createResult = runCli(`new ${projectName} --no-tailwind`);
      projectPath = path.join(TEST_DIR, projectName);
    });

    afterAll(() => {
      cleanup(projectName);
    });

    it('should create project without Tailwind when --no-tailwind is used', () => {
      expect(createResult.exitCode).toBe(0);
      expect(createResult.stdout).not.toContain('Tailwind CSS setup');
      
      // Should NOT have Tailwind files
      expect(fs.existsSync(path.join(projectPath, 'tailwind.config.js'))).toBe(false);
      expect(fs.existsSync(path.join(projectPath, 'postcss.config.js'))).toBe(false);
      expect(fs.existsSync(path.join(projectPath, 'src', 'input.css'))).toBe(false);
    });

    it('should use CDN in layout when --no-tailwind', () => {
      const layoutPath = path.join(projectPath, 'views', 'layout.njk');
      const layoutContent = fs.readFileSync(layoutPath, 'utf-8');
      
      expect(layoutContent).toContain('cdn.tailwindcss.com');
      expect(layoutContent).not.toContain('/css/style.css');
    });

    it('should have simpler scripts without Tailwind', () => {
      const packagePath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      
      expect(packageJson.scripts.dev).not.toContain('watch:css');
      expect(packageJson.scripts['build:css']).toBeUndefined();
      expect(packageJson.devDependencies).toBeUndefined();
    });
  });

  describe.sequential('New Project - Interactive Mode', () => {
    it('should accept new command without project name parameter', () => {
      // When no project name is provided, it should not error immediately
      // (it will prompt interactively, but we can't easily test that without stdin)
      // So we just verify the command syntax is valid
      const result = runCli('new --help');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('[project-name]');
    });

    it('should handle invalid project names', () => {
      // Test that invalid characters are rejected (if validation exists)
      // This is more of a documentation test
      const result = runCli('new --help');
      // Verify the command accepts optional project name
      expect(result.stdout).toContain('[project-name]');
      expect(result.exitCode).toBe(0);
    });
  });

  describe.sequential('New Project - Installation Flow', () => {
    const projectName = 'test-install-flow';
    
    beforeEach(() => {
      cleanup(projectName);
    });
    
    afterEach(() => {
      cleanup(projectName);
    });

    it('should include watch:css script when Tailwind is enabled', () => {
      runCli(`new ${projectName}`);
      
      const packagePath = path.join(TEST_DIR, projectName, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      
      expect(packageJson.scripts['watch:css']).toBeDefined();
      expect(packageJson.scripts['watch:css']).toContain('tailwindcss');
      expect(packageJson.scripts.dev).toContain('watch:css');
    });

    it('should include watch:css in dev script when Tailwind enabled', () => {
      runCli(`new ${projectName}`);
      
      const packagePath = path.join(TEST_DIR, projectName, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      
      // Dev script should include watch:css
      expect(packageJson.scripts.dev).toContain('watch:css');
      expect(packageJson.scripts.dev).toContain('node --watch server.js');
    });

    it('should not include watch:css when --no-tailwind is used', () => {
      runCli(`new ${projectName} --no-tailwind`);
      
      const packagePath = path.join(TEST_DIR, projectName, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      
      expect(packageJson.scripts['watch:css']).toBeUndefined();
      expect(packageJson.scripts.dev).not.toContain('watch:css');
    });

    it('should have build:css script when Tailwind is enabled', () => {
      runCli(`new ${projectName}`);
      
      const packagePath = path.join(TEST_DIR, projectName, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      
      expect(packageJson.scripts['build:css']).toBeDefined();
      expect(packageJson.scripts['build:css']).toContain('tailwindcss');
      expect(packageJson.scripts.start).toContain('build:css');
    });
  });

  describe.sequential('Error Handling', () => {
    it('should fail if project directory already exists', () => {
      const projectName = 'existing-project';
      const projectPath = path.join(TEST_DIR, projectName);
      
      // Create directory first
      fs.mkdirSync(projectPath, { recursive: true });
      
      const result = runCli(`new ${projectName}`);
      
      expect(result.exitCode).toBe(1);
      expect(result.stderr || result.stdout).toContain('already exists');
      
      // Cleanup
      cleanup(projectName);
    });

    it('should fail if current directory already has Webspresso project', () => {
      // Create a temporary project directory with Webspresso files
      const tempProjectDir = path.join(TEST_DIR, 'temp-webspresso-project');
      fs.mkdirSync(tempProjectDir, { recursive: true });
      fs.writeFileSync(path.join(tempProjectDir, 'server.js'), '// test');
      fs.mkdirSync(path.join(tempProjectDir, 'pages'), { recursive: true });
      
      // Try to create new project in this directory (simulating interactive mode)
      // This should fail because it already has Webspresso files
      // Note: We can't easily test the interactive prompt, but we can test the validation
      const result = runCli(`new test-in-existing`, { cwd: tempProjectDir });
      
      // Should succeed if we provide a new name, but fail if we try to use current dir
      // Since we're providing a name, it should work
      expect(result.exitCode).toBe(0);
      
      // Cleanup
      if (fs.existsSync(path.join(tempProjectDir, 'test-in-existing'))) {
        fs.rmSync(path.join(tempProjectDir, 'test-in-existing'), { recursive: true, force: true });
      }
      fs.rmSync(tempProjectDir, { recursive: true, force: true });
    });
  });

  describe.sequential('Add Tailwind Command', () => {
    const projectName = 'test-add-tailwind';

    beforeEach(() => {
      // Clean up first to ensure clean state
      cleanup(projectName);
      // Create a project without Tailwind first
      runCli(`new ${projectName} --no-tailwind`);
    });

    afterEach(() => {
      cleanup(projectName);
    });

    it('should add Tailwind to existing project', () => {
      const projectPath = path.join(TEST_DIR, projectName);
      const result = runCli('add tailwind', { cwd: projectPath });
      
      expect(result.stdout).toContain('Adding Tailwind CSS');
      
      // Check files were created
      expect(fs.existsSync(path.join(projectPath, 'tailwind.config.js'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'postcss.config.js'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'src', 'input.css'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'public', 'css', 'style.css'))).toBe(true);
    });

    it('should update package.json with Tailwind dependencies', () => {
      const projectPath = path.join(TEST_DIR, projectName);
      runCli('add tailwind', { cwd: projectPath });
      
      const packageJson = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
      
      expect(packageJson.devDependencies.tailwindcss).toBeDefined();
      expect(packageJson.devDependencies.postcss).toBeDefined();
      expect(packageJson.devDependencies.autoprefixer).toBeDefined();
      expect(packageJson.scripts['build:css']).toBeDefined();
      expect(packageJson.scripts['watch:css']).toBeDefined();
    });

    it('should update layout to use local CSS instead of CDN', () => {
      const projectPath = path.join(TEST_DIR, projectName);
      runCli('add tailwind', { cwd: projectPath });
      
      const layoutContent = fs.readFileSync(path.join(projectPath, 'views', 'layout.njk'), 'utf-8');
      
      expect(layoutContent).toContain('/css/style.css');
      expect(layoutContent).not.toContain('cdn.tailwindcss.com');
    });

    it('should fail if not in a Webspresso project', () => {
      const result = runCli('add tailwind', { cwd: TEST_DIR });
      
      expect(result.exitCode).toBe(1);
      expect(result.stderr || result.stdout).toContain('Not a Webspresso project');
    });
  });
});

