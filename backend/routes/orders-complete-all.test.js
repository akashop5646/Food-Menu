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
    } else if (query && typeof query.status === 'string') {
      matched = this.docs.filter(d => d.status === query.status);
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
    const statusMatches = typeof filter.status === 'string'
      ? doc.status === filter.status
      : !filter.status?.$in || filter.status.$in.includes(doc.status);
    if (!statusMatches) {
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

test('Bulk KDS status API Tests', async (t) => {
  await t.test('1. Reject unauthorized request', async () => {
    const req = {
      cookies: {}
    };
    const res = await simulateRequest('/bulk-status', 'POST', req);
    assert.equal(res.statusCode, 401);
  });

  await t.test('2. Reject unsupported transitions', async () => {
    const req = {
      cookies: { token: staffToken },
      body: { fromStatus: 'NEW', toStatus: 'COMPLETED' }
    };
    const res = await simulateRequest('/bulk-status', 'POST', req);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid bulk KDS status transition.');
  });

  await t.test('3. Move only Preparing orders to Ready', async () => {
    mockOrders.docs = [
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9c1'), status: 'NEW', orderId: 101 },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9c2'), status: 'PREPARING', orderId: 102 },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9c3'), status: 'READY', orderId: 103 },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9c4'), status: 'COMPLETED', orderId: 104 }
    ];
    mockOrders.failOnFindOneAndUpdate = null;
    broadcasted.length = 0;
    mockActivity.inserted.length = 0;

    const req = {
      cookies: { token: staffToken },
      body: { fromStatus: 'PREPARING', toStatus: 'READY' }
    };
    const res = await simulateRequest('/bulk-status', 'POST', req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.matchedCount, 1);
    assert.equal(res.body.transitionedCount, 1);
    assert.deepEqual(res.body.transitionedOrderIds, ['60c72b2f9b1d8e23f0c3d9c2']);
    assert.equal(mockOrders.docs.find(d => d.orderId === 101).status, 'NEW');
    assert.equal(mockOrders.docs.find(d => d.orderId === 102).status, 'READY');
    assert.equal(mockOrders.docs.find(d => d.orderId === 103).status, 'READY');
    assert.equal(mockOrders.docs.find(d => d.orderId === 104).status, 'COMPLETED');
    assert.equal(broadcasted.length, 1);
    assert.equal(broadcasted[0].payload.status, 'READY');
    assert.equal(mockActivity.inserted.length, 1);
    assert.equal(mockActivity.inserted[0].context.toStatus, 'READY');
  });

  await t.test('4. Move only Ready orders to Completed', async () => {
    mockOrders.docs = [
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9d1'), status: 'NEW', orderId: 201 },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9d2'), status: 'PREPARING', orderId: 202 },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9d3'), status: 'READY', orderId: 203 }
    ];
    mockOrders.failOnFindOneAndUpdate = null;
    broadcasted.length = 0;
    mockActivity.inserted.length = 0;

    const req = {
      cookies: { token: staffToken },
      body: { fromStatus: 'READY', toStatus: 'COMPLETED' }
    };
    const res = await simulateRequest('/bulk-status', 'POST', req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.matchedCount, 1);
    assert.equal(res.body.transitionedCount, 1);
    assert.deepEqual(res.body.transitionedOrderIds, ['60c72b2f9b1d8e23f0c3d9d3']);
    assert.equal(mockOrders.docs.find(d => d.orderId === 201).status, 'NEW');
    assert.equal(mockOrders.docs.find(d => d.orderId === 202).status, 'PREPARING');
    assert.equal(mockOrders.docs.find(d => d.orderId === 203).status, 'COMPLETED');
    assert.equal(broadcasted.length, 1);
    assert.equal(broadcasted[0].payload.status, 'COMPLETED');
  });

  await t.test('5. Skip an order changed concurrently after the source lane is fetched', async () => {
    mockOrders.docs = [
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9e1'), status: 'PREPARING', orderId: 301 },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9e2'), status: 'PREPARING', orderId: 302 }
    ];
    mockOrders.failOnFindOneAndUpdate = '60c72b2f9b1d8e23f0c3d9e1';

    broadcasted.length = 0;
    mockActivity.inserted.length = 0;

    const req = {
      cookies: { token: staffToken },
      body: { fromStatus: 'PREPARING', toStatus: 'READY' }
    };
    const res = await simulateRequest('/bulk-status', 'POST', req);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.matchedCount, 2);
    assert.equal(res.body.transitionedCount, 1);
    assert.deepEqual(res.body.transitionedOrderIds, ['60c72b2f9b1d8e23f0c3d9e2']);
    assert.equal(broadcasted.length, 1);
    assert.equal(broadcasted[0].payload.id, '60c72b2f9b1d8e23f0c3d9e2');
    assert.equal(broadcasted[0].payload.status, 'READY');
    assert.equal(mockActivity.inserted.length, 1);
    assert.equal(mockActivity.inserted[0].entity.id, '60c72b2f9b1d8e23f0c3d9e2');
  });
});
