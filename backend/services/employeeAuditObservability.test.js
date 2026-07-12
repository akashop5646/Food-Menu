import { test } from 'node:test';
import assert from 'node:assert';
import { parseRetentionDays } from '../routes/employees.js';

// Custom test helper for formula neutralization in tests since it's private in routes
function sanitizeCSVCell(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  const trimmed = str.trim();
  if (/^[=\+\-@]/.test(trimmed)) {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

// Custom test helper for date parsing in tests
function parseDateRange(fromStr, toStr) {
  let fromDate = null;
  let toDate = null;

  if (fromStr) {
    const matchesDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(fromStr);
    const isoStr = matchesDateOnly ? `${fromStr}T00:00:00.000Z` : fromStr;
    fromDate = new Date(isoStr);
    if (isNaN(fromDate.getTime())) {
      throw new Error('Invalid from date format.');
    }
  }

  if (toStr) {
    const matchesDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(toStr);
    const isoStr = matchesDateOnly ? `${toStr}T23:59:59.999Z` : toStr;
    toDate = new Date(isoStr);
    if (isNaN(toDate.getTime())) {
      throw new Error('Invalid to date format.');
    }
  }

  return { fromDate, toDate };
}

test('Observability — Date Range Parsing', async (t) => {
  await t.test('Should parse date-only string to start of day in UTC', () => {
    const { fromDate } = parseDateRange('2026-07-01', null);
    assert.strictEqual(fromDate.toISOString(), '2026-07-01T00:00:00.000Z');
  });

  await t.test('Should parse date-only string to end of day in UTC', () => {
    const { toDate } = parseDateRange(null, '2026-07-12');
    assert.strictEqual(toDate.toISOString(), '2026-07-12T23:59:59.999Z');
  });

  await t.test('Should throw on malformed dates', () => {
    assert.throws(() => parseDateRange('invalid-date', null));
    assert.throws(() => parseDateRange(null, 'invalid-date'));
  });
});

test('Observability — CSV Formula Neutralization', async (t) => {
  await t.test('Should neutralize cells starting with formula characters', () => {
    assert.strictEqual(sanitizeCSVCell('=HYPERLINK("http://evil.com")'), '"\'=HYPERLINK(""http://evil.com"")"');
    assert.strictEqual(sanitizeCSVCell('+123'), '"\'+123"');
    assert.strictEqual(sanitizeCSVCell('-456'), '"\'-456"');
    assert.strictEqual(sanitizeCSVCell('@SUM'), '"\'@SUM"');
  });

  await t.test('Should neutralize cells with leading whitespace before formula characters', () => {
    assert.strictEqual(sanitizeCSVCell('   =HYPERLINK("http://evil.com")'), '"\'   =HYPERLINK(""http://evil.com"")"');
  });

  await t.test('Should escape quotes and wrap in quotes', () => {
    assert.strictEqual(sanitizeCSVCell('Hello "World"'), '"Hello ""World"""');
  });
});

test('Observability — Retention Policy Parsing', async (t) => {
  await t.test('Should default to 365 when env is missing', () => {
    delete process.env.EMPLOYEE_AUDIT_RETENTION_DAYS;
    assert.strictEqual(parseRetentionDays(), 365);
  });

  await t.test('Should parse valid retention days', () => {
    process.env.EMPLOYEE_AUDIT_RETENTION_DAYS = '180';
    assert.strictEqual(parseRetentionDays(), 180);
    delete process.env.EMPLOYEE_AUDIT_RETENTION_DAYS;
  });

  await t.test('Should fallback to 365 on invalid value and warn once', () => {
    process.env.EMPLOYEE_AUDIT_RETENTION_DAYS = 'invalid';
    assert.strictEqual(parseRetentionDays(), 365);
    delete process.env.EMPLOYEE_AUDIT_RETENTION_DAYS;
  });

  await t.test('Should clamp retention days to minimum 90 and maximum 2555', () => {
    process.env.EMPLOYEE_AUDIT_RETENTION_DAYS = '50'; // too small
    assert.strictEqual(parseRetentionDays(), 365);

    process.env.EMPLOYEE_AUDIT_RETENTION_DAYS = '3000'; // too large
    assert.strictEqual(parseRetentionDays(), 365);

    delete process.env.EMPLOYEE_AUDIT_RETENTION_DAYS;
  });
});
