ALTER TABLE credit_accounts
ADD COLUMN held_cents BIGINT NOT NULL DEFAULT 0
CHECK (held_cents >= 0);

ALTER TABLE credit_accounts
ADD CONSTRAINT credit_holds_within_balance
CHECK (held_cents <= balance_cents);

ALTER TABLE credit_ledger
DROP CONSTRAINT credit_ledger_entry_type_check;

ALTER TABLE credit_ledger
ADD CONSTRAINT credit_ledger_entry_type_check
CHECK (
    entry_type IN (
        'grant',
        'deduction',
        'purchase_debit',
        'refund_credit',
        'shipment_compensation',
        'hold',
        'capture',
        'release'
    )
);