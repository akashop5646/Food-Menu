import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test_secret_for_orders_complete_all_test';

import { setMockDB } from '../db.js';

// Setup Mock Collections
class MockOrdersCollection {
  constructor() {
    this.docs = [
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9c1'), status: 'NEW', orderId: 101 },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9c2'), status: 'PREPARING', orderId: 102 },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9c3'), status: 'READY', orderId: 103 },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9c4'), status: 'COMPLETED', orderId: 104 }
    ];
    this.failOnFindOneAndUpdate = null; // Set to an ID to simulate concurrent completion
  }

  async findOne(query) {
    const idStr = query._id?.toString();
    const doc = this.docs.find(d => d._id.toString() === idStr);
    return doc ? { ...doc } : null;
  }

  find(query) {
    let matched = this.docs;
    if (query && query.status && query.status.$in) {
      matched = this.docs.filter(d => query.status.$in.includes(d.status));
    }
    return {
      toArray: async () => matched.map(d => ({ ...d }))
    };
  }

  async findOneAndUpdate(filter, update, options) {
    const idStr = filter._id?.toString();

    // Simulate concurrency check: if this ID is marked to fail, return null
    if (this.failOnFindOneAndUpdate === idStr) {
      return null;
    }

    const docIndex = this.docs.findIndex(d => d._id?.toString() === idStr);
    if (docIndex === -1) {
      return null;
    }

    const doc = this.docs[docIndex];

    // Ensure the filter status condition matches the document status
    const statusIn = filter.status?.$in || [];
    if (statusIn.length > 0 && !statusIn.includes(doc.status)) {
      return null;
    }

    if (update.$set) {
      Object.assign(doc, update.$set);
    }
    return { ...doc };
  }
}
class MockEmployeeActivityCollection {
  constructor() {
    this.inserted = [];
  }
  async insertOne(doc) {
    console.log('MOCK DB insertOne: this =', this, 'inserted array =', this.inserted);
    this.inserted.push(doc);
    return { insertedId: 'mock_activity_id' };
  }
}

// Broadcast stub configuration
import { setMockBroadcast } from '../websocket.js';
const broadcasted = [];
setMockBroadcast((event, payload) => {
  broadcasted.push({ event, payload });
});

const mockOrders = new MockOrdersCollection();
const mockActivity = new MockEmployeeActivityCollection();

const mockDb = {
  collection: (name) => {
    if (name === 'orders') return mockOrders;
    if (name === 'employee_activity_events') return mockActivity;
    return {
      insertOne: async () => ({ insertedId: 'mock' }),
      dropIndex: async () => {}
    };
  }
};

setMockDB(mockDb);

const ordersRouter = (await import('./orders.js')).default;

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

const staffToken = jwt.sign(
  { id: '60c72b2f9b1d8e23f0c3d9e0', name: 'Staff User', email: 'staff@aurum.com', role: 'STAFF' },
  'test_secret_for_orders_complete_all_test'
);

test('Bulk Complete All API Tests', async (t) => {
  await t.test('1. Reject unauthorized request', async () => {
    const req = {
      cookies: {}
    };
    const res = await simulateRequest('/complete-all', 'POST', req);
    assert.equal(res.statusCode, 401);
  });

  await t.test('2. Successfully complete eligible orders and skip already completed ones', async () => {
    broadcasted.length = 0;
    mockActivity.inserted.length = 0;

    const req = {
      cookies: { token: staffToken }
    };
    const res = await simulateRequest('/complete-all', 'POST', req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.matchedCount, 3);
    assert.equal(res.body.completedCount, 3);

    // Check returned completed IDs matches the eligible ones
    const expectedCompleted = [
      '60c72b2f9b1d8e23f0c3d9c1',
      '60c72b2f9b1d8e23f0c3d9c2',
      '60c72b2f9b1d8e23f0c3d9c3'
    ];
    assert.deepEqual(res.body.completedOrderIds, expectedCompleted);

    // Verify statuses in the database
    for (const idStr of expectedCompleted) {
      const order = mockOrders.docs.find(d => d._id.toString() === idStr);
      assert.equal(order.status, 'COMPLETED');
      assert.ok(order.statusUpdatedAt instanceof Date);
    }
    // Verify 104 was left COMPLETED and not changed/updated
    const order104 = mockOrders.docs.find(d => d.orderId === 104);
    assert.equal(order104.status, 'COMPLETED');
    assert.equal(order104.statusUpdatedAt, undefined); // remained unmodified

    // Verify WebSocket broadcasts
    assert.equal(broadcasted.length, 3);
    broadcasted.forEach(b => {
      assert.equal(b.event, 'ORDER_STATUS_CHANGED');
      assert.equal(b.payload.status, 'COMPLETED');
      assert.ok(expectedCompleted.includes(b.payload.id));
    });

    // Verify audit logs
    assert.equal(mockActivity.inserted.length, 3);
    mockActivity.inserted.forEach(act => {
      assert.equal(act.action, 'ORDER_STATUS_CHANGED');
      assert.equal(act.entity.type, 'ORDER');
      assert.ok(expectedCompleted.includes(act.entity.id));
      assert.equal(act.context.toStatus, 'COMPLETED');
    });
  });

  await t.test('3. Return successful zero counts when no active orders remain', async () => {
    broadcasted.length = 0;
    mockActivity.inserted.length = 0;

    const req = {
      cookies: { token: staffToken }
    };
    const res = await simulateRequest('/complete-all', 'POST', req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.matchedCount, 0);
    assert.equal(res.body.completedCount, 0);
    assert.deepEqual(res.body.completedOrderIds, []);
    assert.equal(broadcasted.length, 0);
    assert.equal(mockActivity.inserted.length, 0);
  });

  await t.test('4. Concurrency Test: Simulate one order being completed between fetch and update', async () => {
    // Reset order mock docs back to active states
    mockOrders.docs = [
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9d1'), status: 'NEW', orderId: 201 },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9d2'), status: 'PREPARING', orderId: 202 }
    ];

    // Simulate that 60c72b2f9b1d8e23f0c3d9d1 was completed concurrently
    mockOrders.failOnFindOneAndUpdate = '60c72b2f9b1d8e23f0c3d9d1';

    broadcasted.length = 0;
    mockActivity.inserted.length = 0;

    const req = {
      cookies: { token: staffToken }
    };
    const res = await simulateRequest('/complete-all', 'POST', req);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.matchedCount, 2);
    assert.equal(res.body.completedCount, 1);

    // Only 60c72b2f9b1d8e23f0c3d9d2 should be completed
    assert.deepEqual(res.body.completedOrderIds, ['60c72b2f9b1d8e23f0c3d9d2']);

    // Only one WebSocket event and audit log should be emitted
    assert.equal(broadcasted.length, 1);
    assert.equal(broadcasted[0].payload.id, '60c72b2f9b1d8e23f0c3d9d2');

    assert.equal(mockActivity.inserted.length, 1);
    assert.equal(mockActivity.inserted[0].entity.id, '60c72b2f9b1d8e23f0c3d9d2');
  });
});
