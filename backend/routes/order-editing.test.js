import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test_secret_for_order_editing_test';

import { setMockDB } from '../db.js';

// Setup Mock Collections
class MockConfigsCollection {
  constructor() {
    this.docs = [
      { key: 'convenience_fee_enabled', value: true },
      { key: 'convenience_fee_amount', value: 2.0 }
    ];
  }
  async findOne(query) {
    const doc = this.docs.find(d => d.key === query.key);
    return doc ? { ...doc } : null;
  }
  find(query) {
    let matched = this.docs;
    if (query && query.key && query.key.$in) {
      matched = this.docs.filter(d => query.key.$in.includes(d.key));
    }
    return {
      toArray: async () => matched.map(d => ({ ...d }))
    };
  }
}

class MockTablesCollection {
  constructor() {
    this.docs = [
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9aa'), number: 5, name: 'Table 5', location: 'Garden', locationId: '60c72b2f9b1d8e23f0c3d9bb' }
    ];
  }
  async findOne(query) {
    const idStr = query._id?.toString();
    const doc = this.docs.find(d => d._id.toString() === idStr);
    return doc ? { ...doc } : null;
  }
}

class MockLocationsCollection {
  constructor() {
    this.docs = [
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9bb'), name: 'Garden' }
    ];
  }
  async findOne(query) {
    const idStr = query._id?.toString();
    const doc = this.docs.find(d => d._id.toString() === idStr);
    return doc ? { ...doc } : null;
  }
}

class MockMenuItemsCollection {
  constructor() {
    this.docs = [
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d901'), name: 'Paneer Tikka', price: 250, available: true },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d902'), name: 'Butter Naan', price: 50, available: true },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d903'), name: 'Unavailable Dish', price: 120, available: false },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d904'), name: 'Deleted Dish', price: 90, available: true, deleted: true }
    ];
  }
  find(query) {
    let matched = this.docs;
    if (query && query._id && query._id.$in) {
      const ids = query._id.$in.map(id => id.toString());
      matched = this.docs.filter(d => ids.includes(d._id.toString()));
    }
    return {
      toArray: async () => matched.map(d => ({ ...d }))
    };
  }
}

class MockOrdersCollection {
  constructor() {
    this.docs = [];
    this.updated = [];
    this.failOnUpdate = false;
  }
  async findOne(query) {
    const idStr = query._id?.toString();
    const doc = this.docs.find(d => d._id.toString() === idStr);
    return doc ? { ...doc } : null;
  }
  async updateOne(filter, update) {
    if (this.failOnUpdate) {
      return { modifiedCount: 0 };
    }
    const idStr = filter._id?.toString();
    const index = this.docs.findIndex(d => d._id.toString() === idStr);
    if (index === -1) {
      return { modifiedCount: 0 };
    }

    const doc = this.docs[index];

    // Concurrency version validation
    if (filter.version) {
      if (doc.version !== filter.version) {
        return { modifiedCount: 0 };
      }
    } else if (filter.$or) {
      const match = filter.$or.some(cond => {
        if (cond.version === 1 && doc.version === 1) return true;
        if (cond.version && cond.version.$exists === false && doc.version === undefined) return true;
        return false;
      });
      if (!match) {
        return { modifiedCount: 0 };
      }
    }

    const updatedDoc = {
      ...doc,
      ...update.$set
    };

    this.docs[index] = updatedDoc;
    this.updated.push(updatedDoc);
    return { modifiedCount: 1 };
  }
}

