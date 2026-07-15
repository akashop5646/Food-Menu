// ponytail: reuses escapeHtml and getFiniteNumber from existing customer receipt helper
import { escapeHtml, getFiniteNumber } from './receiptHelper.js';
import { calculateSettlementSummary, getOrderSettlementBreakdown } from './settlementHelper.js';

// Re-export for test access
export { escapeHtml, getFiniteNumber };

/**
 * Build receipt data for a single PAID order.
 * Returns null if the order is not paid or invalid.
 */
export function buildSinglePaymentReceiptData(order) {
  if (!order || order.paymentStatus !== 'PAID') return null;

  const foodSubtotal = getFiniteNumber(order.total);
  const convenienceFee = getFiniteNumber(order.convenienceFee);
  // ponytail: matches Payments.jsx getCustomerPaidAmount precedence exactly (line 19)
  const totalPaid = getFiniteNumber(order.totalPayable ?? order.total);

  const items = Array.isArray(order.items) ? order.items.map(item => {
    const unitPrice = getFiniteNumber(item.price);
    const quantity = getFiniteNumber(item.quantity, 1);
    return {
      name: String(item.name || 'Menu Item'),
      quantity,
      unitPrice,
      lineTotal: unitPrice * quantity
    };
  }) : [];

  const orderId = String(order._id || '');
  const shortId = orderId.substring(Math.max(0, orderId.length - 6));

  const createdAt = order.createdAt ? new Date(order.createdAt) : null;
  const paidAt = order.paidAt ? new Date(order.paidAt) : null;

  return {
    orderId,
    shortId,
    receiptNumber: `PAY-${shortId.toUpperCase()}`,
    createdAt: createdAt && !isNaN(createdAt.getTime()) ? createdAt.toISOString() : null,
    paidAt: paidAt && !isNaN(paidAt.getTime()) ? paidAt.toISOString() : null,
    tableName: String(order.table || 'N/A'),
    locationName: order.location ? String(order.location) : '',
    items,
    foodSubtotal,
    convenienceFee,
    totalPaid,
    paymentMethod: String(order.paymentType || 'CASH'),
    paymentStatus: 'PAID',
    razorpayPaymentId: order.razorpayPaymentId ? String(order.razorpayPaymentId) : '',
    generatedAt: new Date().toISOString()
  };
}

/**
 * Generate self-contained thermal-receipt HTML for a single paid order.
 */
