import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test_secret_for_order_scanner_test';

import { setMockDB } from '../db.js';

function cloneDoc(doc) {
  if (!doc) return null;
  const clone = { ...doc };
  if (doc._id) {
    clone._id = new ObjectId(doc._id.toString());
  }
  if (doc.items) {
    clone.items = doc.items.map(item => {
      const itemClone = { ...item };
      if (item.id) {
        itemClone.id = new ObjectId(item.id.toString());
      }
      return itemClone;
    });
  }
  return clone;
}

// Setup Mock Collections
class MockConfigsCollection {
  constructor() {
    this.docs = [
      { key: 'convenience_fee_enabled', value: true },
      { key: 'convenience_fee_amount', value: 5.5 }
    ];
  }
  async findOne(query) {
    const doc = this.docs.find(d => d.key === query.key);
    return doc ? cloneDoc(doc) : null;
  }
  find(query) {
    let matched = this.docs;
    if (query && query.key && query.key.$in) {
      matched = this.docs.filter(d => query.key.$in.includes(d.key));
    }
    return {
      toArray: async () => matched.map(d => cloneDoc(d))
    };
  }
}

class MockMenuItemsCollection {
  constructor() {
    this.docs = [
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d910'), name: 'Spring Rolls', price: 10, available: true },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d911'), name: 'Fried Rice', price: 15, available: true },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d912'), name: 'Unavailable Tea', price: 3, available: false },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d913'), name: 'Deleted Coffee', price: 4, available: true, deleted: true }
    ];
  }
  async findOne(query) {
    const idStr = query._id?.toString();
    const doc = this.docs.find(d => d._id.toString() === idStr);
    return doc ? cloneDoc(doc) : null;
  }
  find(query) {
    let matched = this.docs;
    if (query && query._id && query._id.$in) {
      const ids = query._id.$in.map(id => id.toString());
      matched = this.docs.filter(d => ids.includes(d._id.toString()));
    }
    return {
      toArray: async () => matched.map(d => cloneDoc(d))
    };
  }
}

class MockOrdersCollection {
  constructor() {
    this.docs = [];
    this.inserted = [];
    this.failOnInsert = false;
    this.failWithCode11000 = false;
    this.collisionIndex = null;
  }
  async findOne(query) {
    let doc = null;
    if (query.idempotencyKey) {
      doc = this.docs.find(d => d.idempotencyKey === query.idempotencyKey);
    } else if (query.checkoutSessionId) {
      doc = this.docs.find(d => d.checkoutSessionId === query.checkoutSessionId);
    }
    return doc ? cloneDoc(doc) : null;
  }
  async insertOne(doc) {
    if (this.failOnInsert) {
      throw new Error('Database connection failed.');
    }
    if (this.failWithCode11000) {
      const err = new Error('E11000 duplicate key error collection');
      err.code = 11000;
      err.keyPattern = {};
      if (this.collisionIndex === 'idempotencyKey') {
        err.keyPattern.idempotencyKey = 1;
      } else if (this.collisionIndex === 'checkoutSessionId') {
        err.keyPattern.checkoutSessionId = 1;
      } else {
        err.keyPattern.otherIndex = 1;
      }
      throw err;
    }
    const docClone = cloneDoc(doc);
    this.inserted.push(docClone);
    this.docs.push(docClone);
    return { insertedId: docClone._id };
  }
}

class MockEventsCollection {
  constructor() {
    this.inserted = [];
  }
  async insertOne(doc) {
    this.inserted.push(doc);
    return { insertedId: new ObjectId() };
  }
}

const mockConfigs = new MockConfigsCollection();
const mockMenuItems = new MockMenuItemsCollection();
const mockOrders = new MockOrdersCollection();
const mockEvents = new MockEventsCollection();

const mockDb = {
  collection: (name) => {
    if (name === 'configs') return mockConfigs;
    if (name === 'menu_items') return mockMenuItems;
    if (name === 'orders') return mockOrders;
    if (name === 'employee_activity_events') return mockEvents;
    return {
      insertOne: async () => ({ insertedId: new ObjectId() }),
      deleteMany: async () => ({ deletedCount: 1 }),
      createIndex: async () => {},
      aggregate: () => ({ toArray: async () => [] })
    };
  }
};

setMockDB(mockDb);

// Import router/app stack
const ordersRouter = (await import('./orders.js')).default;

