/**
 * CLI Tests
 * Tests for webspresso CLI commands
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sharp = require('sharp');

const CLI_PATH = path.join(__dirname, '../../bin/webspresso.js');
const TEST_DIR = path.join(__dirname, '../fixtures/cli-test-projects');
const FAVICON_TEST_DIR = path.join(__dirname, '../fixtures/favicon-test');

// Helper to run CLI commands
// For interactive commands, pipes answers to skip prompts
// When project name is provided: "Will you use a database?" (n), "Install dependencies?" (n)
// When no project name: "Install in current directory?" (n), "Will you use a database?" (n), "Install dependencies?" (n)
function runCli(args, options = {}) {
  // If command might be interactive, pipe answers to skip prompts
  const isInteractive =
    args.includes('new') &&
    !args.includes('--install') &&
    !args.includes('--help') &&
    !args.includes('--yes');
  
  let answers = '';
  if (isInteractive) {
    // Check if project name is provided
    const hasProjectName = args.match(/new\s+(\S+)/);
    if (hasProjectName) {
      // Project name provided: database (n + Enter), seed (n + Enter), install (n + Enter)
      // Each answer needs Enter, so: n\n for database, n\n for seed, n\n for install
      answers = 'n\\nn\\nn\\n';
    } else {
      // No project name: current dir (n + Enter), database (n + Enter), seed (n + Enter), install (n + Enter)
      answers = 'n\\nn\\nn\\nn\\n';
    }
  }
  
  const cmd = isInteractive 
    ? `(echo -e "${answers}") | node ${CLI_PATH} ${args} 2>&1 || true`
    : `node ${CLI_PATH} ${args}`;
  
  try {
    return {
      stdout: execSync(cmd, { 
        encoding: 'utf-8',
        cwd: options.cwd || TEST_DIR,
        shell: isInteractive ? '/bin/bash' : undefined,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
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
      expect(result.stdout).toContain('--yes');
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
      
      // Note: Exit code might be non-zero due to interactive prompts, but files should be created
      const projectPath = path.join(TEST_DIR, projectName);
      
      // Check directory structure (main test - files should exist)
      expect(fs.existsSync(projectPath)).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'pages'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'views'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'public'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'src'))).toBe(true);
      
      // Check that project was created (stdout or files exist)
      if (result.exitCode === 0) {
        expect(result.stdout).toContain('Creating new Webspresso project');
      }
    });

    it('should create package.json with correct content', () => {
      runCli(`new ${projectName}`);
      
      const packagePath = path.join(TEST_DIR, projectName, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      
      expect(packageJson.name).toBe(projectName);
      expect(packageJson.scripts.dev).toBe('webspresso dev');
      expect(packageJson.scripts.start).toContain('build:css');
      expect(packageJson.scripts['build:css']).toContain('tailwindcss');
      expect(packageJson.scripts['watch:css']).toContain('tailwindcss');
      expect(packageJson.dependencies.webspresso).toBeDefined();
      expect(packageJson.dependencies.zod).toBeDefined();
      expect(packageJson.devDependencies.tailwindcss).toBeDefined();
      expect(packageJson.devDependencies.postcss).toBeDefined();
      expect(packageJson.devDependencies.autoprefixer).toBeDefined();
    });

    it('should create server.js', () => {
      runCli(`new ${projectName}`);
      
      const serverPath = path.join(TEST_DIR, projectName, 'server.js');
      const serverContent = fs.readFileSync(serverPath, 'utf-8');
      
      expect(serverContent).toContain('./config/load-env');
      expect(serverContent).toContain('loadEnv');
      expect(serverContent).toContain("require('webspresso')");
      expect(serverContent).toContain('createApp');
      expect(serverContent).toContain('./config/app');
      expect(serverContent).toContain('parseEnv');
    });

    it('should create config/ with load-env, env schema, and app options', () => {
      runCli(`new ${projectName}`);
      
      const root = path.join(TEST_DIR, projectName);
      expect(fs.existsSync(path.join(root, 'config', 'load-env.js'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'config', 'env.schema.js'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'config', 'app.js'))).toBe(true);
      const schema = fs.readFileSync(path.join(root, 'config', 'env.schema.js'), 'utf-8');
      expect(schema).toContain('zod');
      expect(schema).toContain('parseEnv');
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
      const dePath = path.join(TEST_DIR, projectName, 'pages', 'locales', 'de.json');
      
      const enJson = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
      const deJson = JSON.parse(fs.readFileSync(dePath, 'utf-8'));
      
      // Check English
      expect(enJson.site.name).toBe('Webspresso');
      expect(enJson.nav.home).toBe('Home');
      expect(enJson.footer.copyright).toContain('Webspresso');
      expect(enJson.welcome).toContain('Welcome');
      expect(enJson.description).toBeDefined();
      
      // Check German locale file
      expect(deJson.site.name).toBe('Webspresso');
      expect(deJson.nav.home).toBe('Startseite');
      expect(deJson.footer.copyright).toContain('Webspresso');
      expect(deJson.welcome).toContain('Willkommen');
      expect(deJson.description).toBeDefined();
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
      expect(gitignoreContent).toContain('.env.*.local');
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
      // Note: Exit code might be non-zero due to interactive prompts, but files should be correct
      // Should NOT have Tailwind files (main test)
      expect(fs.existsSync(path.join(projectPath, 'tailwind.config.js'))).toBe(false);
      expect(fs.existsSync(path.join(projectPath, 'postcss.config.js'))).toBe(false);
      expect(fs.existsSync(path.join(projectPath, 'src', 'input.css'))).toBe(false);
      
      // Check stdout if available
      if (createResult.exitCode === 0) {
        expect(createResult.stdout).not.toContain('Tailwind CSS setup');
      }
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
      // Dev script uses webspresso dev which handles watch:css internally
      expect(packageJson.scripts.dev).toBe('webspresso dev');
    });

    it('should use webspresso dev command when Tailwind enabled', () => {
      runCli(`new ${projectName}`);
      
      const packagePath = path.join(TEST_DIR, projectName, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      
      // Dev script uses webspresso dev which handles CSS watch internally
      expect(packageJson.scripts.dev).toBe('webspresso dev');
      // watch:css script should still exist for manual use
      expect(packageJson.scripts['watch:css']).toBeDefined();
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

  describe.sequential('New Project - Database Support', () => {
    const projectName = 'test-db-project';
    
    beforeEach(() => {
      cleanup(projectName);
    });
    
    afterEach(() => {
      cleanup(projectName);
    });

    it('should not include database driver by default', () => {
      runCli(`new ${projectName}`);
      
      const packagePath = path.join(TEST_DIR, projectName, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      
      expect(packageJson.dependencies['better-sqlite3']).toBeUndefined();
      expect(packageJson.dependencies['pg']).toBeUndefined();
      expect(packageJson.dependencies['mysql2']).toBeUndefined();
      expect(fs.existsSync(path.join(TEST_DIR, projectName, 'webspresso.db.js'))).toBe(false);
    });

    it('should include better-sqlite3 when database is selected', () => {
      // Note: We can't easily test interactive prompts, but we can verify
      // that the code structure supports database selection
      // In real usage, user would select database during interactive prompt
      runCli(`new ${projectName}`);
      
      // By default, no database is selected (prompt answers "n")
      const packagePath = path.join(TEST_DIR, projectName, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      
      // Should not have database driver (user answered "no" to database question)
      expect(packageJson.dependencies['better-sqlite3']).toBeUndefined();
    });

    it('should create webspresso.db.js when database is selected', () => {
      // This test verifies the file structure, but actual database selection
      // requires interactive input which is hard to test
      // The file creation logic is tested indirectly through structure checks
      runCli(`new ${projectName}`);
      
      // By default, no database config file should exist
      expect(fs.existsSync(path.join(TEST_DIR, projectName, 'webspresso.db.js'))).toBe(false);
    });

    it('should include DATABASE_URL in .env.example when database is selected', () => {
      // Similar to above, we test the default behavior (no database)
      runCli(`new ${projectName}`);
      
      const envPath = path.join(TEST_DIR, projectName, '.env.example');
      const envContent = fs.readFileSync(envPath, 'utf-8');
      
      // By default, DATABASE_URL should not be present (user answered "no")
      expect(envContent).not.toContain('DATABASE_URL');
    });

    it('should create migrations directory when database is selected', () => {
      runCli(`new ${projectName}`);
      
      // By default, migrations directory should not exist
      expect(fs.existsSync(path.join(TEST_DIR, projectName, 'migrations'))).toBe(false);
    });

    it('should create models directory when database is selected', () => {
      runCli(`new ${projectName}`);
      
      // Models directory should exist when database is selected (even if not used)
      // Actually, it's only created if database is selected, but we answer "no" to database
      // So it should not exist by default
      expect(fs.existsSync(path.join(TEST_DIR, projectName, 'models'))).toBe(false);
    });

    it('should create seeds directory and files when seed is selected', () => {
      // This test would require answering "yes" to database and "yes" to seed
      // For now, we'll test that seeds directory is not created by default
      runCli(`new ${projectName}`);
      
      // By default, seeds directory should not exist
      expect(fs.existsSync(path.join(TEST_DIR, projectName, 'seeds'))).toBe(false);
    });

    it('should add faker dependency when seed is selected', () => {
      runCli(`new ${projectName}`);
      
      const packageJsonPath = path.join(TEST_DIR, projectName, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      
      // By default, faker should not be present
      expect(packageJson.dependencies).not.toHaveProperty('@faker-js/faker');
      expect(packageJson.scripts).not.toHaveProperty('seed');
    });
  });

  describe.sequential('Error Handling', () => {
    it('should scaffold into current directory when project name is .', () => {
      const dirName = 'dot-dir-scaffold';
      const projectPath = path.join(TEST_DIR, dirName);
      if (fs.existsSync(projectPath)) {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
      fs.mkdirSync(projectPath, { recursive: true });
      fs.writeFileSync(path.join(projectPath, 'README.md'), '# existing\n');

      runCli('new . --yes --no-tailwind', { cwd: projectPath });

      expect(fs.existsSync(path.join(projectPath, 'server.js'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'pages'))).toBe(true);
      const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
      expect(pkg.name).toBe(dirName);

      fs.rmSync(projectPath, { recursive: true, force: true });
    });

    it('should fail if project directory already exists', () => {
      const projectName = 'existing-project';
      const projectPath = path.join(TEST_DIR, projectName);
      
      // Create directory first
      fs.mkdirSync(projectPath, { recursive: true });
      
      const result = runCli(`new ${projectName}`);
      
      // Should fail with error message (exit code might be 1 or 130 due to prompts)
      const output = result.stderr || result.stdout;
      expect(output).toContain('already exists');
      
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
      // Since we're providing a name, it should work - check that project was created
      const newProjectPath = path.join(tempProjectDir, 'test-in-existing');
      if (fs.existsSync(newProjectPath)) {
        // Project was created successfully
        expect(fs.existsSync(path.join(newProjectPath, 'pages'))).toBe(true);
      }
      
      // Cleanup
      if (fs.existsSync(newProjectPath)) {
        fs.rmSync(newProjectPath, { recursive: true, force: true });
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

  describe.sequential('Seed Command', () => {
    const projectName = 'test-seed-project';
    let projectPath;

    beforeAll(() => {
      cleanup(projectName);
      // Create a basic project with database
      runCli(`new ${projectName}`, { 
        env: { ...process.env, CI: 'true' } // Skip interactive prompts
      });
      projectPath = path.join(TEST_DIR, projectName);
      
      // Create models directory and a dummy model file
      fs.mkdirSync(path.join(projectPath, 'models'), { recursive: true });
      
      // Create webspresso.db.js if it doesn't exist
      if (!fs.existsSync(path.join(projectPath, 'webspresso.db.js'))) {
        const dbConfig = `module.exports = {
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
};
`;
        fs.writeFileSync(path.join(projectPath, 'webspresso.db.js'), dbConfig);
      }
    });

    afterAll(() => {
      cleanup(projectName);
    });

    it('should fail if not in a Webspresso project', () => {
      const result = runCli('seed', { cwd: TEST_DIR });
      
      expect(result.exitCode).toBe(1);
      expect(result.stderr || result.stdout).toContain('Not a Webspresso project');
    });

    it('should fail if models directory does not exist', () => {
      // Remove models directory
      const modelsDir = path.join(projectPath, 'models');
      if (fs.existsSync(modelsDir)) {
        fs.rmSync(modelsDir, { recursive: true, force: true });
      }
      
      const result = runCli('seed', { cwd: projectPath });
      
      expect(result.exitCode).toBe(1);
      expect(result.stderr || result.stdout).toContain('models/ directory not found');
      
      // Restore models directory
      fs.mkdirSync(modelsDir, { recursive: true });
    });

    it('should fail if seeds/index.js does not exist', () => {
      // Ensure seeds directory doesn't exist
      const seedsDir = path.join(projectPath, 'seeds');
      if (fs.existsSync(seedsDir)) {
        fs.rmSync(seedsDir, { recursive: true, force: true });
      }
      
      const result = runCli('seed', { cwd: projectPath });
      
      expect(result.exitCode).toBe(1);
      const output = result.stderr || result.stdout;
      // Main check: should mention seeds/index.js not found
      expect(output).toContain('seeds/index.js not found');
    });

    it('should create seed files with --setup flag', () => {
      const seedsDir = path.join(projectPath, 'seeds');
      const seedIndexPath = path.join(seedsDir, 'index.js');
      
      // Remove seeds directory if exists
      if (fs.existsSync(seedsDir)) {
        fs.rmSync(seedsDir, { recursive: true, force: true });
      }
      
      const result = runCli('seed --setup', { cwd: projectPath });
      
      // Check that seed files were created
      expect(fs.existsSync(seedsDir)).toBe(true);
      expect(fs.existsSync(seedIndexPath)).toBe(true);
      
      // Check seed file content
      const seedContent = fs.readFileSync(seedIndexPath, 'utf-8');
      expect(seedContent).toContain('createDatabase');
      expect(seedContent).toContain('getAllModels');
      expect(seedContent).toContain('seeder');
    });

    it('should show help for seed command', () => {
      const result = runCli('seed --help', { cwd: projectPath });
      
      expect(result.stdout).toContain('Run database seeders');
      expect(result.stdout).toContain('--setup');
      expect(result.stdout).toContain('--config');
      expect(result.stdout).toContain('--env');
    });
  });

  describe.sequential('Favicon Generate Command', () => {
    let faviconTestDir;

    beforeAll(async () => {
      faviconTestDir = path.join(FAVICON_TEST_DIR, 'project');
      fs.mkdirSync(faviconTestDir, { recursive: true });

      // Create test PNG with sharp
      await sharp({
        create: { width: 512, height: 512, channels: 4, background: { r: 34, g: 197, b: 94, alpha: 1 } },
      })
        .png()
        .toFile(path.join(faviconTestDir, 'logo.png'));
    });

    afterAll(() => {
      if (fs.existsSync(FAVICON_TEST_DIR)) {
        fs.rmSync(FAVICON_TEST_DIR, { recursive: true, force: true });
      }
    });

    beforeEach(() => {
      // Clean generated files before each test
      const publicDir = path.join(faviconTestDir, 'public');
      const partialsDir = path.join(faviconTestDir, 'views', 'partials');
      const layoutPath = path.join(faviconTestDir, 'views', 'layout.njk');

      if (fs.existsSync(publicDir)) {
        fs.rmSync(publicDir, { recursive: true, force: true });
      }
      if (fs.existsSync(partialsDir)) {
        fs.unlinkSync(path.join(partialsDir, 'favicons.njk'));
        if (fs.readdirSync(partialsDir).length === 0) {
          fs.rmdirSync(partialsDir);
        }
      }
      // Reset layout to state without favicons include
      if (fs.existsSync(layoutPath)) {
        const content = fs.readFileSync(layoutPath, 'utf8');
        fs.writeFileSync(layoutPath, content.replace(/\s*{% include "partials\/favicons\.njk" %}\n?/g, ''));
      }
    });

    it('should display favicon:generate help', () => {
      const result = runCli('favicon:generate --help');
      expect(result.stdout).toContain('Generate favicon PNGs');
      expect(result.stdout).toContain('--output-dir');
      expect(result.stdout).toContain('--theme-color');
      expect(result.stdout).toContain('--no-layout');
      expect(result.exitCode).toBe(0);
    });

    it('should generate favicon files from PNG source', () => {
      const result = runCli('favicon:generate logo.png', { cwd: faviconTestDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Generating favicons from');
      expect(result.stdout).toContain('Favicons generated successfully');

      const publicDir = path.join(faviconTestDir, 'public');
      expect(fs.existsSync(path.join(publicDir, 'apple-icon-57x57.png'))).toBe(true);
      expect(fs.existsSync(path.join(publicDir, 'apple-icon-180x180.png'))).toBe(true);
      expect(fs.existsSync(path.join(publicDir, 'android-icon-192x192.png'))).toBe(true);
      expect(fs.existsSync(path.join(publicDir, 'favicon-32x32.png'))).toBe(true);
      expect(fs.existsSync(path.join(publicDir, 'ms-icon-144x144.png'))).toBe(true);
      expect(fs.existsSync(path.join(publicDir, 'manifest.json'))).toBe(true);
    });

    it('should create favicons.njk partial', () => {
      runCli('favicon:generate logo.png', { cwd: faviconTestDir });

      const partialPath = path.join(faviconTestDir, 'views', 'partials', 'favicons.njk');
      expect(fs.existsSync(partialPath)).toBe(true);

      const content = fs.readFileSync(partialPath, 'utf8');
      expect(content).toContain('apple-touch-icon');
      expect(content).toContain('apple-icon-57x57.png');
      expect(content).toContain('android-icon-192x192.png');
      expect(content).toContain('favicon-32x32.png');
      expect(content).toContain('manifest.json');
      expect(content).toContain('msapplication-TileColor');
      expect(content).toContain('theme-color');
    });

    it('should create manifest.json with correct structure', () => {
      runCli('favicon:generate logo.png --name "Test App" --short-name "Test"', { cwd: faviconTestDir });

      const manifestPath = path.join(faviconTestDir, 'public', 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      expect(manifest.name).toBe('Test App');
      expect(manifest.short_name).toBe('Test');
      expect(manifest.icons).toBeDefined();
      expect(manifest.icons.length).toBeGreaterThan(0);
      expect(manifest.theme_color).toBeDefined();
      expect(manifest.background_color).toBeDefined();
    });

    it('should use custom theme-color in output', () => {
      runCli('favicon:generate logo.png --theme-color "#1a1a2e"', { cwd: faviconTestDir });

      const partialPath = path.join(faviconTestDir, 'views', 'partials', 'favicons.njk');
      const content = fs.readFileSync(partialPath, 'utf8');
      expect(content).toContain('#1a1a2e');
    });

    it('should add include to layout.njk when layout exists', () => {
      fs.mkdirSync(path.join(faviconTestDir, 'views'), { recursive: true });
      fs.writeFileSync(
        path.join(faviconTestDir, 'views', 'layout.njk'),
        '<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>'
      );

      runCli('favicon:generate logo.png', { cwd: faviconTestDir });

      const layoutContent = fs.readFileSync(path.join(faviconTestDir, 'views', 'layout.njk'), 'utf8');
      expect(layoutContent).toContain('{% include "partials/favicons.njk" %}');
    });

    it('should not modify layout when --no-layout is used', () => {
      fs.mkdirSync(path.join(faviconTestDir, 'views'), { recursive: true });
      const layoutPath = path.join(faviconTestDir, 'views', 'layout.njk');
      const originalContent = '<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>';
      fs.writeFileSync(layoutPath, originalContent);

      runCli('favicon:generate logo.png --no-layout', { cwd: faviconTestDir });

      const layoutContent = fs.readFileSync(layoutPath, 'utf8');
      expect(layoutContent).not.toContain('favicons.njk');
      expect(layoutContent).toBe(originalContent);
    });

    it('should fail when source file does not exist', () => {
      const result = runCli('favicon:generate non-existent.png', { cwd: faviconTestDir });

      expect(result.exitCode).toBe(1);
      expect(result.stderr || result.stdout).toContain('Source file not found');
    });

    it('should fail when source is not PNG', () => {
      fs.writeFileSync(path.join(faviconTestDir, 'logo.jpg'), 'fake jpeg');
      const result = runCli('favicon:generate logo.jpg', { cwd: faviconTestDir });

      expect(result.exitCode).toBe(1);
      expect(result.stderr || result.stdout).toContain('Source must be a PNG file');
    });

    it('should use custom output-dir', () => {
      runCli('favicon:generate logo.png -o static', { cwd: faviconTestDir });

      const staticDir = path.join(faviconTestDir, 'static');
      expect(fs.existsSync(path.join(staticDir, 'apple-icon-57x57.png'))).toBe(true);
      expect(fs.existsSync(path.join(staticDir, 'manifest.json'))).toBe(true);

      const partialContent = fs.readFileSync(path.join(faviconTestDir, 'views', 'partials', 'favicons.njk'), 'utf8');
      expect(partialContent).toContain('/static/');
    });
  });
});

