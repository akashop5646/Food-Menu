export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getFiniteNumber(val, fallback = 0) {
  const num = Number(val);
  return Number.isFinite(num) ? num : fallback;
}

export function buildPaidReceiptData(ordersList) {
  if (!Array.isArray(ordersList)) return null;

  const validOrders = ordersList.filter(o => o && o.paymentStatus === 'PAID');
  if (validOrders.length === 0) return null;

  let totalSubtotal = 0;
  let totalFee = 0;
  let totalPaid = 0;

  const normalizedOrders = validOrders.map(order => {
    const orderSubtotal = getFiniteNumber(order.total);
    const orderFee = getFiniteNumber(order.convenienceFee);
    const orderTotal = getFiniteNumber(order.totalPayable, orderSubtotal);

    totalSubtotal += orderSubtotal;
    totalFee += orderFee;
    totalPaid += orderTotal;

    const items = Array.isArray(order.items) ? order.items.map(item => {
      const price = getFiniteNumber(item.price);
      const qty = getFiniteNumber(item.quantity);
      return {
        name: String(item.name || 'Menu Item'),
        quantity: qty,
        price: price,
        lineTotal: price * qty
      };
    }) : [];

    return {
      id: String(order._id),
      shortId: String(order._id).substring(Math.max(0, String(order._id).length - 6)),
      createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : new Date().toISOString(),
      items,
      subtotal: orderSubtotal,
      convenienceFee: orderFee,
      total: orderTotal,
      paymentType: String(order.paymentType || 'ONLINE'),
      paymentStatus: String(order.paymentStatus || 'PAID')
    };
  });

  // Use the details from the first order or default values
  const firstOrder = validOrders[0];
  const table = firstOrder.table ? String(firstOrder.table) : 'N/A';
  const location = firstOrder.location ? String(firstOrder.location) : '';
  const checkoutSessionId = firstOrder.checkoutSessionId ? String(firstOrder.checkoutSessionId) : '';

  // Safe receipt number: use the checkoutSessionId or the last 6 chars of the session reference
  const receiptNumber = checkoutSessionId
    ? `REC-${checkoutSessionId.substring(Math.max(0, checkoutSessionId.length - 8)).toUpperCase()}`
    : `REC-${firstOrder._id.toString().substring(Math.max(0, firstOrder._id.toString().length - 8)).toUpperCase()}`;

  return {
    receiptNumber,
    generatedAt: new Date().toISOString(),
    tableName: table,
    locationName: location,
    orders: normalizedOrders,
    foodSubtotal: totalSubtotal,
    convenienceFee: totalFee,
    totalPaid: totalPaid,
    paymentMethods: Array.from(new Set(normalizedOrders.map(o => o.paymentType))),
    paymentStatus: 'PAID'
  };
}

