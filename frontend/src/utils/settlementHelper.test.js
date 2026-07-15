import test from 'node:test';
import assert from 'node:assert';
import { getOrderSettlementBreakdown, calculateSettlementSummary } from './settlementHelper.js';

test('getOrderSettlementBreakdown returns zeros for unpaid order', () => {
  const order = {
    paymentStatus: 'PENDING',
    total: '150.00',
    convenienceFee: '10.00',
    splitSettlement: {
      platformRetainedAmountPaise: 5000,
      recipients: [
        { recipientType: 'RESTAURANT_OWNER', amountPaise: 10000, status: 'PROCESSED' }
      ]
    }
  };
  const breakdown = getOrderSettlementBreakdown(order);
  assert.strictEqual(breakdown.isEligible, false);
  assert.strictEqual(breakdown.ownerAllocated, 0);
  assert.strictEqual(breakdown.ownerTransferred, 0);
  assert.strictEqual(breakdown.platformRetained, 0);
  assert.strictEqual(breakdown.otherAllocated, 0);
  assert.strictEqual(breakdown.foodSubtotal, 0);
  assert.strictEqual(breakdown.convenienceFee, 0);
});

test('getOrderSettlementBreakdown returns zeros for paid order without splitSettlement', () => {
  const order = {
    paymentStatus: 'PAID',
    total: '150.00',
    convenienceFee: '10.00'
  };
  const breakdown = getOrderSettlementBreakdown(order);
  assert.strictEqual(breakdown.isEligible, false);
  assert.strictEqual(breakdown.ownerAllocated, 0);
  assert.strictEqual(breakdown.ownerTransferred, 0);
  assert.strictEqual(breakdown.platformRetained, 0);
  assert.strictEqual(breakdown.otherAllocated, 0);
  assert.strictEqual(breakdown.foodSubtotal, 150);
  assert.strictEqual(breakdown.convenienceFee, 10);
});

test('getOrderSettlementBreakdown calculates breakdown for eligible order correctly', () => {
  const order = {
    paymentStatus: 'PAID',
    total: '120.00',
    convenienceFee: '5.00',
    splitSettlement: {
      platformRetainedAmountPaise: 2000, // 20.00 INR
      recipients: [
        { recipientType: 'RESTAURANT_OWNER', amountPaise: 8000, status: 'PROCESSED' }, // 80.00 INR
        { recipientType: 'OTHER', amountPaise: 2000, status: 'PROCESSED' } // 20.00 INR
      ]
    }
  };
  const breakdown = getOrderSettlementBreakdown(order);
  assert.strictEqual(breakdown.isEligible, true);
  assert.strictEqual(breakdown.foodSubtotal, 120.00);
  assert.strictEqual(breakdown.convenienceFee, 5.00);
  assert.strictEqual(breakdown.ownerAllocated, 80.00);
  assert.strictEqual(breakdown.ownerTransferred, 80.00);
  assert.strictEqual(breakdown.platformRetained, 20.00);
  assert.strictEqual(breakdown.otherAllocated, 20.00);
});

test('getOrderSettlementBreakdown handles unprocessed or non-owner recipients correctly', () => {
  const order = {
    paymentStatus: 'PAID',
    total: '100.00',
    convenienceFee: '0.00',
    splitSettlement: {
      platformRetainedAmountPaise: 1000, // 10.00
      recipients: [
        { recipientType: 'RESTAURANT_OWNER', amountPaise: 6000, status: 'PENDING' }, // 60.00
        { recipientType: 'OTHER', amountPaise: 3000, status: 'PROCESSED' } // 30.00
      ]
    }
  };
  const breakdown = getOrderSettlementBreakdown(order);
  assert.strictEqual(breakdown.isEligible, true);
  assert.strictEqual(breakdown.ownerAllocated, 60.00);
  assert.strictEqual(breakdown.ownerTransferred, 0.00); // status is PENDING, so 0
  assert.strictEqual(breakdown.platformRetained, 10.00);
  assert.strictEqual(breakdown.otherAllocated, 30.00);
});

test('calculateSettlementSummary aggregates list of orders correctly', () => {
  const orders = [
    {
      paymentStatus: 'PAID',
      total: '100.00',
      convenienceFee: '5.00',
      splitSettlement: {
        platformRetainedAmountPaise: 1000,
        recipients: [
          { recipientType: 'RESTAURANT_OWNER', amountPaise: 6000, status: 'PROCESSED' },
          { recipientType: 'OTHER', amountPaise: 3000, status: 'PROCESSED' }
        ]
      }
    },
    {
      paymentStatus: 'PAID',
      total: '200.00',
      convenienceFee: '10.00',
      splitSettlement: {
        platformRetainedAmountPaise: 2000,
        recipients: [
          { recipientType: 'RESTAURANT_OWNER', amountPaise: 12000, status: 'FAILED' },
          { recipientType: 'OTHER', amountPaise: 6000, status: 'PROCESSED' }
        ]
      }
    },
    {
      paymentStatus: 'PENDING',
      total: '500.00',
      convenienceFee: '0.00'
    }
  ];

  const summary = calculateSettlementSummary(orders);
  assert.strictEqual(summary.foodSubtotalTotal, 300.00); // 100 + 200 (unpaid order excluded)
  assert.strictEqual(summary.convenienceFeeTotal, 15.00); // 5 + 10
  assert.strictEqual(summary.ownerAllocatedTotal, 180.00); // 60 + 120
  assert.strictEqual(summary.ownerTransferredTotal, 60.00); // 60 + 0 (since second failed)
  assert.strictEqual(summary.platformRetainedTotal, 30.00); // 10 + 20
  assert.strictEqual(summary.otherExternalTotal, 90.00); // 30 + 60
});
