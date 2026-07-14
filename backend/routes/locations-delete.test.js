import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test_secret_for_locations_delete_test';

import { setMockDB } from '../db.js';

class MockLocationsCollection {
  constructor() {
    this.docs = [
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9a1'), name: 'Main Dining Room' },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9a2'), name: 'Patio' },
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9a3'), name: 'Garden' }
    ];
  }
  async findOne(query) {
    const idStr = query._id?.toString();
    const doc = this.docs.find(d => d._id.toString() === idStr);
    return doc ? structuredClone(doc) : null;
  }
  async deleteOne(query) {
    const idStr = query._id?.toString();
    const index = this.docs.findIndex(d => d._id.toString() === idStr);
    if (index !== -1) {
      this.docs.splice(index, 1);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }
  find() {
    return {
      sort: () => ({
        toArray: async () => this.docs.map(d => structuredClone(d))
      })
    };
  }
}

class MockTablesCollection {
  constructor() {
    this.docs = [
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9b1'), number: 1, name: 'Table 1', locationId: '60c72b2f9b1d8e23f0c3d9a1' }, // String locationId
      { _id: new ObjectId('60c72b2f9b1d8e23f0c3d9b2'), number: 2, name: 'Table 2', locationId: new ObjectId('60c72b2f9b1d8e23f0c3d9a2') } // ObjectId locationId
    ];
  }
  find(query) {
    const orConds = query.$or || [];
    const matched = this.docs.filter(table => {
      return orConds.some(cond => {
        if (cond.locationId instanceof ObjectId) {
          return String(table.locationId) === String(cond.locationId);
        }
        return table.locationId === cond.locationId;
      });
    });
    return {
      toArray: async () => matched.map(d => structuredClone(d))
    };
  }
}

const mockLocations = new MockLocationsCollection();
const mockTables = new MockTablesCollection();
const mockDb = {
  collection: (name) => {
    if (name === 'locations') return mockLocations;
    if (name === 'tables') return mockTables;
    return {
      insertOne: async () => ({ insertedId: 'mock' })
    };
  }
};

setMockDB(mockDb);

const locationsRouter = (await import('./locations.js')).default;

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
  const routeLayer = locationsRouter.stack.find(layer =>
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
  { id: 'admin_1', role: 'ADMIN' },
  'test_secret_for_locations_delete_test'
);

const staffToken = jwt.sign(
  { id: 'staff_1', role: 'STAFF' },
  'test_secret_for_locations_delete_test'
);

test('Location Deletion API Tests', async (t) => {
  await t.test('1. Reject unauthorized request', async () => {
    const req = {
      params: { id: '60c72b2f9b1d8e23f0c3d9a3' },
      cookies: {}
    };
    const res = await simulateRequest('/:id', 'DELETE', req);
    assert.equal(res.statusCode, 401);
  });

  await t.test('2. Reject non-admin request', async () => {
    const req = {
      params: { id: '60c72b2f9b1d8e23f0c3d9a3' },
      cookies: { token: staffToken }
    };
    const res = await simulateRequest('/:id', 'DELETE', req);
    assert.equal(res.statusCode, 403);
  });

  await t.test('3. Reject invalid ObjectId format', async () => {
    const req = {
      params: { id: 'invalid-id-format' },
      cookies: { token: adminToken }
    };
    const res = await simulateRequest('/:id', 'DELETE', req);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid location ID');
  });

  await t.test('4. Reject deletion when location has string locationId references in tables', async () => {
    const req = {
      params: { id: '60c72b2f9b1d8e23f0c3d9a1' },
      cookies: { token: adminToken }
    };
    const res = await simulateRequest('/:id', 'DELETE', req);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'LOCATION_IN_USE');
    assert.equal(res.body.assignedTableCount, 1);
  });

  await t.test('5. Reject deletion when location has ObjectId locationId references in tables', async () => {
    const req = {
      params: { id: '60c72b2f9b1d8e23f0c3d9a2' },
      cookies: { token: adminToken }
    };
    const res = await simulateRequest('/:id', 'DELETE', req);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'LOCATION_IN_USE');
    assert.equal(res.body.assignedTableCount, 1);
  });

  await t.test('6. Return 404 if unassigned location does not exist', async () => {
    const req = {
      params: { id: '60c72b2f9b1d8e23f0c3d9a9' },
      cookies: { token: adminToken }
    };
    const res = await simulateRequest('/:id', 'DELETE', req);
    assert.equal(res.statusCode, 404);
  });

  await t.test('7. Successfully delete unassigned location', async () => {
    const targetId = '60c72b2f9b1d8e23f0c3d9a3';
    const req = {
      params: { id: targetId },
      cookies: { token: adminToken }
    };
    const res = await simulateRequest('/:id', 'DELETE', req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    
    // Verify it is gone from the mock DB
    const findRes = mockLocations.docs.find(d => d._id.toString() === targetId);
    assert.equal(findRes, undefined);
  });
});
