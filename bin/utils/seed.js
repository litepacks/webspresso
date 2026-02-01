/**
 * Seed Utilities
 * Functions for generating seed file templates
 */

/**
 * Get seed file template content
 * @returns {string} Seed file template
 */
function getSeedFileTemplate() {
  return `require('dotenv').config();
const { faker } = require('@faker-js/faker');
const path = require('path');
const fs = require('fs');
const { createDatabase, getAllModels } = require('webspresso/orm');
const dbConfig = require('../webspresso.db.js');

const db = createDatabase(dbConfig);
const seeder = db.seeder(faker);

/**
 * Load all models from models/ directory
 */
function loadModels() {
  const modelsDir = path.join(__dirname, '..', 'models');
  
  if (!fs.existsSync(modelsDir)) {
    return [];
  }
  
  const modelFiles = fs.readdirSync(modelsDir)
    .filter(file => file.endsWith('.js') && !file.startsWith('_'));
  
  const loadedModels = [];
  for (const file of modelFiles) {
    try {
      require(path.join(modelsDir, file));
      loadedModels.push(file);
    } catch (error) {
      console.warn(\`⚠️  Failed to load model from \${file}:\`, error.message);
    }
  }
  
  return loadedModels;
}

/**
 * Seed database with fake data
 * This script automatically detects models in the models/ directory
 * and generates seed data based on their schemas.
 */
async function runSeeds() {
  try {
    console.log('🌱 Starting seed process...');
    
    // Load all models
    const loadedFiles = loadModels();
    
    if (loadedFiles.length === 0) {
      console.log('⚠️  No model files found in models/ directory.');
      console.log('   Create models first, then run: webspresso seed');
      await db.knex.destroy();
      return;
    }
    
    // Get all registered models
    const models = getAllModels();
    
    if (models.size === 0) {
      console.log('⚠️  No models registered. Make sure your model files export models using defineModel().');
      await db.knex.destroy();
      return;
    }
    
    console.log(\`📦 Found \${models.size} model(s):\`);
    for (const [name] of models) {
      console.log(\`   - \${name}\`);
    }
    
    // Seed each model
    const results = {};
    for (const [modelName, model] of models) {
      console.log(\`\\n🌱 Seeding \${modelName}...\`);
      
      // Default count: 10 records per model
      const count = 10;
      const records = await seeder.seed(modelName, count);
      results[modelName] = records.length;
      
      console.log(\`✅ Created \${records.length} \${modelName} record(s)\`);
    }
    
    console.log(\`\\n✨ Seed completed! Created:\`);
    for (const [modelName, count] of Object.entries(results)) {
      console.log(\`   - \${count} \${modelName} record(s)\`);
    }
    
    await db.knex.destroy();
  } catch (error) {
    console.error('❌ Seed failed:', error);
    await db.knex.destroy().catch(() => {});
    process.exit(1);
  }
}

runSeeds();
`;
}

module.exports = {
  getSeedFileTemplate
};
