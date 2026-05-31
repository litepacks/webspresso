/**
 * Consistent CLI failure messages with optional hints.
 */

function fail(message, options = {}) {
  const { hint, command } = options;
  console.error(`\n❌ ${message}`);
  if (hint) {
    console.error(`\n   Hint: ${hint}`);
  }
  if (command) {
    console.error(`   Run: ${command}`);
  }
  console.error('');
  process.exit(typeof options.exitCode === 'number' ? options.exitCode : 1);
}

function warn(message, options = {}) {
  const { hint } = options;
  console.warn(`\n⚠️  ${message}`);
  if (hint) {
    console.warn(`   ${hint}`);
  }
}

module.exports = { fail, warn };
