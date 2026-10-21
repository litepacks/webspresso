'use strict';

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import knexLib from 'knex';
import { z } from 'zod';
import { defineModel, clearRegistry } from '../../../core/orm/model';
import { createRepository } from '../../../core/orm/repository';
import { calculateSafeChunkSize, chunkArray } from '../../../core/orm/batch';

describe('ORM Batch & Upsert Operations', () => {
  let knex;
  let ProductRepo;
  let ProductModel;
  let WideRepo;
  let WideModel;

  beforeAll(async () => {
    clearRegistry();
    knex = knexLib({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await knex.schema.createTable('products', (t) => {
      t.increments('id').primary();
      t.string('sku').unique().notNullable();
      t.string('name').notNullable();
      t.integer('price').notNullable();
      t.json('metadata');
      t.timestamps(true, true);
    });

    // Model with 20 columns to test parameter limit chunking
    await knex.schema.createTable('wide_items', (t) => {
      t.increments('id').primary();
      for (let i = 1; i <= 20; i++) {
        t.string(`field_${i}`);
      }
      t.timestamps(true, true);
    });

    ProductModel = defineModel({
      name: 'Product',
      table: 'products',
      schema: z.object({
        id: z.number().int().optional(),
        sku: z.string().min(1),
        name: z.string().min(1),
        price: z.number().int(),
        metadata: z.record(z.any()).optional(),
        created_at: z.any().optional(),
        updated_at: z.any().optional(),
      }),
    });

    ProductRepo = createRepository(ProductModel, knex);

    WideModel = defineModel({
      name: 'WideItem',
      table: 'wide_items',
      schema: z.object({
        id: z.number().int().optional(),
        field_1: z.string().optional(),
        field_20: z.string().optional(),
      }).passthrough(),
    });

    WideRepo = createRepository(WideModel, knex);
  });

  beforeEach(async () => {
    await knex('products').delete();
    await knex('wide_items').delete();
  });

  afterAll(async () => {
    clearRegistry();
    if (knex) {
      await knex.destroy();
    }
  });

  describe('Batch Chunk Utilities', () => {
    it('calculates safe chunk size for SQLite based on column count', () => {
      // With 20 columns on SQLite (max safe params 990), chunk size should be 49
      const safeChunk = calculateSafeChunkSize(knex, 20);
      expect(safeChunk).toBe(49);

      // With 5 columns, chunk size should be 198
      expect(calculateSafeChunkSize(knex, 5)).toBe(198);
    });

    it('caps user requested chunkSize if it exceeds SQLite parameter limit', () => {
      const safe = calculateSafeChunkSize(knex, 20, 1000);
      expect(safe).toBe(49);
    });

    it('respects requested chunkSize if smaller than safe limit', () => {
      const safe = calculateSafeChunkSize(knex, 5, 50);
      expect(safe).toBe(50);
    });

    it('splits arrays accurately into chunks', () => {
      const list = [1, 2, 3, 4, 5, 6, 7];
      const chunks = chunkArray(list, 3);
      expect(chunks).toEqual([
        [1, 2, 3],
        [4, 5, 6],
        [7],
      ]);
    });
  });

  describe('createBatch', () => {
    it('creates multiple records in a batch and sets timestamps and JSON', async () => {
      const items = [
        { sku: 'P1', name: 'Product 1', price: 100, metadata: { color: 'red' } },
        { sku: 'P2', name: 'Product 2', price: 200, metadata: { color: 'blue' } },
        { sku: 'P3', name: 'Product 3', price: 300, metadata: { color: 'green' } },
      ];

      const created = await ProductRepo.createBatch(items);
      expect(created.length).toBe(3);
      expect(created[0].id).toBe(1);
      expect(created[0].sku).toBe('P1');
      expect(created[0].metadata).toEqual({ color: 'red' });
      expect(created[0].created_at).toBeDefined();

      const count = await ProductRepo.count();
      expect(count).toBe(3);
    });

    it('rolls back entire batch if any item fails validation or DB constraint', async () => {
      const items = [
        { sku: 'V1', name: 'Valid 1', price: 100 },
        { sku: 'V2', name: '', price: 200 }, // Invalid name fails Zod validation
        { sku: 'V3', name: 'Valid 3', price: 300 },
      ];

      await expect(ProductRepo.createBatch(items)).rejects.toThrow();

      const count = await ProductRepo.count();
      expect(count).toBe(0);
    });

    it('rolls back entire batch if unique constraint fails inside transaction', async () => {
      await ProductRepo.create({ sku: 'EXISTING', name: 'Existing', price: 50 });

      const items = [
        { sku: 'NEW1', name: 'New 1', price: 100 },
        { sku: 'EXISTING', name: 'Duplicate', price: 200 }, // Constraint violation
        { sku: 'NEW2', name: 'New 2', price: 300 },
      ];

      await expect(ProductRepo.createBatch(items)).rejects.toThrow();

      // Only the initial record should exist, NEW1 was rolled back
      const count = await ProductRepo.count();
      expect(count).toBe(1);
    });

    it('handles thousands of rows without hitting SQLite too many SQL variables error', async () => {
      // Create 1500 wide rows (1500 rows * 22 columns = 33,000 variables)
      const rows = [];
      for (let i = 0; i < 1500; i++) {
        const row = {};
        for (let c = 1; c <= 20; c++) {
          row[`field_${c}`] = `val_${i}_${c}`;
        }
        rows.push(row);
      }

      // Without auto-chunking, this would crash SQLite with "too many SQL variables"
      const created = await WideRepo.createBatch(rows);
      expect(created.length).toBe(1500);

      const count = await WideRepo.count();
      expect(count).toBe(1500);
    });
  });

  describe('createMany Backward Compatibility', () => {
    it('delegates createMany to createBatch with same results', async () => {
      const created = await ProductRepo.createMany([
        { sku: 'CM1', name: 'Item 1', price: 10 },
        { sku: 'CM2', name: 'Item 2', price: 20 },
      ]);

      expect(created.length).toBe(2);
      expect(created[0].sku).toBe('CM1');
      expect(created[1].sku).toBe('CM2');
    });
  });

  describe('upsert', () => {
    it('inserts record if conflict target does not exist', async () => {
      const item = await ProductRepo.upsert(
        { sku: 'UP1', name: 'Initial', price: 50 },
        'sku'
      );

      expect(item.id).toBeDefined();
      expect(item.name).toBe('Initial');

      const found = await ProductRepo.findOne({ sku: 'UP1' });
      expect(found.price).toBe(50);
    });

    it('updates record if conflict target already exists', async () => {
      await ProductRepo.create({ sku: 'UP2', name: 'Original', price: 100 });

      // Upsert update
      const updated = await ProductRepo.upsert(
        { sku: 'UP2', name: 'Updated Name', price: 150 },
        'sku',
        ['name', 'price']
      );

      expect(updated.name).toBe('Updated Name');
      expect(updated.price).toBe(150);

      const all = await ProductRepo.findAll();
      expect(all.length).toBe(1);
      expect(all[0].name).toBe('Updated Name');
      expect(all[0].price).toBe(150);
    });
  });

  describe('upsertBatch', () => {
    it('atomically inserts new and updates existing records in chunks', async () => {
      await ProductRepo.create({ sku: 'BATCH_A', name: 'Old A', price: 10 });
      await ProductRepo.create({ sku: 'BATCH_B', name: 'Old B', price: 20 });

      const batchData = [
        { sku: 'BATCH_A', name: 'New A', price: 15 }, // existing -> update
        { sku: 'BATCH_B', name: 'New B', price: 25 }, // existing -> update
        { sku: 'BATCH_C', name: 'New C', price: 30 }, // new -> insert
        { sku: 'BATCH_D', name: 'New D', price: 40 }, // new -> insert
      ];

      const results = await ProductRepo.upsertBatch(batchData, 'sku', {
        updateColumns: ['name', 'price'],
      });

      expect(results.length).toBe(4);

      const all = await ProductRepo.findAll({ orderBy: { id: 'asc' } });
      expect(all.length).toBe(4);
      expect(all.find((p) => p.sku === 'BATCH_A').name).toBe('New A');
      expect(all.find((p) => p.sku === 'BATCH_B').name).toBe('New B');
      expect(all.find((p) => p.sku === 'BATCH_C').name).toBe('New C');
      expect(all.find((p) => p.sku === 'BATCH_D').name).toBe('New D');
    });

    it('returns empty array when given empty input', async () => {
      const res = await ProductRepo.upsertBatch([]);
      expect(res).toEqual([]);
    });
  });
});
