import assert from 'node:assert/strict';
import test from 'node:test';

import {
  escapeHtml,
  getFiniteNumber,
  buildSinglePaymentReceiptData,
  generateSinglePaymentReceiptHtml,
  buildFilteredPaymentReportData,
  generatePaymentReportHtml
} from '../../frontend/src/utils/paymentDocumentHelper.js';

// --- Single Payment Receipt Tests ---

test('1. Paid order builds valid receipt data', () => {
  const order = {
    _id: 'aaaaaaaaaaaaaaaaaa111111',
    table: 'Table 7',
    location: 'Rooftop',
    total: 200,
    convenienceFee: 10,
    totalPayable: 210,
    paymentStatus: 'PAID',
    paymentType: 'RAZORPAY',
    razorpayPaymentId: 'pay_test123',
    items: [{ name: 'Pasta', price: 100, quantity: 2 }],
    createdAt: new Date().toISOString(),
    paidAt: new Date().toISOString()
  };

  const data = buildSinglePaymentReceiptData(order);
  assert.ok(data);
  assert.equal(data.shortId, '111111');
  assert.equal(data.tableName, 'Table 7');
  assert.equal(data.locationName, 'Rooftop');
  assert.equal(data.foodSubtotal, 200);
  assert.equal(data.convenienceFee, 10);
  assert.equal(data.totalPaid, 210);
  assert.equal(data.paymentMethod, 'RAZORPAY');
  assert.equal(data.paymentStatus, 'PAID');
  assert.equal(data.razorpayPaymentId, 'pay_test123');
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].lineTotal, 200);
});

test('2. Pending order returns null (receipt rejected)', () => {
  const order = { _id: 'abc123', paymentStatus: 'PENDING', total: 50, items: [] };
  assert.equal(buildSinglePaymentReceiptData(order), null);
});

test('3. Missing/undefined order returns null', () => {
  assert.equal(buildSinglePaymentReceiptData(null), null);
  assert.equal(buildSinglePaymentReceiptData(undefined), null);
});

test('4. Food subtotal uses persisted order.total', () => {
  const order = {
    _id: 'aaaaaaaaaaaaaaaaaa222222',
    table: 'T1',
    total: 150,
    convenienceFee: 5,
    totalPayable: 155,
    paymentStatus: 'PAID',
    items: [{ name: 'Burger', price: 75, quantity: 2 }]
  };
  const data = buildSinglePaymentReceiptData(order);
  assert.equal(data.foodSubtotal, 150);
});

test('5. Convenience fee displayed when > 0', () => {
  const order = {
    _id: 'aaaaaaaaaaaaaaaaaa333333',
    table: 'T2',
    total: 100,
    convenienceFee: 8,
    totalPayable: 108,
    paymentStatus: 'PAID',
    items: [{ name: 'Pizza', price: 100, quantity: 1 }]
  };
  const data = buildSinglePaymentReceiptData(order);
  const html = generateSinglePaymentReceiptHtml(data);
  assert.ok(html.includes('Convenience Fee'));
  assert.ok(html.includes('₹8.00'));
});

test('6. Convenience fee row omitted when 0', () => {
  const order = {
    _id: 'aaaaaaaaaaaaaaaaaa444444',
    table: 'T3',
    total: 100,
    convenienceFee: 0,
    totalPayable: 100,
    paymentStatus: 'PAID',
    items: [{ name: 'Salad', price: 100, quantity: 1 }]
  };
  const data = buildSinglePaymentReceiptData(order);
  const html = generateSinglePaymentReceiptHtml(data);
  assert.ok(!html.includes('Convenience Fee'));
});

test('7. totalPayable preferred over total for final amount', () => {
  const order = {
    _id: 'aaaaaaaaaaaaaaaaaa555555',
    table: 'T4',
    total: 200,
    convenienceFee: 15,
    totalPayable: 215,
    paymentStatus: 'PAID',
    items: []
  };
  const data = buildSinglePaymentReceiptData(order);
  assert.equal(data.totalPaid, 215);
});

