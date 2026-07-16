const fs = require('fs');

function mockSharp(input) {
  const obj = {
    resize(width, height) {
      return obj;
    },
    png() {
      return obj;
    },
    async toBuffer() {
      return Buffer.from('dummy-png-data');
    },
    async toFile(outputPath) {
      fs.writeFileSync(outputPath, 'dummy-png-data');
    }
  };
  return obj;
}

module.exports = mockSharp;
