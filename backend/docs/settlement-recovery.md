# Settlement Recovery Scheduler Operations

This document defines the operation, security model, scheduling configuration, and troubleshooting procedures for the Route settlement recovery worker.

---

## Purpose
The recovery worker reconciles Route transfer records in the database with Razorpay when webhook notifications are missed, delayed, or temporarily failed. It operates on an optimistic concurrency revision model to safely resolve pending and processing payouts without duplicate payments.

## Endpoint & Security
* **Endpoint**: `POST /api/internal/settlements/recover`
* **Protocol**: HTTPS only (production).
* **Authentication**: Fail-closed server-to-server Bearer Authorization.
* **Environment Variable**: `SETTLEMENT_RECOVERY_SECRET`

The endpoint returns only aggregate counts and **never** exposes customer details, order IDs, transfer IDs, payment IDs, or provider stack traces.

---

## Scheduler Configuration

### Recommended Schedule
`*/10 * * * *` (Every 10 minutes)

### Execution Command
The scheduler must execute the following HTTP POST command, referencing the secure server-side environment variable:

```bash
curl --fail --silent --show-error \
  --request POST \
  --header "Authorization: Bearer \${SETTLEMENT_RECOVERY_SECRET}" \
  --header "Content-Type: application/json" \
  "https://food-menu-k1yv.onrender.com/api/internal/settlements/recover"
```

---

## Render Cron Integration

### Operational Limitation
> [!WARNING]
> **Render Cron Jobs are a paid-only feature** (minimum charge of $1 USD/month).

### Setup Steps
1. Navigate to your **Render Dashboard**.
2. Click **New +** and select **Cron Job**.
3. Configure the following fields:
   * **Name**: `settlement-recovery-worker`
   * **Schedule**: `*/10 * * * *`
   * **Command**: Enter the `curl` execution command shown above.
4. Under **Environment**, add the environment variable:
   * **Key**: `SETTLEMENT_RECOVERY_SECRET`
   * **Value**: *(The same cryptographically strong hex secret configured on your Web Service)*
5. Click **Create Cron Job**.

*Note: If you run your application on Render's free Web Service tier and do not wish to upgrade, you can configure an external scheduler (e.g. GitHub Actions or a free third-party cron service) to invoke the webhook endpoint securely.*

---

## Response Schema Interpretation
```json
{
  "matched": 2,
  "processed": 1,
  "deferred": 1,
  "failed": 0
}
```
* **matched**: Total count of eligible paid orders with unresolved settlements (capped at 20 per batch).
* **processed**: Settlements successfully reconciled to a terminal state (`PROCESSED`, `PARTIALLY_PROCESSED`, or `SKIPPED`).
* **deferred**: Settlements skipped because they are under an active worker lease or temporary network lookup failure.
* **failed**: Settlements that encountered an processing error during reconciliation.

---

## Safety Guidelines (What NOT to do)
* **Do not call from the frontend**: Never expose the `SETTLEMENT_RECOVERY_SECRET` or call the recovery endpoint from any client-side code.
* **Do not manually clear transfer IDs**: Clearing a `transferId` in MongoDB makes the recipient eligible for new transfer creation, risking duplicate payments.
* **Do not manually execute transfers**: Never initiate duplicate Route transfers on the Razorpay Dashboard for an order.
* **Do not retry ambiguous states**: If a transfer state is ambiguous, let the recovery worker safely defer it under lease lock.