// Mock Response Helper
function mockResponse() {
  const res = {
    status: (code) => { res.statusCode = code; return res; },
    send: (body) => { res.body = body; return res; },
    json: (json) => { res.body = json; return res; },
    statusCode: 200,
    body: null
  };
  return res;
}

// Simulates Express route execution
async function simulateRequest(path, method, req) {
  const routeLayer = ordersRouter.stack.find(layer =>
    layer.route &&
    layer.route.path === path &&
    Object.keys(layer.route.methods).includes(method.toLowerCase())
  );
  if (!routeLayer) {
    throw new Error(`Route not found: ${method} ${path}`);
  }
  const res = mockResponse();
  let currentLayerIndex = 0;
  const next = async (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    const nextLayer = routeLayer.route.stack[currentLayerIndex++];
    if (nextLayer) {
      if (currentLayerIndex === routeLayer.route.stack.length) {
        await nextLayer.handle(req, res, next);
      } else {
        let nextPromise;
        const wrappedNext = (subErr) => {
          nextPromise = next(subErr);
        };
        await nextLayer.handle(req, res, wrappedNext);
        if (nextPromise) {
          await nextPromise;
        }
      }
    }
  };
  await next();
  return res;
}

const adminToken = jwt.sign(
  { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
  'test_secret_for_order_scanner_test'
);

test('Admin Order Scanner - Authoritative Manual Order Pricing', async (t) => {
  await t.test('Manual order ignores client-manipulated prices and totals', async () => {
    mockOrders.docs = [];
    mockOrders.inserted = [];
    mockEvents.inserted = [];

    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: {
        'idempotency-key': 'manual-idempotency-key-1'
      },
      body: {
        table: 'Table 5',
        source: 'MANUAL',
        total: 9999, // Manipulated total
        paymentStatus: 'PENDING',
        items: [
          {
            id: '60c72b2f9b1d8e23f0c3d910',
            name: 'Manipulated Name',
            price: 99.9, // Manipulated price
            quantity: 2
          }
        ]
      }
    };

    const res = await simulateRequest('/', 'POST', req);
    assert.equal(res.statusCode, 201);
    
    // Total should be: 2 * 10 (price of Spring Rolls) = 20
    // Total Payable should be: 20 + 5.5 (convenience fee) = 25.5
    assert.equal(res.body.total, 20);
    assert.equal(res.body.totalPayable, 25.5);
    assert.equal(res.body.items[0].price, 10);
    assert.equal(res.body.items[0].name, 'Spring Rolls');
    
    // Verifies MongoDB ObjectId type is preserved in database items
    assert.ok(mockOrders.inserted[0].items[0].id instanceof ObjectId);
  });
});

test('Admin Order Scanner - Rejection & Validation Bounds', async (t) => {
  await t.test('Rejects missing menu item', async () => {
    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'key-missing-item' },
      body: {
        table: 'Table 5',
        source: 'MANUAL',
        total: 10,
        paymentStatus: 'PENDING',
        items: [{ id: '60c72b2f9b1d8e23f0c3d999', quantity: 1 }] // non-existent
      }
    };
    const res = await simulateRequest('/', 'POST', req);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /not found/i);
  });

  await t.test('Rejects unavailable menu item', async () => {
    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'key-unavailable-item' },
      body: {
        table: 'Table 5',
        source: 'MANUAL',
        total: 10,
        paymentStatus: 'PENDING',
        items: [{ id: '60c72b2f9b1d8e23f0c3d912', quantity: 1 }] // unavailable
      }
    };
    const res = await simulateRequest('/', 'POST', req);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /unavailable/i);
  });

  await t.test('Rejects deleted menu item', async () => {
    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'key-deleted-item' },
      body: {
        table: 'Table 5',
        source: 'MANUAL',
        total: 10,
        paymentStatus: 'PENDING',
        items: [{ id: '60c72b2f9b1d8e23f0c3d913', quantity: 1 }] // deleted
      }
    };
    const res = await simulateRequest('/', 'POST', req);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /deleted/i);
  });

  await t.test('Rejects malformed item ObjectId', async () => {
    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'key-malformed-id' },
      body: {
        table: 'Table 5',
        source: 'MANUAL',
        total: 10,
        paymentStatus: 'PENDING',
        items: [{ id: 'invalid-object-id', quantity: 1 }]
      }
    };
    const res = await simulateRequest('/', 'POST', req);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /invalid item ID/i);
  });

  await t.test('Merges duplicate item IDs deterministically', async () => {
    mockOrders.docs = [];
    mockOrders.inserted = [];
    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'key-duplicate-merge' },
      body: {
        table: 'Table 5',
        source: 'MANUAL',
        total: 20,
        paymentStatus: 'PENDING',
        items: [
          { id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 },
          { id: '60c72b2f9b1d8e23f0c3d910', quantity: 2 } // duplicate item
        ]
      }
    };
    const res = await simulateRequest('/', 'POST', req);
    assert.equal(res.statusCode, 201);
    // Quantity should be merged to 3
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].quantity, 3);
  });

  await t.test('Enforces item quantity and order total limits', async () => {
    const reqTooHighQty = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'key-limit-qty-valid-length' },
      body: {
        table: 'Table 5',
        source: 'MANUAL',
        total: 10,
        paymentStatus: 'PENDING',
        items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 100 }] // Exceeds MAX_ITEM_QUANTITY (99)
      }
    };
    const res = await simulateRequest('/', 'POST', reqTooHighQty);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /exceeds the maximum limit/i);
  });
});

