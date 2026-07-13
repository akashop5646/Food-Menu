import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';

import {
  escapeHtml,
  getFiniteNumber,
  buildPaidReceiptData,
  generateReceiptHtml
} from '../../frontend/src/utils/receiptHelper.js';

test('receiptHelper: escapeHtml utility', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('"test" & \'value\''), '&quot;test&quot; &amp; &#039;value&#039;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(123), '123');
});

test('receiptHelper: getFiniteNumber utility', () => {
  assert.equal(getFiniteNumber(10), 10);
  assert.equal(getFiniteNumber('15.5'), 15.5);
  assert.equal(getFiniteNumber(NaN, 5), 5);
  assert.equal(getFiniteNumber(Infinity, 100), 100);
  assert.equal(getFiniteNumber(null), 0);
  assert.equal(getFiniteNumber(undefined), 0);
});

test('receiptHelper: buildPaidReceiptData eligibility', () => {
  const unpaidOrder = {
    _id: new ObjectId(),
    table: 'Table 3',
    total: 100,
    paymentStatus: 'PENDING'
  };

  const paidOrder = {
    _id: new ObjectId(),
    table: 'Table 3',
    total: 100,
    paymentStatus: 'PAID'
  };

  // 1. Unpaid order session -> returns null (not eligible)
  assert.equal(buildPaidReceiptData([unpaidOrder]), null);

  // 2. Partially paid session -> returns null or only processes the paid ones
  // Note: App.jsx verifies activeOrder && unpaidTotal === 0, so if there's any unpaid, the button is hidden.
  // But if buildPaidReceiptData is called with mixed list, it filters out unpaid.
  const mixedData = buildPaidReceiptData([paidOrder, unpaidOrder]);
  assert.equal(mixedData.orders.length, 1);
  assert.equal(mixedData.orders[0].id, paidOrder._id.toString());

  // 3. Empty or invalid inputs
  assert.equal(buildPaidReceiptData([]), null);
  assert.equal(buildPaidReceiptData(null), null);
});

test('receiptHelper: convenience fee and totals calculations', () => {
  const orderA = {
    _id: new ObjectId(),
    table: 'Table 5',
    location: 'Terrace',
    total: 70,
    convenienceFee: 15,
    totalPayable: 85,
    paymentStatus: 'PAID',
    paymentType: 'CARD',
    items: [
      { name: 'Burger', price: 35, quantity: 2 }
    ],
    createdAt: new Date().toISOString()
  };

  const orderB = {
    _id: new ObjectId(),
    table: 'Table 5',
    location: 'Terrace',
    total: 20,
    convenienceFee: 0,
    totalPayable: 20,
    paymentStatus: 'PAID',
    paymentType: 'CASH',
    items: [
      { name: 'Soda', price: 20, quantity: 1 }
    ],
    createdAt: new Date().toISOString()
  };

  const receipt = buildPaidReceiptData([orderA, orderB]);
  assert.ok(receipt);

  // Check table and location
  assert.equal(receipt.tableName, 'Table 5');
  assert.equal(receipt.locationName, 'Terrace');

  // Verify food subtotal (70 + 20)
  assert.equal(receipt.foodSubtotal, 90);

  // Verify convenience fee (15 + 0)
  assert.equal(receipt.convenienceFee, 15);

  // Verify total paid (85 + 20 = 105)
  assert.equal(receipt.totalPaid, 105);

  // Verify no double counting (totalPaid matches authoritative sum of order totalPayables, not foodSubtotal + fee directly)
  assert.equal(receipt.totalPaid, 105);
});

test('receiptHelper: legacy orders support (missing convenienceFee or totalPayable)', () => {
  const legacyOrder = {
    _id: new ObjectId(),
    table: 'Table 2',
    total: 120,
    paymentStatus: 'PAID',
    items: [
      { name: 'Pasta', price: 120, quantity: 1 }
    ]
  };

  const receipt = buildPaidReceiptData([legacyOrder]);
  assert.ok(receipt);
  assert.equal(receipt.foodSubtotal, 120);
  assert.equal(receipt.convenienceFee, 0);
  assert.equal(receipt.totalPaid, 120);
});

test('receiptHelper: HTML generation escaping & self-contained validation', () => {
  const dirtyOrder = {
    _id: new ObjectId('666666666666666666666666'),
    table: 'Table <script>alert(1)</script>',
    location: 'Bar & Grill',
    total: 50,
    convenienceFee: 5,
    totalPayable: 55,
    paymentStatus: 'PAID',
    paymentType: 'CASH',
    items: [
      { name: 'Beer "Special"', price: 25, quantity: 2 }
    ],
    createdAt: new Date().toISOString()
  };

  const receiptData = buildPaidReceiptData([dirtyOrder]);
  const html = generateReceiptHtml(receiptData, 'Aurum <Restaurant>');

  // Verify XSS escaping
  assert.ok(html.includes('Aurum &lt;Restaurant&gt;'));
  assert.ok(html.includes('Table &lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Bar &amp; Grill'));
  assert.ok(html.includes('Beer &quot;Special&quot;'));
  assert.ok(html.includes('Order #666666'));

  // Verify convenience fee is displayed in html
  assert.ok(html.includes('Convenience Fee'));
  assert.ok(html.includes('₹5.00'));

  // Verify print button media queries exist
  assert.ok(html.includes('@media print'));
  assert.ok(html.includes('window.print()'));
});

test('receiptHelper: HTML generation omission of fee row when zero', () => {
  const zeroFeeOrder = {
    _id: new ObjectId(),
    table: 'Table 1',
    total: 40,
    convenienceFee: 0,
    totalPayable: 40,
    paymentStatus: 'PAID',
    items: [
      { name: 'Coffee', price: 20, quantity: 2 }
    ]
  };

  const receiptData = buildPaidReceiptData([zeroFeeOrder]);
  const html = generateReceiptHtml(receiptData);

  // Convenience Fee label should NOT be present
  assert.ok(!html.includes('<div class="summary-row">\n        <span>Convenience Fee</span>'));
  assert.ok(html.includes('₹40.00'));
});
