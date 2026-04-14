/**
 * Skill Command — scaffold Agent Skill (SKILL.md) for Cursor / AI tools
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

function validateSkillName(name) {
  const t = String(name).trim().toLowerCase();
  if (!t) return 'Skill name is required';
  if (t.length > 64) return 'Skill name must be at most 64 characters';
  if (!NAME_PATTERN.test(t)) {
    return 'Use lowercase letters, numbers, and hyphens only (e.g. my-skill-name)';
  }
  return true;
}

function skillDir(base, skillName) {
  return path.join(base, '.cursor', 'skills', skillName);
}

function defaultDescription(skillName) {
  const label = skillName.replace(/-/g, ' ');
  return `Guides the agent through tasks for ${label}. Use when the user works on ${label} or asks about related workflows.`;
}

/** Bundled presets: CLI flag → template path under bin/ */
const PRESETS = {
  webspresso: {
    skillName: 'webspresso-usage',
    templatePath: path.join(__dirname, '../../templates/skills/webspresso-usage/SKILL.md'),
  },
};

function buildSkillMarkdown(skillName, description) {
  const title = skillName
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  const descYaml = JSON.stringify(description.trim());

  return `---
name: ${skillName}
description: ${descYaml}
---

# ${title}

## Instructions

- Describe step-by-step what the agent should do.
- Add constraints, file paths, and conventions for this project.

## When to use

- List concrete user phrases or tasks that should trigger this skill.

## Examples

\`\`\`
Example prompt or command
\`\`\`

`;

}

function registerCommand(program) {
  program
    .command('skill [name]')
    .description('Create an Agent Skill folder with SKILL.md (Cursor / AI tools)')
    .option('-g, --global', 'Write to ~/.cursor/skills/ instead of ./.cursor/skills/')
    .option('-d, --description <text>', 'Skill description (for YAML frontmatter)')
    .option('-f, --force', 'Overwrite existing SKILL.md')
    .option('-p, --preset <name>', 'Install bundled skill: webspresso → full Webspresso agent reference (SKILL.md)')
    .action(async (nameArg, options) => {
      const presetKey = options.preset ? String(options.preset).trim().toLowerCase() : '';

      if (presetKey) {
        const preset = PRESETS[presetKey];
        if (!preset) {
          console.error(`❌ Unknown preset "${presetKey}". Available: ${Object.keys(PRESETS).join(', ')}`);
          process.exit(1);
        }
        if (!fs.existsSync(preset.templatePath)) {
          console.error(`❌ Preset template missing: ${preset.templatePath}`);
          process.exit(1);
        }
        const root = options.global ? os.homedir() : process.cwd();
        const dir = skillDir(root, preset.skillName);
        const skillFile = path.join(dir, 'SKILL.md');

        if (!options.force && fs.existsSync(skillFile)) {
          console.error(`❌ Already exists: ${skillFile}`);
          console.error('   Use --force to overwrite.');
          process.exit(1);
        }

        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(preset.templatePath, skillFile);

        console.log(`\n✅ Installed bundled skill "${presetKey}" →\n   ${skillFile}\n`);
        console.log('   Edit SKILL.md if needed, then restart Cursor or reload the window.\n');
        return;
      }

      let skillName = nameArg ? String(nameArg).trim().toLowerCase() : '';

      if (!skillName) {
        const { name } = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: 'Skill name (kebab-case, e.g. review-api):',
            validate: validateSkillName,
          },
        ]);
        skillName = name.trim().toLowerCase();
      } else {
        const v = validateSkillName(skillName);
        if (v !== true) {
          console.error(`❌ ${v}`);
          process.exit(1);
        }
        skillName = skillName.trim().toLowerCase();
      }

      let description = options.description;
      if (!description) {
        const { desc } = await inquirer.prompt([
          {
            type: 'input',
            name: 'desc',
            message: 'Short description (what/when the agent should use this skill):',
            default: defaultDescription(skillName),
          },
        ]);
        description = desc || defaultDescription(skillName);
      }

      const root = options.global ? os.homedir() : process.cwd();
      const dir = skillDir(root, skillName);
      const skillFile = path.join(dir, 'SKILL.md');

      if (!options.force && fs.existsSync(skillFile)) {
        console.error(`❌ Already exists: ${skillFile}`);
        console.error('   Use --force to overwrite.');
        process.exit(1);
      }

      fs.mkdirSync(dir, { recursive: true });

      const body = buildSkillMarkdown(skillName, description);
      fs.writeFileSync(skillFile, body, 'utf8');

      console.log(`\n✅ Agent skill created:\n   ${skillFile}\n`);
      console.log('   Edit SKILL.md, then restart Cursor or reload the window if needed.\n');
    });
}

module.exports = { registerCommand };
