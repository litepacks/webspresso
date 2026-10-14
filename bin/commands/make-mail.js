'use strict';

/**
 * Webspresso CLI - make:mail Command
 * Scaffolds a declarative Mailable class in emails/<name>.js
 * @module bin/commands/make-mail
 */

const fs = require('fs');
const path = require('path');

function generateMailContent(rawName) {
  const baseName = rawName.replace(/email$/i, '').replace(/mail$/i, '').trim();
  const cleanBase = baseName.charAt(0).toUpperCase() + baseName.slice(1);
  const className = `${cleanBase}Email`;
  const tplName = cleanBase.toLowerCase();

  return `'use strict';

const { Mailable } = require('webspresso');

/**
 * Mailable: ${className}
 * Send via: req.mailer.send(new ${className}(user))
 */
class ${className} extends Mailable {
  constructor(recipient, data = {}) {
    super();
    this.recipient = recipient;
    this.data = data;
  }

  /**
   * Build email definition
   */
  build() {
    const toAddress = typeof this.recipient === 'string' ? this.recipient : this.recipient?.email;
    const toName = typeof this.recipient === 'object' ? this.recipient?.name : undefined;

    this.to(toAddress, toName)
      .subject('Hello from Webspresso')
      .view('${tplName}', this.data);
  }
}

module.exports = {
  ${className},
};
`;
}

function registerCommand(program) {
  program
    .command('make:mail <name>')
    .alias('mail:make')
    .alias('make:mailable')
    .description('Scaffold a declarative Mailable class in emails/<name>.js')
    .option('--root <dir>', 'Root directory of the project', process.cwd())
    .action((nameArg, options) => {
      const rootDir = path.resolve(options.root || process.cwd());
      const emailsDir = path.join(rootDir, 'emails');

      if (!fs.existsSync(emailsDir)) {
        fs.mkdirSync(emailsDir, { recursive: true });
      }

      const rawName = String(nameArg || '').trim();
      if (!rawName) {
        console.error('❌ Mailable name is required.');
        process.exitCode = 1;
        return;
      }

      const cleanName = rawName.replace(/\.js$/, '');
      const fileName = cleanName.endsWith('Email') ? cleanName : `${cleanName}Email`;
      const targetFilePath = path.join(emailsDir, `${fileName}.js`);

      if (fs.existsSync(targetFilePath)) {
        console.error(`❌ Mailable file already exists: ${path.relative(rootDir, targetFilePath)}`);
        process.exitCode = 1;
        return;
      }

      const content = generateMailContent(cleanName);
      fs.writeFileSync(targetFilePath, content, 'utf-8');
      console.log(`\n✅ Created Mailable class: ${path.relative(rootDir, targetFilePath)}\n`);
    });
}

module.exports = {
  registerCommand,
  generateMailContent,
};
