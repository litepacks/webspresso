/**
 * Migration Scaffold Unit Tests
 */

const { z } = require('zod');
const { zdb, defineModel, clearRegistry } = require('../../../core/orm');
const {
  scaffoldMigration,
  scaffoldAlterMigration,
  scaffoldDropMigration,
  generateColumnLine,
  generateMigrationName,
} = require('../../../core/orm/migrations/scaffold');

describe('Migration Scaffold', () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe('generateColumnLine', () => {
    it('should generate bigIncrements for primary key', () => {
      const meta = { type: 'bigint', primary: true, autoIncrement: true };
      const { line } = generateColumnLine('id', meta);
      
      expect(line).toContain("table.bigIncrements('id')");
    });

    it('should generate string with maxLength', () => {
      const meta = { type: 'string', maxLength: 100, nullable: false };
      const { line } = generateColumnLine('name', meta);
      
      expect(line).toContain("table.string('name', 100)");
      expect(line).toContain('.notNullable()');
    });

    it('should generate nullable string', () => {
      const meta = { type: 'string', maxLength: 255, nullable: true };
      const { line } = generateColumnLine('nickname', meta);
      
      expect(line).toContain('.nullable()');
      expect(line).not.toContain('.notNullable()');
    });

    it('should generate unique constraint', () => {
      const meta = { type: 'string', maxLength: 255, unique: true, nullable: false };
      const { line } = generateColumnLine('email', meta);
      
      expect(line).toContain('.unique()');
    });

    it('should generate index line', () => {
      const meta = { type: 'string', maxLength: 255, index: true, nullable: false };
      const { line, indexLine } = generateColumnLine('searchable', meta);
      
      expect(indexLine).toBe("table.index(['searchable']);");
    });

    it('should not generate index for unique columns', () => {
      const meta = { type: 'string', maxLength: 255, unique: true, index: true, nullable: false };
      const { indexLine } = generateColumnLine('email', meta);
      
      expect(indexLine).toBeNull();
    });

    it('should generate foreign key with reference', () => {
      const meta = { type: 'bigint', references: 'users', referenceColumn: 'id', nullable: false };
      const { line, fkLine } = generateColumnLine('user_id', meta);
      
      expect(line).toContain("table.bigInteger('user_id').unsigned()");
      expect(fkLine).toContain("table.foreign('user_id')");
      expect(fkLine).toContain(".references('id')");
      expect(fkLine).toContain(".inTable('users')");
    });

    it('should generate enum with values', () => {
      const meta = { type: 'enum', enumValues: ['active', 'inactive'], nullable: false };
      const { line } = generateColumnLine('status', meta);
      
      expect(line).toContain("table.enum('status', ['active', 'inactive'])");
    });

    it('should generate string column for file type (URL storage)', () => {
      const meta = { type: 'file', maxLength: 2048, nullable: true };
      const { line } = generateColumnLine('attachment', meta);

      expect(line).toContain("table.string('attachment', 2048)");
      expect(line).toContain('.nullable()');
    });

    it('should generate default value for string', () => {
      const meta = { type: 'string', maxLength: 50, default: 'draft', nullable: false };
      const { line } = generateColumnLine('state', meta);
      
      expect(line).toContain(".defaultTo('draft')");
    });

    it('should generate default value for boolean', () => {
      const meta = { type: 'boolean', default: false, nullable: false };
      const { line } = generateColumnLine('active', meta);
      
      expect(line).toContain('.defaultTo(false)');
    });

    it('should generate timestamp with auto create', () => {
      const meta = { type: 'timestamp', auto: 'create', nullable: true };
      const { line } = generateColumnLine('created_at', meta);
      
      expect(line).toContain('.defaultTo(knex.fn.now())');
    });

    it('should generate decimal with precision and scale', () => {
      const meta = { type: 'decimal', precision: 8, scale: 4, nullable: false };
      const { line } = generateColumnLine('price', meta);
      
      expect(line).toContain("table.decimal('price', 8, 4)");
    });

    it('should generate json column', () => {
      const meta = { type: 'json', nullable: true };
      const { line } = generateColumnLine('metadata', meta);
      
      expect(line).toContain("table.json('metadata')");
    });

    it('should generate uuid column', () => {
      const meta = { type: 'uuid', primary: true };
      const { line } = generateColumnLine('id', meta);
      
      expect(line).toContain("table.uuid('id')");
      expect(line).toContain('.primary()');
    });

    it('should generate nanoid primary column as varchar', () => {
      const meta = { type: 'nanoid', primary: true, maxLength: 21 };
      const { line } = generateColumnLine('id', meta);
      
      expect(line).toContain("table.string('id', 21)");
      expect(line).toContain('.primary()');
    });

    it('should generate nanoid foreign key', () => {
      const meta = {
        type: 'nanoid',
        references: 'posts',
        referenceColumn: 'id',
        maxLength: 12,
      };
      const { line, fkLine } = generateColumnLine('post_id', meta);
      
      expect(line).toContain("table.string('post_id', 12)");
      expect(fkLine).toContain("references('id').inTable('posts')");
    });
  });

  describe('scaffoldMigration', () => {
    it('should generate complete migration from model', () => {
      const schema = zdb.schema({
        id: zdb.id(),
        email: zdb.string({ maxLength: 255, unique: true, index: true }),
        name: zdb.string({ maxLength: 100 }),
        status: zdb.enum(['active', 'inactive'], { default: 'active' }),
        created_at: zdb.timestamp({ auto: 'create' }),
      });

      const model = defineModel({
        name: 'User',
        table: 'users',
        schema,
      });

      const migration = scaffoldMigration(model);

      // Check exports.up structure
      expect(migration).toContain('exports.up = function(knex)');
      expect(migration).toContain("knex.schema.createTable('users'");
      
      // Check columns
      expect(migration).toContain("table.bigIncrements('id')");
      expect(migration).toContain("table.string('email', 255)");
      expect(migration).toContain('.unique()');
      expect(migration).toContain("table.enum('status'");
      
      // Check exports.down
      expect(migration).toContain('exports.down = function(knex)');
      expect(migration).toContain("dropTableIfExists('users')");
    });

    it('should include foreign key references', () => {
      const schema = z.object({
        id: zdb.id(),
        company_id: zdb.foreignKey('companies'),
      });

      const model = defineModel({
        name: 'Employee',
        table: 'employees',
        schema,
      });

      const migration = scaffoldMigration(model);

      expect(migration).toContain("table.bigInteger('company_id').unsigned()");
      expect(migration).toContain('// Foreign keys');
      expect(migration).toContain("table.foreign('company_id')");
    });
  });

  describe('scaffoldAlterMigration', () => {
    it('should generate alter table migration', () => {
      const columns = new Map([
        ['avatar_url', { type: 'string', maxLength: 500, nullable: true }],
        ['bio', { type: 'text', nullable: true }],
      ]);

      const migration = scaffoldAlterMigration('users', columns);

      expect(migration).toContain('exports.up = function(knex)');
      expect(migration).toContain("knex.schema.alterTable('users'");
      expect(migration).toContain("table.string('avatar_url', 500)");
      expect(migration).toContain("table.text('bio')");
      
      // Check down migration drops columns
      expect(migration).toContain("table.dropColumn('avatar_url')");
      expect(migration).toContain("table.dropColumn('bio')");
    });
  });

  describe('scaffoldDropMigration', () => {
    it('should generate drop table migration', () => {
      const migration = scaffoldDropMigration('old_table');

      expect(migration).toContain('exports.up = function(knex)');
      expect(migration).toContain("dropTableIfExists('old_table')");
      expect(migration).toContain('exports.down = function(knex)');
      expect(migration).toContain("we don't know the original schema");
    });
  });

  describe('generateMigrationName', () => {
    it('should generate create migration name', () => {
      const model = { name: 'User', table: 'users' };
      
      expect(generateMigrationName(model)).toBe('create_users_table');
    });

    it('should generate alter migration name', () => {
      const model = { name: 'User', table: 'users' };
      
      expect(generateMigrationName(model, 'alter')).toBe('alter_users_table');
    });

    it('should generate drop migration name', () => {
      const model = { name: 'User', table: 'users' };
      
      expect(generateMigrationName(model, 'drop')).toBe('drop_users_table');
    });
  });
});