test('Admin Order Scanner - Idempotency Keys and Payload Binding', async (t) => {
  await t.test('Rejects manual orders with missing idempotency key', async () => {
    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: {
        table: 'Table 5',
        source: 'MANUAL',
        total: 10,
        paymentStatus: 'PENDING',
        items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }]
      }
    };
    const res = await simulateRequest('/', 'POST', req);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /idempotency-key/i);
  });

  await t.test('Rejects manual orders with malformed idempotency key', async () => {
    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'short' }, // too short
      body: {
        table: 'Table 5',
        source: 'MANUAL',
        total: 10,
        paymentStatus: 'PENDING',
        items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }]
      }
    };
    const res = await simulateRequest('/', 'POST', req);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /format/i);
  });

  await t.test('Replaying same key with same payload returns original order idempotently', async () => {
    mockOrders.docs = [];
    mockOrders.inserted = [];

    const payload = {
      table: 'Table 5',
      source: 'MANUAL',
      total: 10,
      paymentStatus: 'PENDING',
      items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }]
    };

    // First request
    const req1 = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'matching-idempotency-key' },
      body: payload
    };
    const res1 = await simulateRequest('/', 'POST', req1);
    assert.equal(res1.statusCode, 201);
    assert.equal(res1.body.duplicate, undefined);

    // Second request (identical)
    const res2 = await simulateRequest('/', 'POST', req1);
    assert.equal(res2.statusCode, 201);
    assert.equal(res2.body.duplicate, true);
    assert.equal(res2.body._id.toString(), res1.body._id.toString());
  });

  await t.test('Replaying same key with different payload returns 409 Conflict', async () => {
    const payload1 = {
      table: 'Table 5',
      source: 'MANUAL',
      total: 10,
      paymentStatus: 'PENDING',
      items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }]
    };

    const payload2 = {
      table: 'Table 6', // modified table name
      source: 'MANUAL',
      total: 10,
      paymentStatus: 'PENDING',
      items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }]
    };

    const req1 = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'conflict-idempotency-key' },
      body: payload1
    };

    const req2 = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'conflict-idempotency-key' },
      body: payload2
    };

    const res1 = await simulateRequest('/', 'POST', req1);
    assert.equal(res1.statusCode, 201);

    const res2 = await simulateRequest('/', 'POST', req2);
    assert.equal(res2.statusCode, 409);
    assert.match(res2.body.error, /conflict/i);
  });
});

