import { API_BASE } from '../../config';

/**
 * Safely parses the API response as JSON if possible, otherwise throws a generic error.
 */
async function handleResponse(response) {
  const contentType = response.headers.get('content-type');
  let data = null;

  if (contentType && contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch (e) {
      // JSON parse error
    }
  } else {
    try {
      const text = await response.text();
      // If proxy/server returned HTML error, do not expose it
      if (text && (text.includes('<html') || text.includes('<!DOCTYPE'))) {
        throw new Error('The service is temporarily unavailable.');
      }
      if (text) {
        throw new Error(text);
      }
    } catch (e) {
      if (e.message && e.message.includes('temporarily unavailable')) {
        throw e;
      }
    }
  }

  if (!response.ok) {
    const errorMsg = (data && data.error) || `Request failed with status ${response.status}`;
    throw new Error(errorMsg);
  }

  return data;
}

/**
 * Verify order 4-digit code
 */
export async function verifyCode(code, signal) {
  try {
    const res = await fetch(`${API_BASE}/api/orders/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      credentials: 'include',
      signal
    });
    return await handleResponse(res);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw err;
    }
    throw new Error(err.message || 'Failed to verify code. Please try again.');
  }
}

/**
 * Fetch tables and locations catalog
 */
export async function loadCatalog(signal) {
  try {
    const [tablesRes, locationsRes] = await Promise.all([
      fetch(`${API_BASE}/api/tables`, { signal }),
      fetch(`${API_BASE}/api/locations`, { signal })
    ]);

    if (!tablesRes.ok || !locationsRes.ok) {
      throw new Error('Catalog service temporarily unavailable.');
    }

    const tablesData = await tablesRes.json();
    const locationsData = await locationsRes.json();

    const normalizedTables = Array.isArray(tablesData) ? tablesData : (tablesData.tables || []);
    const normalizedLocations = Array.isArray(locationsData) ? locationsData : [];

    return {
      tables: normalizedTables,
      locations: normalizedLocations
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw err;
    }
    throw new Error(err.message || 'Could not load table data.');
  }
}

/**
 * Search menu items with AbortController support
 */
export async function fetchFilteredMenu(searchQuery, signal) {
  try {
    const res = await fetch(
      `${API_BASE}/api/menu?limit=6&search=${encodeURIComponent(searchQuery || '')}`,
      { signal }
    );
    return await handleResponse(res);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw err;
    }
    throw new Error(err.message || 'Failed to load menu items.');
  }
}

/**
 * Submit manual/code order with idempotency header
 */
export async function submitOrder({
  tableName,
  locationName,
  tableId,
  locationId,
  items,
  total,
  paymentType,
  paymentStatus,
  source,
  id,
  deviceId,
  customerIp,
  checkoutSessionId,
  idempotencyKey
}) {
  const headers = { 'Content-Type': 'application/json' };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  try {
    const res = await fetch(`${API_BASE}/api/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        table: tableName,
        location: locationName || null,
        tableId: tableId || null,
        locationId: locationId || null,
        items,
        total,
        paymentType,
        paymentStatus,
        source,
        _id: id || null,
        deviceId: deviceId || null,
        customerIp: customerIp || null,
        checkoutSessionId: checkoutSessionId || null,
      }),
      credentials: 'include'
    });
    return await handleResponse(res);
  } catch (err) {
    throw new Error(err.message || 'The order service is temporarily unavailable.');
  }
}
