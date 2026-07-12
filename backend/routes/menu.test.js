import assert from 'node:assert/strict';
import test from 'node:test';

// Pre-set environment variables before imports
process.env.JWT_SECRET = 'test_secret_for_menu_test';

import { setMockDB } from '../db.js';
import { ObjectId } from 'mongodb';

// Mock collections
class MockMenuItemsCollection {
  constructor() {
    this.docs = [];
  }

  async findOne(query) {
    const doc = this.docs.find(d => {
      if (query._id instanceof ObjectId) {
        return d._id.toString() === query._id.toString();
      }
      return false;
    });
    return doc ? structuredClone(doc) : null;
  }

  find(query) {
    let matched = this.docs.filter(d => {
      // Filter by _id if specified
      if (query._id) {
        if (query._id.$in) {
          const stringIds = query._id.$in.map(id => id.toString());
          if (!stringIds.includes(d._id.toString())) return false;
        } else if (query._id instanceof ObjectId) {
          if (d._id.toString() !== query._id.toString()) return false;
        }
      }
      // Basic match for available status
      if (query.available !== undefined) {
        if (query.available.$ne !== undefined) {
          if (d.available === false) return false;
        } else {
          if (d.available !== query.available) return false;
        }
      }
      // Category filter
      if (query.$or) {
        const hasCategory = query.$or.some(cond => {
          if (cond.categories) {
            return d.categories && d.categories.includes(cond.categories);
          }
          if (cond.category) {
            return d.category === cond.category;
          }
          return false;
        });
        if (!hasCategory) return false;
      }
      // Search filter
      if (query.$and) {
        const searchCond = query.$and.find(cond => cond.$or);
        if (searchCond) {
          const matchSearch = searchCond.$or.some(c => {
            if (c.name && c.name.$regex) {
              const regex = new RegExp(c.name.$regex, 'i');
              return regex.test(d.name) || regex.test(d.description || '');
            }
            return false;
          });
          if (!matchSearch) return false;
        }
      } else if (query.$or && query.$or.some(c => c.name && c.name.$regex)) {
        const matchSearch = query.$or.some(c => {
          if (c.name && c.name.$regex) {
            const regex = new RegExp(c.name.$regex, 'i');
            return regex.test(d.name) || regex.test(d.description || '');
          }
          return false;
        });
        if (!matchSearch) return false;
      }
      return true;
    });

    const cursor = {
      matched: matched.map(d => ({ ...d })),
      sort: (sorting) => {
        cursor.matched.sort((a, b) => {
          // Default fallback sorting or any explicit options
          for (const key of Object.keys(sorting)) {
            const dir = sorting[key];
            let valA = a[key];
            let valB = b[key];

            // Tie breaker or custom fallback for missing createdAt
            if (key === 'createdAt') {
              valA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              valB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            }

            if (valA === valB) continue;

            if (typeof valA === 'string' && typeof valB === 'string') {
              return dir === 1 ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }

            return dir === 1 ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
          }
          return 0;
        });
        return cursor;
      },
      skip: (n) => {
        cursor.matched = cursor.matched.slice(n);
        return cursor;
      },
      limit: (n) => {
        if (n > 0) {
          cursor.matched = cursor.matched.slice(0, n);
        }
        return cursor;
      },
      project: () => cursor,
      toArray: async () => cursor.matched
    };
    return cursor;
  }

  async countDocuments(query) {
    const cursor = this.find(query);
    const arr = await cursor.toArray();
    return arr.length;
  }

  async updateMany(query, update) {
    let updatedCount = 0;
    const filterIds = query._id && query._id.$in ? new Set(query._id.$in.map(id => id.toString())) : new Set();
    
    this.docs = this.docs.map(doc => {
      if (filterIds.has(doc._id.toString())) {
        if (update.$set) {
          // update only allowed fields to test safety
          if (update.$set.available !== undefined) {
            doc.available = update.$set.available;
          }
          if (update.$set.updatedAt !== undefined) {
            doc.updatedAt = update.$set.updatedAt;
          }
        }
        updatedCount++;
      }
      return doc;
    });

    return {
      matchedCount: updatedCount,
      modifiedCount: updatedCount
    };
  }
}