export function generateSinglePaymentReceiptHtml(receiptData, restaurantName = 'Aurum Table') {
  if (!receiptData) return '';

  const esc = escapeHtml;
  const escName = esc(restaurantName);
  const escReceipt = esc(receiptData.receiptNumber);
  const escTable = esc(receiptData.tableName);
  const escLocation = esc(receiptData.locationName);
  const escMethod = esc(receiptData.paymentMethod);
  const escStatus = esc(receiptData.paymentStatus);
  const escGenerated = esc(new Date(receiptData.generatedAt).toLocaleString());

  const escCreatedAt = receiptData.createdAt
    ? esc(new Date(receiptData.createdAt).toLocaleString())
    : 'N/A';
  const escPaidAt = receiptData.paidAt
    ? esc(new Date(receiptData.paidAt).toLocaleString())
    : '';

  let itemsHtml = '';
  receiptData.items.forEach(item => {
    itemsHtml += `
      <div class="item-row">
        <span class="item-name">${esc(item.quantity)}× ${esc(item.name)}</span>
        <span class="item-price">₹${item.lineTotal.toFixed(2)}</span>
      </div>`;
  });

  const feeRow = receiptData.convenienceFee > 0
    ? `<div class="summary-row"><span>Convenience Fee</span><span>₹${receiptData.convenienceFee.toFixed(2)}</span></div>`
    : '';

  const paidAtRow = escPaidAt
    ? `<div class="info-row"><span>Paid At:</span><span>${escPaidAt}</span></div>`
    : '';

  const locationRow = escLocation
    ? `<div class="info-row"><span>Location:</span><span>${escLocation}</span></div>`
    : '';

  const rzpRow = receiptData.razorpayPaymentId
    ? `<div class="info-row"><span>Payment Ref:</span><span style="font-family:monospace;font-size:11px;word-break:break-all;">${esc(receiptData.razorpayPaymentId)}</span></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Receipt ${escReceipt}</title>
  <style>
    body {
      background-color: #f8f6f1;
      color: #1c1b1b;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 20px;
      line-height: 1.4;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .receipt-container {
      background-color: #ffffff;
      border: 1px solid #e5e2db;
      border-radius: 12px;
      padding: 24px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
      box-sizing: border-box;
    }
    .header { text-align: center; margin-bottom: 20px; border-bottom: 2px dashed #e5e2db; padding-bottom: 16px; }
    .brand { color: #8b6914; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px 0; }
    .subtitle { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #7d4639; margin: 0 0 12px 0; font-weight: 600; }
    .title-banner { background-color: #f1ebd9; color: #8b6914; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; padding: 6px 12px; border-radius: 9999px; display: inline-block; }
    .info-section { font-size: 12px; margin-bottom: 16px; color: #4d4639; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .info-row span:first-child { font-weight: 600; }
    .items-section { border-top: 1px solid #f0ece4; padding-top: 16px; margin-bottom: 16px; }
    .items-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #7d7057; font-weight: 700; margin-bottom: 8px; }
    .item-row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
    .item-name { color: #1c1b1b; }
    .item-price { font-weight: 600; font-variant-numeric: tabular-nums; }
    .summary-section { border-top: 2px solid #1c1b1b; padding-top: 12px; margin-top: 8px; }
    .summary-row { display: flex; justify-content: space-between; font-size: 13px; color: #4d4639; margin-bottom: 4px; }
    .summary-row.grand-total { font-size: 18px; font-weight: 700; color: #8b6914; border-top: 1px solid #1c1b1b; padding-top: 8px; margin-top: 8px; }
    .footer { text-align: center; margin-top: 20px; font-size: 11px; color: #7d7057; border-top: 1px solid #e5e2db; padding-top: 16px; }
    .footer p { margin: 4px 0; }
    .historical-note { font-size: 9px; color: #a09785; text-align: center; margin-top: 12px; font-style: italic; }
    .print-btn-container { margin-bottom: 16px; width: 100%; max-width: 400px; display: flex; justify-content: center; }
    .print-btn { background-color: #8b6914; color: #ffffff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 6px rgba(139,105,20,0.3); }
    .print-btn:hover { background-color: #705410; }
    @media print {
      body { background-color: #ffffff; padding: 0; }
      .receipt-container { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      .print-btn-container { display: none; }
    }
  </style>
</head>
<body>
  <div class="print-btn-container">
    <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <div class="receipt-container">
    <div class="header">
      <h1 class="brand">${escName}</h1>
      <p class="subtitle">Admin Payment Receipt</p>
      <div class="title-banner">Payment Receipt</div>
    </div>
    <div class="info-section">
      <div class="info-row"><span>Receipt No:</span><span>${escReceipt}</span></div>
      <div class="info-row"><span>Order ID:</span><span style="font-family:monospace;">#${esc(receiptData.shortId)}</span></div>
      <div class="info-row"><span>Order Date:</span><span>${escCreatedAt}</span></div>
      ${paidAtRow}
      <div class="info-row"><span>Table:</span><span>${escTable}</span></div>
      ${locationRow}
      <div class="info-row"><span>Payment Method:</span><span style="text-transform:uppercase;">${escMethod}</span></div>
      <div class="info-row"><span>Status:</span><span style="color:#16a34a;font-weight:700;">${escStatus}</span></div>
      ${rzpRow}
    </div>
    <div class="items-section">
      <div class="items-label">Order Items</div>
      ${itemsHtml}
    </div>
    <div class="summary-section">
      <div class="summary-row"><span>Food Subtotal</span><span>₹${receiptData.foodSubtotal.toFixed(2)}</span></div>
      ${feeRow}
      <div class="summary-row grand-total"><span>Total Paid</span><span>₹${receiptData.totalPaid.toFixed(2)}</span></div>
    </div>
    <div class="footer">
      <p style="font-weight:700;color:#8b6914;">✓ Payment Confirmed</p>
      <p>Generated at ${escGenerated}</p>
    </div>
    <p class="historical-note">Amounts shown are based on the values stored when this payment was recorded.</p>
  </div>
</body>
</html>`;
}

/**
 * Build report data from the full filtered payment collection.
 */
