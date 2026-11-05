CREATE TABLE credit_accounts (
    customer_id UUID PRIMARY KEY,
    balance_cents BIGINT NOT NULL DEFAULT 0
        CHECK (balance_cents >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES credit_accounts(customer_id),
    amount_cents BIGINT NOT NULL CHECK (amount_cents <> 0),
    entry_type TEXT NOT NULL CHECK (
        entry_type IN (
            'grant',
            'deduction',
            'purchase_debit',
            'refund_credit',
            'shipment_compensation'
        )
    ),
    reason TEXT NOT NULL,
    reference_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credit_ledger_customer
    ON credit_ledger(customer_id, created_at);

CREATE TABLE purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES credit_accounts(customer_id),
    total_cents BIGINT NOT NULL CHECK (total_cents > 0),
    status TEXT NOT NULL CHECK (
        status IN (
            'pending_shipment',
            'completed',
            'shipment_failed',
            'partially_refunded',
            'refunded'
        )
    ),
    shipment_id TEXT,
    shipping_address JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_purchases_customer
    ON purchases(customer_id, created_at);

CREATE TABLE purchase_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID NOT NULL REFERENCES purchases(id),
    product_id UUID NOT NULL,
    sku TEXT NOT NULL,
    product_name TEXT NOT NULL,
    unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    line_total_cents BIGINT NOT NULL CHECK (line_total_cents > 0)
);

CREATE INDEX idx_purchase_items_purchase
    ON purchase_items(purchase_id);

CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID NOT NULL REFERENCES purchases(id),
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refunds_purchase
    ON refunds(purchase_id);