class MockOrderRevisionsCollection {
  constructor() {
    this.docs = [];
    this.inserted = [];
    this.failOnInsert = false;
    this.duplicateKeyError = false;
  }
  async insertOne(doc) {
    if (this.failOnInsert) {
      throw new Error('Database write failure');
    }
    if (this.duplicateKeyError) {
      const err = new Error('E11000 duplicate key error');
      err.code = 11000;
      throw err;
    }
    this.docs.push(doc);
    this.inserted.push(doc);
    return { insertedId: doc._id };
  }
  async updateOne(filter, update) {
    const idStr = filter._id?.toString();
    const index = this.docs.findIndex(d => d._id.toString() === idStr);
    if (index !== -1) {
      this.docs[index] = {
        ...this.docs[index],
        ...update.$set
      };
      return { modifiedCount: 1 };
    }
    return { modifiedCount: 0 };
  }
  async countDocuments(query) {
    return this.docs.filter(d => d.orderId.toString() === query.orderId.toString() && d.status === query.status).length;
  }
  find(query) {
    let matched = this.docs.filter(d => d.orderId.toString() === query.orderId.toString() && d.status === query.status);
    return {
      project: () => ({
        sort: () => ({
          skip: (val) => ({
            limit: (lVal) => ({
              toArray: async () => matched.slice(val, val + lVal)
            })
          })
        })
      })
    };
  }
}

class MockEmployeeActivityCollection {
  constructor() {
    this.inserted = [];
  }
  async insertOne(doc) {
    this.inserted.push(doc);
    return { insertedId: new ObjectId() };
  }
}

// Instantiate mocks
const mockConfigs = new MockConfigsCollection();
const mockTables = new MockTablesCollection();
const mockLocations = new MockLocationsCollection();
const mockMenuItems = new MockMenuItemsCollection();
const mockOrders = new MockOrdersCollection();
const mockRevisions = new MockOrderRevisionsCollection();
const mockEmployeeActivity = new MockEmployeeActivityCollection();

const mockDb = {
  collection: (name) => {
    if (name === 'configs') return mockConfigs;
    if (name === 'tables') return mockTables;
    if (name === 'locations') return mockLocations;
    if (name === 'menu_items') return mockMenuItems;
    if (name === 'orders') return mockOrders;
    if (name === 'order_revisions') return mockRevisions;
    if (name === 'employee_activity_events') return mockEmployeeActivity;
    return {
      insertOne: async () => ({ insertedId: new ObjectId() }),
      deleteMany: async () => ({ deletedCount: 1 }),
      createIndex: async () => {},
      dropIndex: async () => {},
      aggregate: () => ({ toArray: async () => [] })
    };
  }
};

setMockDB(mockDb);

// Import router stack
const ordersRouter = (await import('./orders.js')).default;