export function buildFilteredPaymentReportData(filteredOrders, activeFilters = {}, options = {}) {
  if (!Array.isArray(filteredOrders)) return null;

  const showSettlementDetails = !!options.showSettlementDetails;
  const settlementSummary = showSettlementDetails
    ? calculateSettlementSummary(filteredOrders)
    : null;

  let foodSubtotalTotal = 0;
  let convenienceFeeTotal = 0;
  let customerPaidTotal = 0;
  let paidCount = 0;
  let pendingCount = 0;

  const rows = filteredOrders.map((order, index) => {
    const foodSubtotal = getFiniteNumber(order.total);
    const convenienceFee = getFiniteNumber(order.convenienceFee);
    // ponytail: same precedence as Payments.jsx getCustomerPaidAmount
    const finalAmount = getFiniteNumber(order.totalPayable ?? order.total);

    foodSubtotalTotal += foodSubtotal;
    convenienceFeeTotal += convenienceFee;
    customerPaidTotal += finalAmount;

    if (order.paymentStatus === 'PAID') paidCount++;
    else pendingCount++;

    const orderId = String(order._id || '');
    const shortId = orderId.substring(Math.max(0, orderId.length - 6));

    // Date from paidAt if paid, else createdAt
    const isPaid = order.paymentStatus === 'PAID';
    const rawDate = (isPaid && order.paidAt) ? order.paidAt : order.createdAt;
    const dateObj = rawDate ? new Date(rawDate) : null;
    const dateStr = dateObj && !isNaN(dateObj.getTime())
      ? dateObj.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'N/A';

    const items = Array.isArray(order.items) ? order.items : [];
    const itemSummary = items.length === 0
      ? 'No items'
      : items.slice(0, 2).map(i => `${i.quantity}× ${i.name || 'Item'}`).join(', ') +
        (items.length > 2 ? ` +${items.length - 2} more` : '');

    const settlementInfo = showSettlementDetails
      ? getOrderSettlementBreakdown(order)
      : null;

    return {
      serial: index + 1,
      orderId,
      shortId,
      date: dateStr,
      table: String(order.table || 'N/A'),
      location: order.location ? String(order.location) : '',
      itemSummary,
      foodSubtotal,
      convenienceFee,
      finalAmount,
      method: String(order.paymentType || 'UNKNOWN'),
      status: String(order.paymentStatus || 'PENDING'),
      settlementInfo
    };
  });

  // Normalize filter labels
  const dateRangeLabels = {
    today: 'Today',
    yesterday: 'Yesterday',
    '7d': 'Last 7 Days',
    '30d': 'Last 30 Days',
    this_month: 'This Month',
    custom: 'Custom Range'
  };

  const filters = {
    dateRange: dateRangeLabels[activeFilters.timeRange] || activeFilters.timeRange || 'All',
    customStart: activeFilters.timeRange === 'custom' ? (activeFilters.customStartDate || '') : '',
    customEnd: activeFilters.timeRange === 'custom' ? (activeFilters.customEndDate || '') : '',
    status: activeFilters.statusFilter || 'ALL',
    method: activeFilters.typeFilter || 'ALL',
    search: activeFilters.search || ''
  };

  return {
    title: 'Payment History Report',
    generatedAt: new Date().toISOString(),
    filters,
    summary: {
      totalRecords: filteredOrders.length,
      paidCount,
      pendingCount,
      foodSubtotalTotal,
      convenienceFeeTotal,
      customerPaidTotal,
      settlementSummary
    },
    showSettlementDetails,
    rows
  };
}

/**
 * Generate self-contained landscape-oriented payment report HTML.
 */
