import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDraftRecipients, validateDraftForActivation } from './settings.js';
import { buildSettlementSnapshot } from '../services/settlement.js';

test('Draft with zero Restaurant Owners can be saved', () => {
  const recipients = [
    { id: '1', label: 'Partner A', linkedAccountId: 'acc_1111', allocationBasisPoints: 4000, enabled: true, recipientType: 'OTHER' }
  ];
  const draft = validateDraftRecipients(recipients);
  assert.ok(draft);
  assert.strictEqual(draft.recipients[0].recipientType, 'OTHER');
});

test('Draft with one Restaurant Owner can be saved', () => {
  const recipients = [
    { id: '1', label: 'Owner Recipient', linkedAccountId: 'acc_1111', allocationBasisPoints: 4000, enabled: true, recipientType: 'RESTAURANT_OWNER' }
  ];
  const draft = validateDraftRecipients(recipients);
  assert.ok(draft);
  assert.strictEqual(draft.recipients[0].recipientType, 'RESTAURANT_OWNER');
});

test('More than one enabled Restaurant Owner is rejected', () => {
  const recipients = [
    { id: '1', label: 'Owner A', linkedAccountId: 'acc_1111', allocationBasisPoints: 4000, enabled: true, recipientType: 'RESTAURANT_OWNER' },
    { id: '2', label: 'Owner B', linkedAccountId: 'acc_2222', allocationBasisPoints: 3000, enabled: true, recipientType: 'RESTAURANT_OWNER' }
  ];
  assert.throws(() => {
    validateDraftRecipients(recipients);
  }, /Only one enabled settlement recipient can be designated as the Restaurant Owner/);
});

test('Activation without a Restaurant Owner fails activation', () => {
  const draft = {
    recipients: [
      { id: '1', label: 'Partner A', linkedAccountId: 'acc_1111', allocationBasisPoints: 4000, enabled: true, recipientType: 'OTHER' }
    ]
  };
  assert.throws(() => {
    validateDraftForActivation(draft);
  }, /Select one enabled recipient as the Restaurant Owner before activating the configuration/);
});

test('Activation with exactly one enabled Restaurant Owner succeeds', () => {
  const draft = {
    recipients: [
      { id: '1', label: 'Owner', linkedAccountId: 'acc_1111', allocationBasisPoints: 4000, enabled: true, recipientType: 'RESTAURANT_OWNER' }
    ]
  };
  const active = validateDraftForActivation(draft);
  assert.ok(active);
  assert.strictEqual(active.recipients[0].recipientType, 'RESTAURANT_OWNER');
});

test('Disabled Restaurant Owner does not count as the active owner for activation', () => {
  const draft = {
    recipients: [
      { id: '1', label: 'Owner', linkedAccountId: 'acc_1111', allocationBasisPoints: 4000, enabled: false, recipientType: 'RESTAURANT_OWNER' },
      { id: '2', label: 'Partner A', linkedAccountId: 'acc_2222', allocationBasisPoints: 3000, enabled: true, recipientType: 'OTHER' }
    ]
  };
  assert.throws(() => {
    validateDraftForActivation(draft);
  }, /Select one enabled recipient as the Restaurant Owner before activating the configuration/);
});

test('Unsupported recipient types are rejected', () => {
  const recipients = [
    { id: '1', label: 'Owner', linkedAccountId: 'acc_1111', allocationBasisPoints: 4000, enabled: true, recipientType: 'INVALID_TYPE' }
  ];
  assert.throws(() => {
    validateDraftRecipients(recipients);
  }, /Invalid recipient type/);
});

test('New settlement snapshots preserve recipientType = RESTAURANT_OWNER', () => {
  const order = {
    total: '100.00',
    razorpayPaymentId: 'pay_test_123',
    paymentStatus: 'PAID',
    paymentType: 'RAZORPAY'
  };
  const configuration = {
    version: 3,
    recipients: [
      { id: '1', label: 'Owner', linkedAccountId: 'acc_1111', allocationBasisPoints: 6000, enabled: true, recipientType: 'RESTAURANT_OWNER' },
      { id: '2', label: 'Partner A', linkedAccountId: 'acc_2222', allocationBasisPoints: 3000, enabled: true, recipientType: 'OTHER' }
    ]
  };
  const snapshot = buildSettlementSnapshot(order, configuration);
  assert.ok(snapshot);
  const ownerRecipient = snapshot.recipients.find(r => r.recipientId === '1');
  const otherRecipient = snapshot.recipients.find(r => r.recipientId === '2');
  assert.strictEqual(ownerRecipient.recipientType, 'RESTAURANT_OWNER');
  assert.strictEqual(otherRecipient.recipientType, 'OTHER');
});