const mockMenuItems = new MockMenuItemsCollection();

setMockDB({
  collection: (name) => {
    if (name === 'menu_items') return mockMenuItems;
    return null;
  }
});

// Dynamically import router and jwt
const menuRouter = (await import('./menu.js')).default;
const jwt = (await import('jsonwebtoken')).default;

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

// Simulates Express Layer Execution
async function simulateMenuRequest(path, method, req) {
  const routeLayer = menuRouter.stack.find(layer => 
    layer.route && 
    layer.route.path === path && 
    layer.route.methods[method.toLowerCase()]
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
      await nextLayer.handle(req, res, next);
    }
  };
  await next();
  return res;
}

// Prepare Mock Data
const item1 = {
  _id: new ObjectId('60c72b2f9b1d8e23f0c3d9a1'),
  name: 'Spiced Paneer',
  description: 'Cottage cheese with spices',
  price: 250,
  available: true,
  createdAt: new Date('2026-07-01T10:00:00Z'),
  chefPick: false,
  categories: ['Main Course']
};

const item2 = {
  _id: new ObjectId('60c72b2f9b1d8e23f0c3d9a2'),
  name: 'Golden Dosa',
  description: 'Crisp rice crepe',
  price: 150,
  available: true,
  createdAt: new Date('2026-07-02T10:00:00Z'),
  chefPick: true,
  categories: ['Breakfast']
};

const item3 = {
  _id: new ObjectId('60c72b2f9b1d8e23f0c3d9a3'),
  name: 'Legacy Halwa',
  description: 'Sweet pudding',
  price: 180,
  available: false,
  // createdAt is intentionally missing to verify tie-breaker
  chefPick: false,
  categories: ['Dessert']
};

// --- Test Suite ---

test('GET / returns raw array when adminMetadata is absent (backward compatibility)', async () => {
  mockMenuItems.docs = [item1, item2, item3];
  const req = { query: {} };
  const res = await simulateMenuRequest('/', 'GET', req);
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body.length, 2); // only available items by default
  assert.equal(res.body[0].name, 'Golden Dosa'); // chefPick first by default
});

test('GET / with adminMetadata=true and admin token returns metadata pagination shape', async () => {
  mockMenuItems.docs = [item1, item2, item3];
  const token = jwt.sign({ id: '1', role: 'ADMIN' }, 'test_secret_for_menu_test');
  const req = {
    query: { adminMetadata: 'true', all: 'true', limit: '2', offset: '0' },
    cookies: { token }
  };
  const res = await simulateMenuRequest('/', 'GET', req);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.items);
  assert.equal(res.body.totalCount, 3);
  assert.equal(res.body.limit, 2);
  assert.equal(res.body.offset, 0);
  assert.equal(res.body.hasMore, true);
});

test('GET / with adminMetadata=true rejects unauthorized requests with 403', async () => {
  mockMenuItems.docs = [item1, item2, item3];
  // Staff member token (not authorized)
  const token = jwt.sign({ id: '2', role: 'STAFF' }, 'test_secret_for_menu_test');
  const req = {
    query: { adminMetadata: 'true' },
    cookies: { token }
  };
  const res = await simulateMenuRequest('/', 'GET', req);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Forbidden: Admin access required for metadata.');
});

test('GET / search parameter escapes regex metacharacters safely', async () => {
  mockMenuItems.docs = [item1, item2];
  const req = { query: { search: 'Paneer(Spiced)' } };
  const res = await simulateMenuRequest('/', 'GET', req);
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body.length, 0); // No matches, but should not throw syntax error on unescaped parentheses
});

