import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateExternalAmounts, buildSettlementSnapshot } from './settlement.js';

const recipients = (allocations) => allocations.map(([id, allocationBasisPoints]) => ({
  id,
  label: id,
  linkedAccountId: `acc_${id}xyz`,
  allocationBasisPoints,
  enabled: true,
}));

test('allocates external Route amounts deterministically and retains the remainder', () => {
  const allocation = allocateExternalAmounts(100100, recipients([['restaurant', 9500], ['partner', 200]]));
  assert.equal(allocation.targetExternalAmountPaise, 97097);
  assert.equal(allocation.platformRetainedAmountPaise, 3003);
  assert.equal(allocation.allocations.reduce((sum, recipient) => sum + recipient.amountPaise, 0), 97097);
  assert.equal(allocation.targetExternalAmountPaise + allocation.platformRetainedAmountPaise, 100100);
});

test('uses stable recipient IDs to break rounding ties', () => {
  const allocation = allocateExternalAmounts(1001, recipients([['b', 3333], ['a', 3333], ['c', 3334]]));
  const amounts = Object.fromEntries(allocation.allocations.map((recipient) => [recipient.id, recipient.amountPaise]));
  assert.deepEqual(amounts, { b: 333, a: 334, c: 334 });
  assert.equal(allocation.targetExternalAmountPaise, 1001);
});

test('snapshots zero-value recipients without creating a transfer candidate', () => {
  const snapshot = buildSettlementSnapshot(
    { total: 1, razorpayPaymentId: 'pay_test' },
    { version: 1, recipients: recipients([['restaurant', 9500], ['partner', 200]]) }
  );
  assert.equal(snapshot.sourceAmountPaise, 100);
  assert.equal(snapshot.externalTransferAmountPaise + snapshot.platformRetainedAmountPaise, 100);
  assert.equal(snapshot.recipients.find((recipient) => recipient.recipientId === 'partner').status, 'SKIPPED_MINIMUM_AMOUNT');
});

test('keeps the active configuration recipient data immutable after snapshot creation', () => {
  const configuration = { version: 4, recipients: recipients([['restaurant', 9500]]) };
  const snapshot = buildSettlementSnapshot({ total: 100, razorpayPaymentId: 'pay_test' }, configuration);
  configuration.recipients[0].label = 'Changed later';
  configuration.recipients[0].linkedAccountId = 'acc_changed';
  assert.equal(snapshot.configurationVersion, 4);
  assert.equal(snapshot.recipients[0].label, 'restaurant');
  assert.equal(snapshot.recipients[0].linkedAccountId, 'acc_restaurantxyz');
});