test('8. Legacy order without totalPayable falls back to total', () => {
  const order = {
    _id: 'aaaaaaaaaaaaaaaaaa666666',
    table: 'T5',
    total: 180,
    paymentStatus: 'PAID',
    items: [{ name: 'Soup', price: 90, quantity: 2 }]
  };
  const data = buildSinglePaymentReceiptData(order);
  assert.equal(data.totalPaid, 180);
  assert.equal(data.convenienceFee, 0);
});

test('9. No double-counting of convenience fee', () => {
  const order = {
    _id: 'aaaaaaaaaaaaaaaaaa777777',
    table: 'T6',
    total: 100,
    convenienceFee: 10,
    totalPayable: 110,
    paymentStatus: 'PAID',
    items: [{ name: 'Steak', price: 100, quantity: 1 }]
  };
  const data = buildSinglePaymentReceiptData(order);
  // totalPaid should be 110 (from totalPayable), not 100 + 10 = 110 recalculated
  assert.equal(data.totalPaid, 110);
  assert.equal(data.foodSubtotal, 100);
  assert.equal(data.convenienceFee, 10);
  // Verify: foodSubtotal + convenienceFee happens to equal totalPaid here,
  // but a different totalPayable would show the authoritative value is used:
  const order2 = { ...order, totalPayable: 112 }; // eg. rounding scenario
  const data2 = buildSinglePaymentReceiptData(order2);
  assert.equal(data2.totalPaid, 112);
});

test('10. Invalid numeric values don\'t produce NaN', () => {
  const order = {
    _id: 'aaaaaaaaaaaaaaaaaa888888',
    table: 'T7',
    total: 'not-a-number',
    convenienceFee: undefined,
    totalPayable: null,
    paymentStatus: 'PAID',
    items: [{ name: 'X', price: 'abc', quantity: NaN }]
  };
  const data = buildSinglePaymentReceiptData(order);
  assert.equal(data.foodSubtotal, 0);
  assert.equal(data.convenienceFee, 0);
  assert.equal(data.totalPaid, 0);
  assert.equal(data.items[0].lineTotal, 0);
});