test('GET / sorting options match strict allowlist mappings', async () => {
  mockMenuItems.docs = [item1, item2, item3];
  const token = jwt.sign({ id: '1', role: 'ADMIN' }, 'test_secret_for_menu_test');

  // Newest Sort
  const resNewest = await simulateMenuRequest('/', 'GET', {
    query: { adminMetadata: 'true', all: 'true', sort: 'newest' },
    cookies: { token }
  });
  // Item 3 has missing createdAt, sorted last or by ID
  assert.equal(resNewest.body.items[0].name, 'Golden Dosa'); // 2026-07-02
  assert.equal(resNewest.body.items[1].name, 'Spiced Paneer'); // 2026-07-01

  // Price Ascending Sort
  const resPrice = await simulateMenuRequest('/', 'GET', {
    query: { adminMetadata: 'true', all: 'true', sort: 'price_asc' },
    cookies: { token }
  });
  assert.equal(resPrice.body.items[0].price, 150);
  assert.equal(resPrice.body.items[1].price, 180);
  assert.equal(resPrice.body.items[2].price, 250);
});

test('PATCH /bulk-availability enforces requireAdmin, strict validations, and deduplication', async () => {
  mockMenuItems.docs = [
    { ...item1 },
    { ...item2 },
    { ...item3 }
  ];

  const adminToken = jwt.sign({ id: '1', role: 'ADMIN' }, 'test_secret_for_menu_test');
  const staffToken = jwt.sign({ id: '2', role: 'STAFF' }, 'test_secret_for_menu_test');

  // Case A: Unauthenticated
  const resUnauth = await simulateMenuRequest('/bulk-availability', 'PATCH', {
    headers: { 'content-type': 'application/json' },
    body: { ids: ['60c72b2f9b1d8e23f0c3d9a1'], available: false }
  });
  assert.equal(resUnauth.statusCode, 401);

  // Case B: Unauthorized Role
  const resStaff = await simulateMenuRequest('/bulk-availability', 'PATCH', {
    headers: { 'content-type': 'application/json' },
    cookies: { token: staffToken },
    body: { ids: ['60c72b2f9b1d8e23f0c3d9a1'], available: false }
  });
  assert.equal(resStaff.statusCode, 403);

  // Case C: Non-JSON Content Type
  const resContentType = await simulateMenuRequest('/bulk-availability', 'PATCH', {
    headers: { 'content-type': 'text/plain' },
    cookies: { token: adminToken },
    body: {}
  });
  assert.equal(resContentType.statusCode, 415);

  // Case D: Invalid body inputs (missing ids)
  const resMissingIds = await simulateMenuRequest('/bulk-availability', 'PATCH', {
    headers: { 'content-type': 'application/json' },
    cookies: { token: adminToken },
    body: { available: false }
  });
  assert.equal(resMissingIds.statusCode, 400);

  // Case E: String Boolean (should be rejected)
  const resStringBool = await simulateMenuRequest('/bulk-availability', 'PATCH', {
    headers: { 'content-type': 'application/json' },
    cookies: { token: adminToken },
    body: { ids: ['60c72b2f9b1d8e23f0c3d9a1'], available: 'false' }
  });
  assert.equal(resStringBool.statusCode, 400);

  // Case F: Valid request with duplicates and missing records
  const resSuccess = await simulateMenuRequest('/bulk-availability', 'PATCH', {
    headers: { 'content-type': 'application/json' },
    cookies: { token: adminToken },
    body: {
      ids: [
        '60c72b2f9b1d8e23f0c3d9a1',
        '60c72b2f9b1d8e23f0c3d9a2',
        '60c72b2f9b1d8e23f0c3d9a1', // duplicate
        '60c72b2f9b1d8e23f0c3d9a9'  // non-existent
      ],
      available: false
    }
  });

  assert.equal(resSuccess.statusCode, 200);
  assert.equal(resSuccess.body.requested, 4);
  assert.equal(resSuccess.body.unique, 3);
  assert.equal(resSuccess.body.matched, 2);
  assert.equal(resSuccess.body.modified, 2);
  assert.equal(resSuccess.body.missing, 1);

  // Verify DB state updates correctly
  const updatedDoc1 = mockMenuItems.docs.find(d => d._id.toString() === '60c72b2f9b1d8e23f0c3d9a1');
  assert.equal(updatedDoc1.available, false);
});
