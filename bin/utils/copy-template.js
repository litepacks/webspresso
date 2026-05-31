/**
 * Copy a templates/new/<preset> tree into a project directory.
 */

const fs = require('fs');
const path = require('path');

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

/**
 * @param {string} templateDir - absolute path to templates/new/<name>
 * @param {string} projectPath - target project root
 * @param {{ projectName?: string }} [opts]
 */
function copyTemplateToProject(templateDir, projectPath, opts = {}) {
  if (!fs.existsSync(templateDir)) {
    throw new Error(`Template directory not found: ${templateDir}`);
  }
  for (const entry of fs.readdirSync(templateDir)) {
    const src = path.join(templateDir, entry);
    const dest = path.join(projectPath, entry);
    copyRecursive(src, dest);
  }
  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgPath) && opts.projectName) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.name = opts.projectName;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}

module.exports = { copyTemplateToProject, copyRecursive };
