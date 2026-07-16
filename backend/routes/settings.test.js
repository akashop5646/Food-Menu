import assert from 'node:assert/strict';
import test from 'node:test';

// Pre-set environment secret before importing any auth/router
process.env.JWT_SECRET = 'test_secret';

import { setMockDB } from '../db.js';

class MockConfigsCollection {
  constructor() {
    this.docs = [
      { key: 'convenience_fee_enabled', value: true },
      { key: 'convenience_fee_amount', value: 10 }
    ];
  }
  async findOne(query) {
    const doc = this.docs.find(d => d.key === query.key);
    return doc ? structuredClone(doc) : null;
  }
  find(query) {
    let matched = this.docs;
    if (query && query.key && query.key.$in) {
      matched = this.docs.filter(d => query.key.$in.includes(d.key));
    }
    const cursor = {
      toArray: async () => matched.map(d => structuredClone(d))
    };
    return cursor;
  }
  async updateOne(filter, update, options) {
    let doc = this.docs.find(d => d.key === filter.key);
    if (!doc) {
      doc = { key: filter.key };
      this.docs.push(doc);
    }
    if (update.$set) {
      doc.value = update.$set.value;
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

class MockEventsCollection {
  constructor() {
    this.inserted = [];
  }
  async insertOne(doc) {
    this.inserted.push(doc);
    return { insertedId: 'mock_event_id' };
  }
}

const mockConfigs = new MockConfigsCollection();
const mockEvents = new MockEventsCollection();
const mockDb = {
  collection: (name) => {
    if (name === 'configs') return mockConfigs;
    if (name === 'employee_activity_events') return mockEvents;
    return {
      insertOne: async () => ({ insertedId: 'mock' })
    };
  }
};

setMockDB(mockDb);

// Dynamically import router
const settingsRouter = (await import('./settings.js')).default;

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

// Simulates Express route execution chain
async function simulateRequest(path, method, req) {
  const routeLayer = settingsRouter.stack.find(layer => 
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

test('Convenience Fee Authorization Tests', async (t) => {
  const jwt = await import('jsonwebtoken');
  const masterAdminToken = jwt.default.sign(
    { id: '60c72b2f9b1d8e23f0c3d9a1', name: 'Master', email: 'master@test.com', role: 'MASTER_ADMIN' },
    'test_secret'
  );
  const adminToken = jwt.default.sign(
    { id: '60c72b2f9b1d8e23f0c3d9a2', name: 'Admin', email: 'admin@test.com', role: 'ADMIN' },
    'test_secret'
  );
  const staffToken = jwt.default.sign(
    { id: '60c72b2f9b1d8e23f0c3d9a3', name: 'Staff', email: 'staff@test.com', role: 'STAFF' },
    'test_secret'
  );

  await t.test('GET /convenience-fee (Public/All Roles) can read settings', async () => {
    const req = { cookies: {} };
    const res = await simulateRequest('/convenience-fee', 'GET', req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.enabled, true);
    assert.equal(res.body.type, 'FIXED');
    assert.equal(res.body.percentage, 0);
    assert.equal(res.body.amount, 10);
  });

  await t.test('POST /convenience-fee: MASTER_ADMIN can update convenience fee with valid payload', async () => {
    // Reset to baseline first
    mockConfigs.docs = [
      { key: 'convenience_fee_enabled', value: true },
      { key: 'convenience_fee_type', value: 'PERCENTAGE' },
      { key: 'convenience_fee_percentage', value: 2 },
      { key: 'convenience_fee_amount', value: 10 }
    ];

    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a1', name: 'Master', email: 'master@test.com', role: 'MASTER_ADMIN' },
      cookies: { token: masterAdminToken },
      body: { enabled: false, type: 'PERCENTAGE', percentage: 1.5 }
    };
    const res = await simulateRequest('/convenience-fee', 'POST', req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.enabled, false);
    assert.equal(res.body.type, 'PERCENTAGE');
    assert.equal(res.body.percentage, 1.5);
    
    assert.equal(mockConfigs.docs.find(d => d.key === 'convenience_fee_enabled').value, false);
    assert.equal(mockConfigs.docs.find(d => d.key === 'convenience_fee_type').value, 'PERCENTAGE');
    assert.equal(mockConfigs.docs.find(d => d.key === 'convenience_fee_percentage').value, 1.5);

    // Verify audit event was logged
    assert.equal(mockEvents.inserted.length, 1);
    assert.equal(mockEvents.inserted[0].action, 'CONVENIENCE_FEE_UPDATED');
    assert.equal(mockEvents.inserted[0].actor.userId, '60c72b2f9b1d8e23f0c3d9a1');
    assert.equal(mockEvents.inserted[0].actor.role, 'MASTER_ADMIN');
    assert.equal(mockEvents.inserted[0].context.enabled, false);
    assert.equal(mockEvents.inserted[0].context.type, 'PERCENTAGE');
    assert.equal(mockEvents.inserted[0].context.percentage, 1.5);
  });

  await t.test('POST /convenience-fee: Invalid fee values are rejected for MASTER_ADMIN (percentage > 20)', async () => {
    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a1', name: 'Master', email: 'master@test.com', role: 'MASTER_ADMIN' },
      cookies: { token: masterAdminToken },
      body: { enabled: true, type: 'PERCENTAGE', percentage: 25 }
    };
    const res = await simulateRequest('/convenience-fee', 'POST', req);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes('between 0 and 20'));
  });

  await t.test('POST /convenience-fee: Invalid fee values are rejected for MASTER_ADMIN (percentage < 0)', async () => {
    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a1', name: 'Master', email: 'master@test.com', role: 'MASTER_ADMIN' },
      cookies: { token: masterAdminToken },
      body: { enabled: true, type: 'PERCENTAGE', percentage: -5 }
    };
    const res = await simulateRequest('/convenience-fee', 'POST', req);
    assert.equal(res.statusCode, 400);
  });

  await t.test('POST /convenience-fee: Invalid fee values are rejected for MASTER_ADMIN (non-boolean enabled)', async () => {
    const req = {
      user: { id: '60c72b2f9b1d8e23f0c3d9a1', name: 'Master', email: 'master@test.com', role: 'MASTER_ADMIN' },
      cookies: { token: masterAdminToken },
      body: { enabled: 'true', type: 'PERCENTAGE', percentage: 2 }
    };
    const res = await simulateRequest('/convenience-fee', 'POST', req);
    assert.equal(res.statusCode, 400);
  });

  await t.test('POST /convenience-fee: ADMIN receives 403 Forbidden', async () => {
    const req = {
      cookies: { token: adminToken },
      body: { enabled: true, type: 'PERCENTAGE', percentage: 2 }
    };
    const res = await simulateRequest('/convenience-fee', 'POST', req);
    assert.equal(res.statusCode, 403);
  });

  await t.test('POST /convenience-fee: STAFF receives 403 Forbidden', async () => {
    const req = {
      cookies: { token: staffToken },
      body: { enabled: true, type: 'PERCENTAGE', percentage: 2 }
    };
    const res = await simulateRequest('/convenience-fee', 'POST', req);
    assert.equal(res.statusCode, 403);
  });

  await t.test('POST /convenience-fee: Unauthenticated request receives 401 Unauthorized', async () => {
    const req = {
      cookies: {},
      body: { enabled: true, type: 'PERCENTAGE', percentage: 2 }
    };
    const res = await simulateRequest('/convenience-fee', 'POST', req);
    assert.equal(res.statusCode, 401);
  });
});

test('Frontend Settings Page Permission Test', async (t) => {
  await t.test('Verify that Settings.jsx derives and uses canModifyConvenienceFee permission helper', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const codePath = path.resolve('frontend/src/pages/Settings.jsx');
    const code = await fs.readFile(codePath, 'utf8');

    assert.ok(
      code.includes('const canModifyConvenienceFee = user?.role === \'MASTER_ADMIN\';'),
      "Settings.jsx must declare canModifyConvenienceFee derived from user's role."
    );
    assert.ok(
      code.includes('disabled={!canModifyConvenienceFee || !convenienceFeeEnabled}'),
      "Settings.jsx must disable convenience fee input field for non-Master Admins."
    );
    assert.ok(
      code.includes('disabled={!canModifyConvenienceFee}'),
      "Settings.jsx must disable toggle button for non-Master Admins."
    );
    assert.ok(
      code.includes('Only Master Admins can modify convenience fee settings.'),
      "Settings.jsx must render notice for non-Master Admins."
    );
  });
});
