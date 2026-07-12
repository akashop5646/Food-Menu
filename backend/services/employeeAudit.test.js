import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';
import { setMockDB } from '../db.js';
import {
  validateAuditEvent,
  normalizeContext,
  recordEmployeeActivity,
  ValidationError
} from './employeeAudit.js';

class MockActivityCollection {
  constructor() {
    this.docs = [];
  }
  async insertOne(doc) {
    this.docs.push({ ...doc, _id: new ObjectId() });
    return { insertedId: this.docs[this.docs.length - 1]._id };
  }
}

test('Employee Activity Audit Trail Service Tests', async (t) => {
  const mockCollection = new MockActivityCollection();
  const mockDb = {
    collection: (name) => {
      if (name === 'employee_activity_events') {
        return mockCollection;
      }
      throw new Error(`Unexpected collection in mock: ${name}`);
    }
  };
  setMockDB(mockDb);

  const validActor = {
    userId: '123456789012345678901234',
    name: 'Test Actor',
    email: 'actor@test.com',
    role: 'ADMIN',
  };

  const validEntity = {
    type: 'MENU_ITEM',
    id: '111122223333444455556666',
    displayLabel: 'Test Menu Item',
  };

  await t.test('validateAuditEvent rejects invalid actor', () => {
    // Missing actor
    assert.throws(() => validateAuditEvent(null, 'MENU_ITEM_CREATED', validEntity, {}), ValidationError);
    // Invalid userId format
    assert.throws(() => validateAuditEvent({ ...validActor, userId: 'invalid' }, 'MENU_ITEM_CREATED', validEntity, {}), ValidationError);
    // Invalid role
    assert.throws(() => validateAuditEvent({ ...validActor, role: 'OWNER' }, 'MENU_ITEM_CREATED', validEntity, {}), ValidationError);
  });

  await t.test('validateAuditEvent rejects invalid action', () => {
    assert.throws(() => validateAuditEvent(validActor, 'INVALID_ACTION', validEntity, {}), ValidationError);
  });

  await t.test('validateAuditEvent rejects invalid entity', () => {
    // Invalid type
    assert.throws(() => validateAuditEvent(validActor, 'MENU_ITEM_CREATED', { ...validEntity, type: 'INVALID' }, {}), ValidationError);
    // id not null/string
    assert.throws(() => validateAuditEvent(validActor, 'MENU_ITEM_CREATED', { ...validEntity, id: 123 }, {}), ValidationError);
    // displayLabel too long
    const longLabel = 'a'.repeat(201);
    assert.throws(() => validateAuditEvent(validActor, 'MENU_ITEM_CREATED', { ...validEntity, displayLabel: longLabel }, {}), ValidationError);
  });

  await t.test('validateAuditEvent rejects context with unknown keys or invalid structures', () => {
    // Unknown key
    assert.throws(() => validateAuditEvent(validActor, 'MENU_ITEM_CREATED', validEntity, { price: 10, categories: ['Fast Food'], unknownKey: true }), ValidationError);
    // Nested object
    assert.throws(() => validateAuditEvent(validActor, 'MENU_ITEM_CREATED', validEntity, { price: 10, categories: { nested: 'object' } }), ValidationError);
    // String too long
    const longString = 'a'.repeat(1001);
    assert.throws(() => validateAuditEvent(validActor, 'STAFF_ACCOUNT_CREATED', validEntity, { name: longString, provider: 'EMAIL' }), ValidationError);
  });

  await t.test('validateAuditEvent rejects context value validator failures', () => {
    // Negative price
    assert.throws(() => validateAuditEvent(validActor, 'MENU_ITEM_CREATED', validEntity, { price: -5, categories: ['Fast Food'] }), ValidationError);
    // Invalid status option
    assert.throws(() => validateAuditEvent(validActor, 'ORDER_STATUS_CHANGED', validEntity, { toStatus: 'INVALID_STATUS' }), ValidationError);
  });

  await t.test('normalizeContext trims and deduplicates category arrays', () => {
    const raw = {
      price: 15,
      categories: [' Pizza ', 'Burger', ' Pizza', 'Salad', 'Burger'],
    };
    const normalized = normalizeContext('MENU_ITEM_CREATED', raw);
    assert.deepEqual(normalized.categories, ['Pizza', 'Burger', 'Salad']);
  });

  await t.test('normalizeContext deduplicates updatedFields arrays', () => {
    const raw = {
      updatedFields: ['name', 'price', 'name', 'categories'],
      availableTransition: true,
    };
    const normalized = normalizeContext('MENU_ITEM_UPDATED', raw);
    assert.deepEqual(normalized.updatedFields, ['name', 'price', 'categories']);
  });

  await t.test('validateAuditEvent rejects arrays exceeding max length 20', () => {
    const oversizedCategories = Array(21).fill('Category');
    assert.throws(() => validateAuditEvent(validActor, 'MENU_ITEM_CREATED', validEntity, { price: 5, categories: oversizedCategories }), ValidationError);

    const oversizedFields = Array(21).fill('name');
    assert.throws(() => validateAuditEvent(validActor, 'MENU_ITEM_UPDATED', validEntity, { updatedFields: oversizedFields, availableTransition: null }), ValidationError);
  });

  await t.test('recordEmployeeActivity successfully validates, normalizes, and inserts into DB', async () => {
    mockCollection.docs = [];
    const context = {
      price: 10,
      categories: ['  Dessert  ', 'Cake', 'Dessert'],
    };
    const success = await recordEmployeeActivity(validActor, 'MENU_ITEM_CREATED', validEntity, context);
    assert.equal(success, true);
    assert.equal(mockCollection.docs.length, 1);
    const doc = mockCollection.docs[0];
    assert.equal(doc.action, 'MENU_ITEM_CREATED');
    assert.deepEqual(doc.context.categories, ['Dessert', 'Cake']);
    assert.ok(doc.createdAt instanceof Date);
  });

  await t.test('recordEmployeeActivity is safe and catches internal errors without throwing', async () => {
    // Try recording with invalid parameters that cause validateAuditEvent to throw
    const success = await recordEmployeeActivity(null, 'MENU_ITEM_CREATED', validEntity, {});
    assert.equal(success, false); // Returned false indicating safe failure catch
  });
});
