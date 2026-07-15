/**
 * Calculate the settlement breakdown for a single order.
 * If the order is not paid or doesn't have splitSettlement, returns zeros/nulls gracefully.
 */
export function getOrderSettlementBreakdown(order) {
  const isPaid = order?.paymentStatus === 'PAID';
  const foodSubtotal = parseFloat(order?.total) || 0;
  const convenienceFee = parseFloat(order?.convenienceFee) || 0;

  if (!isPaid || !order?.splitSettlement) {
    return {
      isEligible: false,
      foodSubtotal: isPaid ? foodSubtotal : 0,
      convenienceFee: isPaid ? convenienceFee : 0,
      ownerAllocated: 0,
      ownerTransferred: 0,
      platformRetained: 0,
      otherAllocated: 0,
    };
  }

  const ss = order.splitSettlement;
  const platformRetained = (ss.platformRetainedAmountPaise || 0) / 100;
  
  let ownerAllocated = 0;
  let ownerTransferred = 0;
  let otherAllocated = 0;

  const recipients = ss.recipients || [];
  recipients.forEach((recipient) => {
    const amt = (recipient.amountPaise || 0) / 100;
    if (recipient.recipientType === 'RESTAURANT_OWNER') {
      ownerAllocated += amt;
      if (recipient.status === 'PROCESSED') {
        ownerTransferred += amt;
      }
    } else {
      otherAllocated += amt;
    }
  });

  return {
    isEligible: true,
    foodSubtotal,
    convenienceFee,
    ownerAllocated,
    ownerTransferred,
    platformRetained,
    otherAllocated,
  };
}

/**
 * Calculate the aggregated settlement summary for a list of orders.
 */
export function calculateSettlementSummary(orders) {
  let foodSubtotalTotal = 0;
  let convenienceFeeTotal = 0;
  let ownerAllocatedTotal = 0;
  let ownerTransferredTotal = 0;
  let platformRetainedTotal = 0;
  let otherExternalTotal = 0;

  if (Array.isArray(orders)) {
    orders.forEach((order) => {
      if (order?.paymentStatus === 'PAID') {
        const breakdown = getOrderSettlementBreakdown(order);
        foodSubtotalTotal += breakdown.foodSubtotal;
        convenienceFeeTotal += breakdown.convenienceFee;
        ownerAllocatedTotal += breakdown.ownerAllocated;
        ownerTransferredTotal += breakdown.ownerTransferred;
        platformRetainedTotal += breakdown.platformRetained;
        otherExternalTotal += breakdown.otherAllocated;
      }
    });
  }

  return {
    foodSubtotalTotal,
    convenienceFeeTotal,
    ownerAllocatedTotal,
    ownerTransferredTotal,
    platformRetainedTotal,
    otherExternalTotal,
  };
}