// JWT tokens signing
const adminToken = jwt.sign(
  { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
  'test_secret_for_order_editing_test'
);

const staffToken = jwt.sign(
  { id: '60c72b2f9b1d8e23f0c3d9a3', name: 'Staff User', email: 'staff@aurum.com', role: 'STAFF' },
  'test_secret_for_order_editing_test'
);

// Mock response mock helper
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

// Simulate Express request helper
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

// Reset mocks between tests helper
function resetMocks() {
  mockOrders.docs = [];
  mockOrders.updated = [];
  mockOrders.failOnUpdate = false;
  mockRevisions.docs = [];
  mockRevisions.inserted = [];
  mockRevisions.failOnInsert = false;
  mockRevisions.duplicateKeyError = false;
  mockEmployeeActivity.inserted = [];
}

// TEST SUITES
test('Live KDS order amendment router tests', async (t) => {

  await t.test('1. Authorization Gating', async () => {
    resetMocks();
    
    // STAFF role should be rejected
    const reqStaff = {
      params: { id: '60c72b2f9b1d8e23f0c3d950' },
      user: { id: 'user_1', name: 'John Staff', email: 'john@aurum.com', role: 'STAFF' },
      cookies: { token: staffToken },
      body: { reason: 'Corrected quantity', version: 1, items: [] }
    };
    const resStaff = await simulateRequest('/:id/amend', 'PATCH', reqStaff);
    assert.equal(resStaff.statusCode, 403);
    assert.match(JSON.stringify(resStaff.body), /Admin access required/);
  });

  await t.test('2. Normalized reason bounds (5-500, reject whitespace-only)', async () => {
    resetMocks();
    
    const reqTooShort = {
      params: { id: '60c72b2f9b1d8e23f0c3d950' },
      user: { id: 'user_admin', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: { reason: '   ok   ', version: 1, items: [] } // Trims to "ok" (2 chars)
    };
    const resTooShort = await simulateRequest('/:id/amend', 'PATCH', reqTooShort);
    assert.equal(resTooShort.statusCode, 400);
    assert.match(JSON.stringify(resTooShort.body), /Amendment reason must be between 5 and 500 characters/);

    const reqWhitespace = {
      params: { id: '60c72b2f9b1d8e23f0c3d950' },
      user: { id: 'user_admin', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: { reason: '         ', version: 1, items: [] }
    };
    const resWhitespace = await simulateRequest('/:id/amend', 'PATCH', reqWhitespace);
    assert.equal(resWhitespace.statusCode, 400);
  });

  await t.test('3. Terminal state locks (PAID, COMPLETED, splitSettlement present)', async () => {
    resetMocks();
    const orderId = new ObjectId('60c72b2f9b1d8e23f0c3d950');
    
    // Seed Paid order
    mockOrders.docs.push({
      _id: orderId,
      table: 'Table 1',
      items: [{ id: new ObjectId('60c72b2f9b1d8e23f0c3d901'), name: 'Paneer Tikka', price: 250, quantity: 2 }],
      paymentStatus: 'PAID',
      status: 'NEW',
      version: 1
    });

    const req = {
      params: { id: orderId.toString() },
      user: { id: 'user_admin', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: { reason: 'Valid reason here', version: 1, items: [{ id: '60c72b2f9b1d8e23f0c3d901', quantity: 1 }] }
    };
    const res = await simulateRequest('/:id/amend', 'PATCH', req);
    assert.equal(res.statusCode, 400);
    assert.match(JSON.stringify(res.body), /Paid/);

    // Change to completed order
    mockOrders.docs[0].paymentStatus = 'UNPAID';
    mockOrders.docs[0].status = 'COMPLETED';
    const resCompleted = await simulateRequest('/:id/amend', 'PATCH', req);
    assert.equal(resCompleted.statusCode, 400);
    assert.match(JSON.stringify(resCompleted.body), /Completed/);

    // Change to active settlement-linked order
    mockOrders.docs[0].status = 'NEW';
    mockOrders.docs[0].splitSettlement = { status: 'PENDING' };
    const resSettled = await simulateRequest('/:id/amend', 'PATCH', req);
    assert.equal(resSettled.statusCode, 400);
    assert.match(JSON.stringify(resSettled.body), /Settlement-linked/);
  });

  await t.test('4. Optimistic concurrency (mismatched version)', async () => {
    resetMocks();
    const orderId = new ObjectId('60c72b2f9b1d8e23f0c3d950');
    mockOrders.docs.push({
      _id: orderId,
      table: 'Table 1',
      items: [{ id: new ObjectId('60c72b2f9b1d8e23f0c3d901'), name: 'Paneer Tikka', price: 250, quantity: 2 }],
      paymentStatus: 'UNPAID',
      status: 'NEW',
      version: 2
    });

    const req = {
      params: { id: orderId.toString() },
      user: { id: 'user_admin', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: { reason: 'Valid reason here', version: 1, items: [{ id: '60c72b2f9b1d8e23f0c3d901', quantity: 1 }] } // version mismatch
    };
    const res = await simulateRequest('/:id/amend', 'PATCH', req);
    assert.equal(res.statusCode, 409);
    assert.match(JSON.stringify(res.body), /Concurrency conflict/);
  });

  await t.test('5. Legacy version support (version absent in database)', async () => {
    resetMocks();
    const orderId = new ObjectId('60c72b2f9b1d8e23f0c3d950');
    mockOrders.docs.push({
      _id: orderId,
      table: 'Table 5',
      items: [{ id: new ObjectId('60c72b2f9b1d8e23f0c3d901'), name: 'Paneer Tikka', price: 250, quantity: 2 }],
      paymentStatus: 'UNPAID',
      status: 'NEW'
      // version absent
    });

    const req = {
      params: { id: orderId.toString() },
      user: { id: 'user_admin', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: { reason: 'Valid reason here', version: 1, items: [{ id: '60c72b2f9b1d8e23f0c3d901', quantity: 1 }] }
    };
    const res = await simulateRequest('/:id/amend', 'PATCH', req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.version, 2);
  });

  await t.test('6. Authoritative Table and Location Lookup', async () => {
    resetMocks();
    const orderId = new ObjectId('60c72b2f9b1d8e23f0c3d950');
    mockOrders.docs.push({
      _id: orderId,
      table: 'Table 1',
      items: [{ id: new ObjectId('60c72b2f9b1d8e23f0c3d901'), name: 'Paneer Tikka', price: 250, quantity: 2 }],
      paymentStatus: 'UNPAID',
      status: 'NEW',
      version: 1
    });

    // Provide invalid non-existent table ID
    const reqInvalidTable = {
      params: { id: orderId.toString() },
      user: { id: 'user_admin', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: { reason: 'Valid reason here', version: 1, tableId: '60c72b2f9b1d8e23f0c3d900', items: [{ id: '60c72b2f9b1d8e23f0c3d901', quantity: 2 }] }
    };
    const resInvalidTable = await simulateRequest('/:id/amend', 'PATCH', reqInvalidTable);
    assert.equal(resInvalidTable.statusCode, 400);
    assert.match(JSON.stringify(resInvalidTable.body), /Invalid or non-existent Table/);

    // Provide valid table ID
    const reqValidTable = {
      params: { id: orderId.toString() },
      user: { id: 'user_admin', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: { reason: 'Valid reason here', version: 1, tableId: '60c72b2f9b1d8e23f0c3d9aa', items: [{ id: '60c72b2f9b1d8e23f0c3d901', quantity: 1 }] }
    };
    const resValidTable = await simulateRequest('/:id/amend', 'PATCH', reqValidTable);
    assert.equal(resValidTable.statusCode, 200);
    assert.equal(resValidTable.body.table, 'Table 5');
    assert.equal(resValidTable.body.location, 'Garden');
  });

  await t.test('7. Unavailable and deleted items gating', async () => {
    resetMocks();
    const orderId = new ObjectId('60c72b2f9b1d8e23f0c3d950');
    // Seed order containing one unavailable item (quantity 2)
    mockOrders.docs.push({
      _id: orderId,
      table: 'Table 5',
      items: [{ id: new ObjectId('60c72b2f9b1d8e23f0c3d903'), name: 'Unavailable Dish', price: 120, quantity: 2 }],
      paymentStatus: 'UNPAID',
      status: 'NEW',
      version: 1
    });

    // Attempt to add a NEW unavailable/deleted item -> BLOCK
    const reqAddNew = {
      params: { id: orderId.toString() },
      user: { id: 'user_admin', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: { reason: 'Valid reason here', version: 1, items: [{ id: '60c72b2f9b1d8e23f0c3d903', quantity: 2 }, { id: '60c72b2f9b1d8e23f0c3d904', quantity: 1 }] } // 60c72b2f9b1d8e23f0c3d904 is new deleted
    };
    const resAddNew = await simulateRequest('/:id/amend', 'PATCH', reqAddNew);
    assert.equal(resAddNew.statusCode, 400);
    assert.match(JSON.stringify(resAddNew.body), /Cannot add new unavailable item/);

    // Attempt to increase quantity of existing unavailable item -> BLOCK
    const reqIncrease = {
      params: { id: orderId.toString() },
      user: { id: 'user_admin', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: { reason: 'Valid reason here', version: 1, items: [{ id: '60c72b2f9b1d8e23f0c3d903', quantity: 3 }] } // increased from 2 to 3
    };
    const resIncrease = await simulateRequest('/:id/amend', 'PATCH', reqIncrease);
    assert.equal(resIncrease.statusCode, 400);
    assert.match(JSON.stringify(resIncrease.body), /Cannot increase quantity of unavailable item/);

    // Decreasing the quantity of existing unavailable item -> ALLOW
    const reqDecrease = {
      params: { id: orderId.toString() },
      user: { id: 'user_admin', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: { reason: 'Valid reason here', version: 1, items: [{ id: '60c72b2f9b1d8e23f0c3d903', quantity: 1 }] }
    };
    const resDecrease = await simulateRequest('/:id/amend', 'PATCH', reqDecrease);
    assert.equal(resDecrease.statusCode, 200);
    assert.equal(resDecrease.body.items[0].quantity, 1);
  });

  await t.test('8. Reject no-op amendments', async () => {
    resetMocks();
    const orderId = new ObjectId('60c72b2f9b1d8e23f0c3d950');
    mockOrders.docs.push({
      _id: orderId,
      table: 'Table 5',
      tableId: new ObjectId('60c72b2f9b1d8e23f0c3d9aa'),
      location: 'Garden',
      locationId: new ObjectId('60c72b2f9b1d8e23f0c3d9bb'),
      items: [{ id: new ObjectId('60c72b2f9b1d8e23f0c3d901'), name: 'Paneer Tikka', price: 250, quantity: 2 }],
      paymentStatus: 'UNPAID',
      status: 'NEW',
      version: 1
    });

    const reqNoOp = {
      params: { id: orderId.toString() },
      user: { id: 'user_admin', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: {
        reason: 'Valid reason here',
        version: 1,
        tableId: '60c72b2f9b1d8e23f0c3d9aa',
        locationId: '60c72b2f9b1d8e23f0c3d9bb',
        items: [{ id: '60c72b2f9b1d8e23f0c3d901', quantity: 2 }]
      }
    };
    const resNoOp = await simulateRequest('/:id/amend', 'PATCH', reqNoOp);
    assert.equal(resNoOp.statusCode, 400);
    assert.match(JSON.stringify(resNoOp.body), /No changes detected/);
  });

  await t.test('9. Revision fallback rollback and failure handling', async () => {
    resetMocks();
    const orderId = new ObjectId('60c72b2f9b1d8e23f0c3d950');
    mockOrders.docs.push({
      _id: orderId,
      table: 'Table 5',
      items: [{ id: new ObjectId('60c72b2f9b1d8e23f0c3d901'), name: 'Paneer Tikka', price: 250, quantity: 2 }],
      paymentStatus: 'UNPAID',
      status: 'NEW',
      version: 1
    });

    // Make database update fail (modifiedCount = 0)
    mockOrders.failOnUpdate = true;

    const req = {
      params: { id: orderId.toString() },
      user: { id: 'user_admin', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      body: { reason: 'Amendment to fail', version: 1, items: [{ id: '60c72b2f9b1d8e23f0c3d901', quantity: 3 }] }
    };
    const res = await simulateRequest('/:id/amend', 'PATCH', req);
    assert.equal(res.statusCode, 409);

    // Verify revision was rolled back to status 'FAILED' or not committed
    const rev = mockRevisions.docs[0];
    assert.equal(rev.status, 'FAILED');
  });

  await t.test('10. paginated revision history (GET revisions)', async () => {
    resetMocks();
    const orderId = new ObjectId('60c72b2f9b1d8e23f0c3d950');
    
    // Seed order
    mockOrders.docs.push({
      _id: orderId,
      table: 'Table 5',
      items: [{ id: new ObjectId('60c72b2f9b1d8e23f0c3d901'), name: 'Paneer Tikka', price: 250, quantity: 2 }],
      paymentStatus: 'UNPAID',
      status: 'NEW',
      version: 1
    });

    // Seed mock committed revision history
    mockRevisions.docs.push(
      { orderId, newVersion: 2, prevVersion: 1, status: 'COMMITTED', timestamp: new Date(), actor: { name: 'Admin' } },
      { orderId, newVersion: 3, prevVersion: 2, status: 'COMMITTED', timestamp: new Date(), actor: { name: 'Admin' } }
    );

    const req = {
      params: { id: orderId.toString() },
      user: { id: 'user_admin', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      query: { page: '1', limit: '1' }
    };
    const res = await simulateRequest('/:id/revisions', 'GET', req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.revisions.length, 1);
    assert.equal(res.body.pagination.total, 2);
    assert.equal(res.body.pagination.pages, 2);

    // Request non-existent order
    const reqNotFound = {
      params: { id: new ObjectId().toString() },
      user: { id: 'user_admin', name: 'Admin User', email: 'admin@aurum.com', role: 'ADMIN' },
      cookies: { token: adminToken },
      query: {}
    };
    const resNotFound = await simulateRequest('/:id/revisions', 'GET', reqNotFound);
    assert.equal(resNotFound.statusCode, 404);
  });
});
