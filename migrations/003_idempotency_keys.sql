CREATE TABLE idempotency_keys (
    operation TEXT NOT NULL,
    idempotency_key TEXT NOT NULL
        CHECK (length(idempotency_key) BETWEEN 1 AND 255),
    request_hash CHAR(64) NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'completed')),
    response_status INTEGER,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (operation, idempotency_key),
    CHECK (
        (status = 'processing' AND response_status IS NULL AND response_body IS NULL)
        OR
        (status = 'completed' AND response_status BETWEEN 100 AND 599 AND response_body IS NOT NULL)
    )
);