export function generatePaymentReportHtml(reportData, restaurantName = 'Aurum Table') {
  if (!reportData) return '';

  const esc = escapeHtml;
  const escName = esc(restaurantName);
  const escGenerated = esc(new Date(reportData.generatedAt).toLocaleString());
  const { filters, summary } = reportData;

  // Build active filters display
  let filtersHtml = '';
  const addFilter = (label, value) => {
    if (value && value !== 'ALL') {
      filtersHtml += `<span class="filter-tag"><strong>${esc(label)}:</strong> ${esc(value)}</span>`;
    }
  };
  addFilter('Date Range', filters.dateRange);
  if (filters.customStart) addFilter('From', filters.customStart);
  if (filters.customEnd) addFilter('To', filters.customEnd);
  addFilter('Status', filters.status);
  addFilter('Method', filters.method);
  if (filters.search) addFilter('Search', filters.search);
  if (!filtersHtml) filtersHtml = '<span class="filter-tag">No filters applied</span>';

  const totalLabel = (summary.paidCount > 0 && summary.pendingCount > 0)
    ? 'Total Recorded Amount'
    : (summary.paidCount > 0 ? 'Total Collected' : 'Total Recorded Amount');

  let settlementSummaryHtml = '';
  if (reportData.showSettlementDetails && summary.settlementSummary) {
    const ss = summary.settlementSummary;
    settlementSummaryHtml = `
    <div class="summary-cards" style="margin-top: -8px; border-top: 1px solid #e5e2db; padding-top: 12px; margin-bottom: 20px;">
      <div class="summary-card" style="border-left: 4px solid #8b6914;"><span class="label">Owner Allocated</span><span class="value gold">₹${ss.ownerAllocatedTotal.toFixed(2)}</span></div>
      <div class="summary-card" style="border-left: 4px solid #16a34a;"><span class="label">Owner Transferred</span><span class="value" style="color:#16a34a">₹${ss.ownerTransferredTotal.toFixed(2)}</span></div>
      <div class="summary-card"><span class="label">Platform Retained</span><span class="value">₹${ss.platformRetainedTotal.toFixed(2)}</span></div>
      <div class="summary-card"><span class="label">Other External</span><span class="value">₹${ss.otherExternalTotal.toFixed(2)}</span></div>
    </div>`;
  }

  let rowsHtml = '';
  reportData.rows.forEach(row => {
    const statusColor = row.status === 'PAID' ? '#16a34a' : '#d97706';
    const feeCell = row.convenienceFee > 0 ? `₹${row.convenienceFee.toFixed(2)}` : '—';

    let settlementInfoHtml = '';
    if (reportData.showSettlementDetails && row.settlementInfo && row.settlementInfo.isEligible) {
      settlementInfoHtml = `
      <div style="font-size: 9px; color: #7d7057; margin-top: 4px; line-height: 1.2;">
        Owner: ₹${row.settlementInfo.ownerAllocated.toFixed(2)} (${row.settlementInfo.ownerTransferred > 0 ? 'Processed' : 'Pending'})<br>
        Platform: ₹${row.settlementInfo.platformRetained.toFixed(2)}
      </div>`;
    }

    rowsHtml += `
      <tr>
        <td>${row.serial}</td>
        <td class="nowrap">${esc(row.date)}</td>
        <td class="mono">#${esc(row.shortId)}${settlementInfoHtml}</td>
        <td>${esc(row.table)}${row.location ? `<br><span class="loc">${esc(row.location)}</span>` : ''}</td>
        <td class="items-col">${esc(row.itemSummary)}</td>
        <td class="num">₹${row.foodSubtotal.toFixed(2)}</td>
        <td class="num">${feeCell}</td>
        <td class="num bold">₹${row.finalAmount.toFixed(2)}</td>
        <td class="method">${esc(row.method)}</td>
        <td><span class="status-badge" style="color:${statusColor}">${esc(row.status)}</span></td>
      </tr>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(reportData.title)} — ${escName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #f8f6f1;
      color: #1c1b1b;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 20px;
      font-size: 12px;
      line-height: 1.4;
    }
    .report-container {
      background: #fff;
      border: 1px solid #e5e2db;
      border-radius: 12px;
      padding: 24px;
      max-width: 1200px;
      margin: 0 auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
    }
    .report-header {
      text-align: center;
      border-bottom: 2px solid #8b6914;
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    .report-header h1 { color: #8b6914; font-size: 20px; margin-bottom: 2px; }
    .report-header h2 { font-size: 14px; color: #4d4639; font-weight: 600; margin-bottom: 4px; }
    .report-header .gen-date { font-size: 11px; color: #7d7057; }
    .filters-section {
      background: #f9f7f2;
      border: 1px solid #e5e2db;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 16px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .filters-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #7d7057; font-weight: 700; margin-right: 4px; }
    .filter-tag { font-size: 11px; background: #fff; border: 1px solid #e5e2db; border-radius: 6px; padding: 3px 8px; color: #4d4639; white-space: nowrap; }
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .summary-card {
      background: #f9f7f2;
      border: 1px solid #e5e2db;
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }
    .summary-card .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: #7d7057; font-weight: 700; display: block; margin-bottom: 4px; }
    .summary-card .value { font-size: 18px; font-weight: 700; color: #1c1b1b; }
    .summary-card .value.gold { color: #8b6914; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    thead th {
      background: #f1ebd9;
      color: #8b6914;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      padding: 8px 6px;
      text-align: left;
      border-bottom: 2px solid #8b6914;
      white-space: nowrap;
    }
    tbody td { padding: 7px 6px; border-bottom: 1px solid #f0ece4; vertical-align: top; }
    tbody tr:hover { background: #faf8f4; }
    .mono { font-family: monospace; font-size: 10px; color: #8b6914; font-weight: 600; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .bold { font-weight: 700; }
    .nowrap { white-space: nowrap; }
    .items-col { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .method { text-transform: uppercase; font-size: 10px; font-weight: 600; }
    .status-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .loc { font-size: 10px; color: #7d7057; }
    .totals-row td { font-weight: 700; border-top: 2px solid #1c1b1b; background: #f9f7f2; padding: 10px 6px; }
    .report-footer { text-align: center; margin-top: 20px; font-size: 10px; color: #7d7057; border-top: 1px solid #e5e2db; padding-top: 12px; }
    .historical-note { font-size: 9px; color: #a09785; font-style: italic; margin-top: 8px; }
    .print-controls { text-align: center; margin-bottom: 16px; }
    .print-btn { background-color: #8b6914; color: #fff; border: none; border-radius: 8px; padding: 10px 24px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 6px rgba(139,105,20,0.3); }
    .print-btn:hover { background-color: #705410; }
    @media print {
      body { background: #fff; padding: 0; font-size: 10px; }
      .report-container { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      .print-controls { display: none; }
      thead { display: table-header-group; }
      tbody tr { page-break-inside: avoid; }
      @page { size: landscape; margin: 10mm; }
    }
  </style>
</head>
<body>
  <div class="print-controls">
    <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <div class="report-container">
    <div class="report-header">
      <h1>${escName}</h1>
      <h2>${esc(reportData.title)}</h2>
      <span class="gen-date">Generated: ${escGenerated}</span>
    </div>
    <div class="filters-section">
      <span class="filters-label">Active Filters:</span>
      ${filtersHtml}
    </div>
    <div class="summary-cards">
      <div class="summary-card"><span class="label">Matching Records</span><span class="value">${summary.totalRecords}</span></div>
      <div class="summary-card"><span class="label">Paid</span><span class="value" style="color:#16a34a">${summary.paidCount}</span></div>
      <div class="summary-card"><span class="label">Pending</span><span class="value" style="color:#d97706">${summary.pendingCount}</span></div>
      <div class="summary-card"><span class="label">Food Subtotal</span><span class="value">₹${summary.foodSubtotalTotal.toFixed(2)}</span></div>
      <div class="summary-card"><span class="label">Convenience Fees</span><span class="value">₹${summary.convenienceFeeTotal.toFixed(2)}</span></div>
      <div class="summary-card"><span class="label">${esc(totalLabel)}</span><span class="value gold">₹${summary.customerPaidTotal.toFixed(2)}</span></div>
    </div>
    ${settlementSummaryHtml}
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Payment Date</th>
          <th>Order</th>
          <th>Table / Location</th>
          <th>Items</th>
          <th style="text-align:right">Food Subtotal</th>
          <th style="text-align:right">Fee</th>
          <th style="text-align:right">Final Amount</th>
          <th>Method</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        <tr class="totals-row">
          <td colspan="5" style="text-align:right">TOTALS</td>
          <td class="num">₹${summary.foodSubtotalTotal.toFixed(2)}</td>
          <td class="num">₹${summary.convenienceFeeTotal.toFixed(2)}</td>
          <td class="num" style="color:#8b6914">₹${summary.customerPaidTotal.toFixed(2)}</td>
          <td colspan="2"></td>
        </tr>
      </tbody>
    </table>
    <div class="report-footer">
      <p>${esc(reportData.title)} — ${escName}</p>
      <p>${summary.totalRecords} records · Generated ${escGenerated}</p>
      <p class="historical-note">Amounts shown are based on the values stored when each payment was recorded.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Open a new browser window and write the generated HTML for printing.
 * Window is opened synchronously from the click handler to avoid popup blocking.
 * The print window is NOT auto-closed after window.print().
 */
export function openPrintableDocument(html, windowTitle = 'Print Document') {
  // ponytail: caller must invoke this synchronously from click handler
  const printWindow = window.open('', '_blank');

  if (!printWindow) {
    return {
      success: false,
      error: 'The print preview was blocked. Allow pop-ups for Aurum OS and try again.'
    };
  }

  try {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.document.title = windowTitle;

    // Trigger print after the document is fully rendered
    if (printWindow.document.readyState === 'complete') {
      printWindow.print();
    } else {
      printWindow.addEventListener('load', () => {
        printWindow.print();
      });
    }

    // ponytail: intentionally NOT closing the window — user closes it after print/save
    return { success: true, error: null };
  } catch (err) {
    return {
      success: false,
      error: 'Failed to generate the print preview. Please try again.'
    };
  }
}
