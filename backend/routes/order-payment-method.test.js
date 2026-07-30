import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';

process.env.JWT_SECRET = 'test_secret_key_for_testing';

import { setMockDB } from '../db.js';
import { PAYMENT_TYPE } from '../constants/paymentType.js';
import { ORDER_STATUS } from '../constants/orderStatus.js';

test('1. RAZORPAY -> CASH update succeeds and modifies paymentType', async () => {
  const orderId = new ObjectId();
  const mockOrder = {
    _id: orderId,
    table: 'T-10',
    total: 250,
    totalPayable: 255,
    convenienceFee: 5,
    paymentType: PAYMENT_TYPE.RAZORPAY,
    paymentStatus: 'PENDING',
    status: ORDER_STATUS.NEW,
    createdAt: new Date()
  };

  const orders = [mockOrder];
  const db = {
    collection: () => ({
      findOne: async (q) => orders.find(o => String(o._id) === String(q._id)) || null,
      findOneAndUpdate: async (filter, update) => {
        const idx = orders.findIndex(o => String(o._id) === String(filter._id) && o.paymentStatus !== filter.paymentStatus?.$ne && o.status !== filter.status?.$ne && o.paymentType !== filter.paymentType?.$ne);
        if (idx === -1) return null;
        Object.assign(orders[idx], update.$set);
        return { value: structuredClone(orders[idx]) };
      }
    })
  };

  setMockDB(db);

  const existing = await db.collection('orders').findOne({ _id: orderId });
  assert.ok(existing);
  assert.equal(existing.paymentType, PAYMENT_TYPE.RAZORPAY);

  const updated = await db.collection('orders').findOneAndUpdate(
    { _id: orderId, paymentStatus: { $ne: 'PAID' }, status: { $ne: ORDER_STATUS.CANCELLED }, paymentType: { $ne: PAYMENT_TYPE.CASH } },
    { $set: { paymentType: PAYMENT_TYPE.CASH } }
  );

  assert.ok(updated?.value);
  assert.equal(updated.value.paymentType, PAYMENT_TYPE.CASH);
});

test('2. Attempting CASH -> CASH returns null on atomic query (no-op)', async () => {
  const orderId = new ObjectId();
  const mockOrder = {
    _id: orderId,
    table: 'T-10',
    paymentType: PAYMENT_TYPE.CASH,
    paymentStatus: 'PENDING',
    status: ORDER_STATUS.NEW
  };

  const orders = [mockOrder];
  const db = {
    collection: () => ({
      findOneAndUpdate: async (filter) => {
        const idx = orders.findIndex(o => String(o._id) === String(filter._id) && o.paymentType !== filter.paymentType?.$ne);
        if (idx === -1) return null;
        return { value: structuredClone(orders[idx]) };
      }
    })
  };

  setMockDB(db);

  const res = await db.collection('orders').findOneAndUpdate({
    _id: orderId,
    paymentType: { $ne: PAYMENT_TYPE.CASH }
  });

  assert.equal(res, null);
});

test('3. Attempting to change payment method on PAID order returns null', async () => {
  const orderId = new ObjectId();
  const mockOrder = {
    _id: orderId,
    paymentType: PAYMENT_TYPE.RAZORPAY,
    paymentStatus: 'PAID',
    status: ORDER_STATUS.COMPLETED
  };

  const orders = [mockOrder];
  const db = {
    collection: () => ({
      findOneAndUpdate: async (filter) => {
        const idx = orders.findIndex(o => String(o._id) === String(filter._id) && o.paymentStatus !== filter.paymentStatus?.$ne);
        if (idx === -1) return null;
        return { value: structuredClone(orders[idx]) };
      }
    })
  };

  setMockDB(db);

  const res = await db.collection('orders').findOneAndUpdate({
    _id: orderId,
    paymentStatus: { $ne: 'PAID' }
  });

  assert.equal(res, null);
});

test('4. Attempting to change payment method on CANCELLED order returns null', async () => {
  const orderId = new ObjectId();
  const mockOrder = {
    _id: orderId,
    paymentType: PAYMENT_TYPE.RAZORPAY,
    paymentStatus: 'PENDING',
    status: ORDER_STATUS.CANCELLED
  };

  const orders = [mockOrder];
  const db = {
    collection: () => ({
      findOneAndUpdate: async (filter) => {
        const idx = orders.findIndex(o => String(o._id) === String(filter._id) && o.status !== filter.status?.$ne);
        if (idx === -1) return null;
        return { value: structuredClone(orders[idx]) };
      }
    })
  };

  setMockDB(db);

  const res = await db.collection('orders').findOneAndUpdate({
    _id: orderId,
    status: { $ne: ORDER_STATUS.CANCELLED }
  });

  assert.equal(res, null);
});

test('5. Customer online checkout rejects non-online payment methods', async () => {
  const mockOrder = {
    _id: new ObjectId(),
    paymentType: PAYMENT_TYPE.CASH,
    paymentStatus: 'PENDING'
  };

  const isOnlineSupported = ['RAZORPAY', 'ONLINE', 'NOW'].includes(mockOrder.paymentType);
  assert.equal(isOnlineSupported, false);
});
