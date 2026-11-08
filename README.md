E-Commerce Billing API

An e-commerce billing service built with TypeScript, Fastify, and PostgreSQL. It manages customer credit, product purchases, shipment creation, purchase history, and refunds. Customer, product, and shipment APIs are mocked for this assignment.

## Getting Started

**Prerequisites:** Node.js, npm, and Docker Compose.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env`.

3. Start PostgreSQL:

   ```bash
   docker compose up -d
   ```

4. Apply the migrations in numeric order. PowerShell:

   ```powershell
   Get-Content migrations/001_initial_schema.sql -Raw | docker exec -i billing-postgres psql -U billing_app -d billing
   Get-Content migrations/002_credit_holds.sql -Raw | docker exec -i billing-postgres psql -U billing_app -d billing
   Get-Content migrations/003_idempotency_keys.sql -Raw | docker exec -i billing-postgres psql -U billing_app -d billing
   ```

   macOS/Linux:

   ```bash
   for migration in migrations/00{1,2,3}_*.sql; do
     docker exec -i billing-postgres psql -U billing_app -d billing < "$migration"
   done
   ```

5. Build and start the application:

   ```bash
   npm run build
   npm start
   ```

The API runs at `http://localhost:3000`. Check the application and database connection with `GET /health`.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/customers/:customerId/credit` | Get current, held, and available credit |
| POST | `/customers/:customerId/credit/grant` | Grant credit |
| POST | `/customers/:customerId/credit/deduct` | Deduct available credit |
| POST | `/purchases` | Create a purchase and request shipment |
| GET | `/customers/:customerId/purchases` | List purchase history |
| POST | `/purchases/:purchaseId/refunds` | Process a full or partial refund |

All money-changing POST endpoints require an `Idempotency-Key` header. Use a unique key for each logical request and reuse it when retrying. The same key and request return the original response; reusing a key with a different request returns HTTP 409. Concurrent requests with the same key wait for the first transaction and then replay its response. Keys are scoped by operation and stored with the request hash and response. The idempotency record and database changes commit in one transaction.

Example credit grant body and header:

```http
POST /customers/11111111-1111-4111-8111-111111111111/credit/grant
Idempotency-Key: 8f43d559-2e85-4fc7-a0b9-331c7210e967
Content-Type: application/json

{"amountCents":50000,"reason":"Promotional credit"}
```

Example purchase body:

```json
{
  "customerId": "11111111-1111-4111-8111-111111111111",
  "items": [
    {
      "productId": "22222222-2222-4222-8222-222222222222",
      "quantity": 1
    }
  ]
}
```

## Design Decisions

- **Money:** Amounts are stored as integer cents to avoid floating-point precision issues.
- **Credit ledger:** Every credit movement is recorded with its amount, reason, reference, and timestamp. The current balance is maintained separately for efficient lookups.
- **Credit holds:** Credit is reserved while a purchase awaits shipment. Available credit is `balance_cents - held_cents`, preventing the same credit from being spent by multiple pending purchases.
- **Historical records:** Purchase items keep product name, SKU, unit price, quantity, and line total from purchase time. The shipping address is saved with the purchase so later customer changes do not alter its history.
- **Refunds:** Partial and full refunds are supported. A purchase is locked during refund processing, and total refunds cannot exceed the purchase amount.

## Purchase and Shipment Handling

The purchase, item snapshots, and credit hold are saved before calling the Shipment API.

- On successful shipment creation, the held credit is captured and the purchase is marked `completed` with its shipment ID.
- If shipment creation fails, the hold is released, a ledger entry is added, and the purchase is marked `shipment_failed`.
- The shipment request receives a stable idempotency key derived from the purchase request key. A real shipment provider must honor that key because its external side effect cannot participate in the PostgreSQL transaction.

Set `SIMULATE_SHIPMENT_FAILURE=true` in `.env` to simulate a shipment failure.

## Database Tables

- `credit_accounts` – current and held customer credit.
- `credit_ledger` – append-style history of credit movements.
- `purchases` – purchase records, saved shipping address, and shipment status.
- `purchase_items` – product snapshots at purchase time.
- `refunds` – refund records and reasons.
- `idempotency_keys` – request hashes and stored responses for safe retries.

Database changes are managed through versioned SQL migrations. Apply them once, in numeric order, to a fresh database.

## Running Tests

```bash
npm test
npm run build
```

## Production Improvements

For production, I would move shipment requests to a transactional outbox with background retries and reconciliation. This avoids holding a database transaction open during a network call and provides a durable way to retry shipment delivery. I would replace the mocks with real API clients and add authentication, authorization, and integration tests.

Coding assistance: GitHub Copilot. No separate skill or agent instruction files were used.