test('11. XSS in order fields is escaped in receipt HTML', () => {
  const order = {
    _id: 'aaaaaaaaaaaaaaaaaa999999',
    table: '<script>alert(1)</script>',
    location: 'Bar & "Grill"',
    total: 50,
    totalPayable: 50,
    paymentStatus: 'PAID',
    paymentType: 'CASH',
    items: [{ name: 'Drink <img onerror=alert(1)>', price: 50, quantity: 1 }]
  };
  const data = buildSinglePaymentReceiptData(order);
  const html = generateSinglePaymentReceiptHtml(data, 'Test <Restaurant>');
  assert.ok(html.includes('Test &lt;Restaurant&gt;'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Bar &amp; &quot;Grill&quot;'));
  assert.ok(html.includes('Drink &lt;img onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<script>alert'));
});

test('12. Receipt HTML has no external URLs', () => {
  const order = {
    _id: 'aaaaaaaaaaaaaaaaaabbbbbb',
    table: 'T8', total: 100, totalPayable: 100,
    paymentStatus: 'PAID', items: []
  };
  const data = buildSinglePaymentReceiptData(order);
  const html = generateSinglePaymentReceiptHtml(data);
  assert.ok(!html.includes('http://'));
  assert.ok(!html.includes('https://'));
});

test('13. Receipt HTML has @media print hiding controls', () => {
  const order = {
    _id: 'aaaaaaaaaaaaaaaaaa000000',
    table: 'T9', total: 100, totalPayable: 100,
    paymentStatus: 'PAID', items: []
  };
  const data = buildSinglePaymentReceiptData(order);
  const html = generateSinglePaymentReceiptHtml(data);
  assert.ok(html.includes('@media print'));
  assert.ok(html.includes('display: none'));
});

test('14. Receipt includes payment method and status', () => {
  const order = {
    _id: 'aaaaaaaaaaaaaaaaaa112233',
    table: 'T10', total: 75, totalPayable: 75,
    paymentStatus: 'PAID', paymentType: 'UPI', items: []
  };
  const data = buildSinglePaymentReceiptData(order);
  const html = generateSinglePaymentReceiptHtml(data);
  assert.ok(html.includes('UPI'));
  assert.ok(html.includes('PAID'));
});

test('15. Receipt includes historical-record note', () => {
  const order = {
    _id: 'aaaaaaaaaaaaaaaaaa445566',
    table: 'T11', total: 60, totalPayable: 60,
    paymentStatus: 'PAID', items: []
  };
  const data = buildSinglePaymentReceiptData(order);
  const html = generateSinglePaymentReceiptHtml(data);
  assert.ok(html.includes('values stored when this payment was recorded'));
});

// --- Filtered Payment Report Tests ---

test('16. Multiple filtered orders aggregate correctly in report', () => {
  const orders = [
    { _id: 'aaaaaaaaaaaaaaaaaa100001', table: 'T1', total: 100, convenienceFee: 5, totalPayable: 105, paymentStatus: 'PAID', paymentType: 'RAZORPAY', items: [{ name: 'A', price: 50, quantity: 2 }], createdAt: new Date().toISOString() },
    { _id: 'aaaaaaaaaaaaaaaaaa100002', table: 'T2', total: 200, convenienceFee: 10, totalPayable: 210, paymentStatus: 'PAID', paymentType: 'CASH', items: [{ name: 'B', price: 100, quantity: 2 }], createdAt: new Date().toISOString() }
  ];
  const report = buildFilteredPaymentReportData(orders, {});
  assert.equal(report.summary.foodSubtotalTotal, 300);
  assert.equal(report.summary.convenienceFeeTotal, 15);
  assert.equal(report.summary.customerPaidTotal, 315);
  assert.equal(report.rows.length, 2);
});

test('17. Mixed paid/pending statuses counted correctly in report', () => {
  const orders = [
    { _id: 'aaaaaaaaaaaaaaaaaa200001', table: 'T1', total: 50, paymentStatus: 'PAID', items: [], createdAt: new Date().toISOString() },
    { _id: 'aaaaaaaaaaaaaaaaaa200002', table: 'T2', total: 60, paymentStatus: 'PENDING', items: [], createdAt: new Date().toISOString() },
    { _id: 'aaaaaaaaaaaaaaaaaa200003', table: 'T3', total: 70, paymentStatus: 'PAID', items: [], createdAt: new Date().toISOString() }
  ];
  const report = buildFilteredPaymentReportData(orders, {});
  assert.equal(report.summary.paidCount, 2);
  assert.equal(report.summary.pendingCount, 1);
  assert.equal(report.summary.totalRecords, 3);
});

test('18. Active date filter appears in report metadata', () => {
  const orders = [{ _id: 'aaaaaaaaaaaaaaaaaa300001', table: 'T1', total: 50, paymentStatus: 'PAID', items: [], createdAt: new Date().toISOString() }];
  const report = buildFilteredPaymentReportData(orders, { timeRange: 'today' });
  assert.equal(report.filters.dateRange, 'Today');
});

test('19. Search query appears only when non-empty', () => {
  const orders = [{ _id: 'aaaaaaaaaaaaaaaaaa400001', table: 'T1', total: 50, paymentStatus: 'PAID', items: [], createdAt: new Date().toISOString() }];

  const reportNoSearch = buildFilteredPaymentReportData(orders, { search: '' });
  assert.equal(reportNoSearch.filters.search, '');

  const reportWithSearch = buildFilteredPaymentReportData(orders, { search: 'burger' });
  assert.equal(reportWithSearch.filters.search, 'burger');
});

test('20. Report uses all filtered records (length matches input)', () => {
  const orders = Array.from({ length: 50 }, (_, i) => ({
    _id: `aaaaaaaaaaaaaaaaaa5${String(i).padStart(5, '0')}`,
    table: `T${i}`, total: 10 * (i + 1), paymentStatus: 'PAID', items: [], createdAt: new Date().toISOString()
  }));
  const report = buildFilteredPaymentReportData(orders, {});
  assert.equal(report.rows.length, 50);
  assert.equal(report.summary.totalRecords, 50);
});

test('21. Report HTML uses landscape orientation', () => {
  const orders = [{ _id: 'aaaaaaaaaaaaaaaaaa600001', table: 'T1', total: 50, paymentStatus: 'PAID', items: [], createdAt: new Date().toISOString() }];
  const report = buildFilteredPaymentReportData(orders, {});
  const html = generatePaymentReportHtml(report);
  assert.ok(html.includes('size: landscape'));
});

test('22. Report HTML has no external URLs', () => {
  const orders = [{ _id: 'aaaaaaaaaaaaaaaaaa700001', table: 'T1', total: 50, paymentStatus: 'PAID', items: [], createdAt: new Date().toISOString() }];
  const report = buildFilteredPaymentReportData(orders, {});
  const html = generatePaymentReportHtml(report);
  assert.ok(!html.includes('http://'));
  assert.ok(!html.includes('https://'));
});

test('23. Report totals use persisted historical values', () => {
  const orders = [
    { _id: 'aaaaaaaaaaaaaaaaaa800001', table: 'T1', total: 100, convenienceFee: 10, totalPayable: 110, paymentStatus: 'PAID', items: [], createdAt: new Date().toISOString() },
    { _id: 'aaaaaaaaaaaaaaaaaa800002', table: 'T2', total: 200, convenienceFee: 0, totalPayable: 200, paymentStatus: 'PAID', items: [], createdAt: new Date().toISOString() }
  ];
  const report = buildFilteredPaymentReportData(orders, {});
  assert.equal(report.summary.foodSubtotalTotal, 300);
  assert.equal(report.summary.convenienceFeeTotal, 10);
  assert.equal(report.summary.customerPaidTotal, 310);
});

test('24. Zero-fee orders included correctly', () => {
  const orders = [
    { _id: 'aaaaaaaaaaaaaaaaaa900001', table: 'T1', total: 50, convenienceFee: 0, totalPayable: 50, paymentStatus: 'PAID', items: [{ name: 'Tea', price: 25, quantity: 2 }], createdAt: new Date().toISOString() }
  ];
  const report = buildFilteredPaymentReportData(orders, {});
  assert.equal(report.summary.convenienceFeeTotal, 0);
  assert.equal(report.rows[0].convenienceFee, 0);
  assert.equal(report.rows[0].finalAmount, 50);

  const html = generatePaymentReportHtml(report);
  // Fee column shows — for zero
  assert.ok(html.includes('—'));
});

test('25. Custom date range appears in report filters', () => {
  const orders = [{ _id: 'aaaaaaaaaaaaaaaaaab00001', table: 'T1', total: 50, paymentStatus: 'PAID', items: [], createdAt: new Date().toISOString() }];
  const report = buildFilteredPaymentReportData(orders, {
    timeRange: 'custom',
    customStartDate: '2026-07-01',
    customEndDate: '2026-07-13'
  });
  assert.equal(report.filters.dateRange, 'Custom Range');
  assert.equal(report.filters.customStart, '2026-07-01');
  assert.equal(report.filters.customEnd, '2026-07-13');
});

test('26. Report with mixed statuses labels total as "Total Recorded Amount"', () => {
  const orders = [
    { _id: 'aaaaaaaaaaaaaaaaaac00001', table: 'T1', total: 50, paymentStatus: 'PAID', items: [], createdAt: new Date().toISOString() },
    { _id: 'aaaaaaaaaaaaaaaaaac00002', table: 'T2', total: 30, paymentStatus: 'PENDING', items: [], createdAt: new Date().toISOString() }
  ];
  const report = buildFilteredPaymentReportData(orders, {});
  const html = generatePaymentReportHtml(report);
  assert.ok(html.includes('Total Recorded Amount'));
});