test('Admin Order Scanner - Idempotency Replays & Side-Effects', async (t) => {
  await t.test('Idempotent replay via unique index collision does not broadcast duplicate KDS or audit log events', async () => {
    mockOrders.docs = [];
    mockOrders.inserted = [];
    mockEvents.inserted = [];
    mockOrders.failWithCode11000 = false;

    const payload = {
      table: 'Table 5',
      source: 'MANUAL',
      total: 10,
      paymentStatus: 'PENDING',
      items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }]
    };

    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'event-gate-key-valid-length' },
      body: payload
    };

    // First request creating the order
    const res1 = await simulateRequest('/', 'POST', req);
    assert.equal(res1.statusCode, 201);
    assert.equal(mockOrders.inserted.length, 1);
    assert.equal(mockEvents.inserted.length, 1); // 1 audit event

    // Simulate concurrent insert unique key violation
    mockOrders.failWithCode11000 = true;
    mockOrders.collisionIndex = 'idempotencyKey';

    const res2 = await simulateRequest('/', 'POST', req);
    assert.equal(res2.statusCode, 201);
    assert.equal(res2.body.duplicate, true);

    // Assert that no new document was written, and audit event remained at 1
    assert.equal(mockOrders.inserted.length, 1);
    assert.equal(mockEvents.inserted.length, 1);
  });

  await t.test('Re-throws unrelated unique index collision errors', async () => {
    mockOrders.docs = [];
    mockOrders.inserted = [];
    mockOrders.failWithCode11000 = true;
    mockOrders.collisionIndex = 'otherIndex'; // unrelated collision

    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'event-unrelated-error' },
      body: {
        table: 'Table 5',
        source: 'MANUAL',
        total: 10,
        paymentStatus: 'PENDING',
        items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }]
      }
    };

    const res = await simulateRequest('/', 'POST', req);
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /confirm order/i);
  });
});

test('Admin Order Scanner - Scanned Checkout Sessions', async (t) => {
  await t.test('Scanned order prevents duplicate creation for same checkoutSessionId', async () => {
    mockOrders.docs = [];
    mockOrders.inserted = [];
    mockEvents.inserted = [];
    mockOrders.failWithCode11000 = false;

    const payload = {
      table: 'Table 5',
      source: 'CODE',
      total: 10,
      paymentStatus: 'PENDING',
      checkoutSessionId: 'sess_duplicate_test',
      items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }]
    };

    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: payload
    };

    // First request
    const res1 = await simulateRequest('/', 'POST', req);
    assert.equal(res1.statusCode, 201);
    assert.equal(mockOrders.inserted.length, 1);

    // Second request with same checkoutSessionId
    const res2 = await simulateRequest('/', 'POST', req);
    assert.equal(res2.statusCode, 201);
    assert.equal(res2.body.duplicate, true);
    assert.equal(mockOrders.inserted.length, 1);
  });
});

test('Admin Order Scanner - Convenience Fee Calculations Regression', async (t) => {
  await t.test('Fee calculations for enabled state', async () => {
    mockConfigs.docs = [
      { key: 'convenience_fee_enabled', value: true },
      { key: 'convenience_fee_amount', value: 12.5 }
    ];
    mockOrders.docs = [];
    mockOrders.inserted = [];

    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'fee-enabled-key-valid' },
      body: {
        table: 'Table 5',
        source: 'MANUAL',
        total: 10,
        paymentStatus: 'PENDING',
        items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }]
      }
    };

    const res = await simulateRequest('/', 'POST', req);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.total, 10);
    assert.equal(res.body.convenienceFee, 12.5);
    assert.equal(res.body.totalPayable, 22.5);
  });

  await t.test('Fee calculations for disabled state', async () => {
    mockConfigs.docs = [
      { key: 'convenience_fee_enabled', value: false },
      { key: 'convenience_fee_amount', value: 12.5 }
    ];
    mockOrders.docs = [];
    mockOrders.inserted = [];

    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'fee-disabled-key' },
      body: {
        table: 'Table 5',
        source: 'MANUAL',
        total: 10,
        paymentStatus: 'PENDING',
        items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }]
      }
    };

    const res = await simulateRequest('/', 'POST', req);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.total, 10);
    assert.equal(res.body.convenienceFee, 0);
    assert.equal(res.body.totalPayable, 10);
  });

  await t.test('Fee calculations for zero value state', async () => {
    mockConfigs.docs = [
      { key: 'convenience_fee_enabled', value: true },
      { key: 'convenience_fee_amount', value: 0 }
    ];
    mockOrders.docs = [];
    mockOrders.inserted = [];

    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@test.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      headers: { 'idempotency-key': 'fee-zero-key-valid' },
      body: {
        table: 'Table 5',
        source: 'MANUAL',
        total: 10,
        paymentStatus: 'PENDING',
        items: [{ id: '60c72b2f9b1d8e23f0c3d910', quantity: 1 }]
      }
    };

    const res = await simulateRequest('/', 'POST', req);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.total, 10);
    assert.equal(res.body.convenienceFee, 0);
    assert.equal(res.body.totalPayable, 10);
  });
});