export function generateReceiptHtml(receiptData, restaurantName = 'Aurum Table') {
  if (!receiptData) return '';

  const escRestName = escapeHtml(restaurantName);
  const escReceiptNum = escapeHtml(receiptData.receiptNumber);
  const escGeneratedAt = escapeHtml(new Date(receiptData.generatedAt).toLocaleString());
  const escTable = escapeHtml(receiptData.tableName);
  const escLocation = escapeHtml(receiptData.locationName);
  const escPaymentMethods = escapeHtml(receiptData.paymentMethods.join(', '));

  let ordersHtml = '';
  receiptData.orders.forEach(order => {
    let itemsHtml = '';
    order.items.forEach(item => {
      itemsHtml += `
        <div class="item-row">
          <span class="item-name">${escapeHtml(item.quantity)}x ${escapeHtml(item.name)}</span>
          <span class="item-price">₹${item.lineTotal.toFixed(2)}</span>
        </div>
      `;
    });

    const orderTime = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const feeRow = order.convenienceFee > 0 
      ? `<div class="sub-breakdown"><span>Convenience Fee</span><span>₹${order.convenienceFee.toFixed(2)}</span></div>`
      : '';

    ordersHtml += `
      <div class="order-section">
        <div class="order-header">
          <span>Order #${escapeHtml(order.shortId)}</span>
          <span>${escapeHtml(orderTime)}</span>
        </div>
        <div class="order-items">
          ${itemsHtml}
        </div>
        <div class="order-footer">
          <div class="sub-breakdown"><span>Food Subtotal</span><span>₹${order.subtotal.toFixed(2)}</span></div>
          ${feeRow}
          <div class="sub-breakdown total"><span>Order Total</span><span>₹${order.total.toFixed(2)}</span></div>
        </div>
      </div>
    `;
  });

  const summaryFeeRow = receiptData.convenienceFee > 0
    ? `
      <div class="summary-row">
        <span>Convenience Fee</span>
        <span>₹${receiptData.convenienceFee.toFixed(2)}</span>
      </div>
    `
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Receipt ${escReceiptNum}</title>
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
    .header {
      text-align: center;
      margin-bottom: 24px;
      border-bottom: 2px dashed #e5e2db;
      padding-bottom: 16px;
    }
    .brand {
      color: #8b6914;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0 0 4px 0;
    }
    .subtitle {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #7d4639;
      margin: 0 0 12px 0;
      font-weight: 600;
    }
    .title-banner {
      background-color: #f1ebd9;
      color: #8b6914;
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 6px 12px;
      border-radius: 9999px;
      display: inline-block;
      margin-bottom: 8px;
    }
    .info-section {
      font-size: 12px;
      margin-bottom: 20px;
      color: #4d4639;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .info-row span:first-child {
      font-weight: 600;
    }
    .order-section {
      border-top: 1px solid #f0ece4;
      padding: 16px 0;
    }
    .order-header {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      font-weight: 700;
      color: #8b6914;
      margin-bottom: 8px;
    }
    .item-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      margin-bottom: 6px;
    }
    .item-name {
      color: #1c1b1b;
    }
    .item-price {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .order-footer {
      border-top: 1px dashed #e5e2db;
      margin-top: 8px;
      padding-top: 8px;
    }
    .sub-breakdown {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #7d7057;
      margin-bottom: 2px;
    }
    .sub-breakdown.total {
      font-size: 12px;
      font-weight: 600;
      color: #1c1b1b;
      margin-top: 4px;
    }
    .summary-section {
      border-top: 2px solid #1c1b1b;
      padding-top: 16px;
      margin-top: 8px;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      color: #4d4639;
      margin-bottom: 4px;
    }
    .summary-row.grand-total {
      font-size: 16px;
      font-weight: 700;
      color: #8b6914;
      border-top: 1px solid #1c1b1b;
      padding-top: 8px;
      margin-top: 8px;
    }
    .footer {
      text-align: center;
      margin-top: 24px;
      font-size: 11px;
      color: #7d7057;
      border-top: 1px solid #e5e2db;
      padding-top: 16px;
    }
    .footer p {
      margin: 4px 0;
    }
    .print-button-container {
      margin-bottom: 16px;
      width: 100%;
      max-width: 400px;
      display: flex;
      justify-content: center;
    }
    .print-button {
      background-color: #8b6914;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(139, 105, 20, 0.3);
      transition: background-color 0.2s;
    }
    .print-button:hover {
      background-color: #705410;
    }
    @media print {
      body {
        background-color: #ffffff;
        padding: 0;
      }
      .receipt-container {
        border: none;
        box-shadow: none;
        padding: 0;
        max-width: 100%;
      }
      .print-button-container {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="print-button-container">
    <button class="print-button" onclick="window.print()">Print / Save as PDF</button>
  </div>

  <div class="receipt-container">
    <div class="header">
      <h1 class="brand">${escRestName}</h1>
      <p class="subtitle">Digital Concierge</p>
      <div class="title-banner">Payment Receipt</div>
    </div>

    <div class="info-section">
      <div class="info-row">
        <span>Receipt No:</span>
        <span>${escReceiptNum}</span>
      </div>
      <div class="info-row">
        <span>Date:</span>
        <span>${escGeneratedAt}</span>
      </div>
      <div class="info-row">
        <span>Table:</span>
        <span>${escTable}</span>
      </div>
      ${escLocation ? `<div class="info-row"><span>Location:</span><span>${escLocation}</span></div>` : ''}
      <div class="info-row">
        <span>Payment Method:</span>
        <span style="text-transform: uppercase;">${escPaymentMethods}</span>
      </div>
    </div>

    ${ordersHtml}

    <div class="summary-section">
      <div class="summary-row">
        <span>Food Subtotal</span>
        <span>₹${receiptData.foodSubtotal.toFixed(2)}</span>
      </div>
      ${summaryFeeRow}
      <div class="summary-row grand-total">
        <span>Total Paid</span>
        <span>₹${receiptData.totalPaid.toFixed(2)}</span>
      </div>
    </div>

    <div class="footer">
      <p style="font-weight: 700; color: #8b6914;">✓ Payment Received Successfully</p>
      <p>Thank you for dining with us!</p>
      <p style="font-size: 9px; margin-top: 8px; color: #a09785;">Generated at ${escGeneratedAt}</p>
    </div>
  </div>
</body>
</html>`;
}
