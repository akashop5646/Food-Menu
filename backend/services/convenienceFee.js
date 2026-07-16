export async function calculateOrderConvenienceFee(db, calculatedTotal) {
  const configs = await db.collection('configs').find({
    key: { $in: ['convenience_fee_enabled', 'convenience_fee_type', 'convenience_fee_percentage', 'convenience_fee_amount'] }
  }).toArray();

  let enabled = false;
  let type = 'PERCENTAGE';
  let percentage = 0;
  let amount = 0;
  let percentageExists = false;
  let amountExists = false;

  configs.forEach(c => {
    if (c.key === 'convenience_fee_enabled') {
      enabled = typeof c.value === 'boolean' ? c.value : c.value === 'true';
    }
    if (c.key === 'convenience_fee_type') {
      type = String(c.value);
    }
    if (c.key === 'convenience_fee_percentage') {
      const val = Number(c.value);
      if (Number.isFinite(val) && val >= 0) {
        percentage = val;
        percentageExists = true;
      }
    }
    if (c.key === 'convenience_fee_amount') {
      const val = Number(c.value);
      if (Number.isFinite(val) && val >= 0) {
        amount = val;
        amountExists = true;
      }
    }
  });

  if (!enabled) {
    return { convenienceFee: 0, percentage: 0, modelVersion: 2 };
  }

  // If percentage config exists, it takes precedence (model version 2)
  if (percentageExists) {
    const fee = Number((calculatedTotal * percentage / 100).toFixed(2));
    return { convenienceFee: fee, percentage, modelVersion: 2 };
  }

  // Fallback to legacy fixed amount (model version 1)
  if (amountExists) {
    return { convenienceFee: amount, percentage: null, modelVersion: 1 };
  }

  // Default fallback
  return { convenienceFee: 0, percentage: 0, modelVersion: 2 };
}
