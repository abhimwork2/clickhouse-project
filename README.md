# E-Commerce Billing API

An e-commerce billing service built with TypeScript, Fastify, and PostgreSQL.

The service manages customer credit, product purchases, shipment creation, purchase history, and refunds. Customer and product data are retrieved through external APIs, which are mocked for now.

## Getting Started

**Prerequisites:** Node.js, npm, and Docker Desktop.

1. Install dependencies:

```bash
npm install
```

2. Create a local environment file by copying `.env.example` to `.env`.

3. Start PostgreSQL:

```bash
docker compose up -d
```

4. Apply the migrations in order:

```powershell
Get-Content migrations/001_initial_schema.sql -Raw | docker exec -i billing-postgres psql -U billing_app -d billing

Get-Content migrations/002_credit_holds.sql -Raw | docker exec -i billing-postgres psql -U billing_app -d billing
```

5. Build and start the application:

```bash
npm run build
npm start
```

The API runs on `http://localhost:3000` by default.

Check the application and database connection:

```http
GET /health
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/customers/:customerId/credit` | Get credit balance |
| POST | `/customers/:customerId/credit/grant` | Grant credit |
| POST | `/customers/:customerId/credit/deduct` | Deduct credit |
| POST | `/purchases` | Create a purchase |
| GET | `/customers/:customerId/purchases` | List purchase history |
| POST | `/purchases/:purchaseId/refunds` | Process a full or partial refund |

Credit adjustments and refunds accept amounts in cents. Example:

```json
{
  "amountCents": 50000,
  "reason": "Promotional credit"
}
```

A purchase request looks like:

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

- **Money:** Values are stored as integer cents to avoid floating-point precision issues.
- **Credit ledger:** Every credit movement is recorded with its amount, reason, reference, and timestamp. The current balance is maintained separately for efficient lookups.
- **Credit holds:** Credit is reserved when a purchase is created. Available credit is calculated as `balance_cents - held_cents`. This prevents the same credit from being used by multiple pending purchases.
- **Refunds:** Both partial and full refunds are supported. Existing refunds are checked before another refund is accepted.

## Purchase and Shipment Handling

The purchase is saved and credit is reserved before calling the Shipment API.

- On successful shipment creation, the reserved credit is captured and the purchase is marked completed.
- On shipment failure, the reservation is released and the purchase is marked as failed.

Shipment failures can be simulated by setting `SIMULATE_SHIPMENT_FAILURE=true` in `.env`.

## Database Tables

- `credit_accounts` – current and held customer credit.
- `credit_ledger` – history of credit movements.
- `purchases` – purchase records and shipment status.
- `purchase_items` – product snapshots at purchase time.
- `refunds` – refund records.

Database changes are managed through versioned SQL migrations.

## Running Tests

Run the automated tests: npm test and npm run build

## Production Improvements
For production, I would introduce a transactional outbox with background retries, idempotency keys for purchase and refund requests, and reconciliation for shipment failures. We would replace the mocks with actual API clients and add authentication, authorization, and integration tests.
