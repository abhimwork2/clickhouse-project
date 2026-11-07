import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db';

export interface IdempotentResponse {
    statusCode: number;
    body: unknown;
}

interface IdempotencyRecord {
    request_hash: string;
    status: 'processing' | 'completed';
    response_status: number | null;
    response_body: unknown;
}

export class IdempotencyConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'IdempotencyConflictError';
    }
}

export const normalizeIdempotencyKey = (
    header: string | string[] | undefined,
): string | null => {
    if (typeof header !== 'string') {
        return null;
    }

    const key = header.trim();
    return key.length > 0 && key.length <= 255 ? key : null;
};

export const executeIdempotently = async <TResponse extends IdempotentResponse>(
    operation: string,
    key: string,
    request: unknown,
    action: (client: PoolClient) => Promise<TResponse>,
): Promise<TResponse> => {
    const serializedRequest = JSON.stringify(request);
    if (serializedRequest === undefined) {
        throw new Error('Idempotent request must be JSON serializable');
    }
    const requestHash = createHash('sha256').update(serializedRequest).digest('hex');

    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const inserted = await client.query(
            `INSERT INTO idempotency_keys (operation, idempotency_key, request_hash)
             VALUES ($1, $2, $3)
             ON CONFLICT (operation, idempotency_key) DO NOTHING`,
            [operation, key, requestHash],
        );

        if (inserted.rowCount === 1) {
            const response = await action(client);
            const serializedBody = JSON.stringify(response.body);
            if (serializedBody === undefined) {
                throw new Error('Idempotent response must be JSON serializable');
            }

            const completed = await client.query(
                `UPDATE idempotency_keys
                 SET status = 'completed',
                     response_status = $3,
                     response_body = $4::jsonb,
                     updated_at = NOW()
                 WHERE operation = $1
                   AND idempotency_key = $2
                   AND status = 'processing'`,
                [operation, key, response.statusCode, serializedBody],
            );

            if (completed.rowCount !== 1) {
                throw new Error('Failed to save idempotent response');
            }

            await client.query('COMMIT');
            return response;
        } else {
            const existingResult = await client.query<IdempotencyRecord>(
                `SELECT request_hash, status, response_status, response_body
                 FROM idempotency_keys
                 WHERE operation = $1 AND idempotency_key = $2
                 FOR UPDATE`,
                [operation, key],
            );
            const existing = existingResult.rows[0];

            if (!existing) {
                throw new Error('Idempotency record disappeared during lookup');
            }
            if (existing.request_hash.trim() !== requestHash) {
                throw new IdempotencyConflictError(
                    'Idempotency-Key was already used with a different request',
                );
            }
            if (existing.status === 'processing') {
                throw new IdempotencyConflictError(
                    'A request with this Idempotency-Key is still processing',
                );
            }
            if (existing.response_status === null || existing.response_body === null) {
                throw new Error('Completed idempotency record has no response');
            }

            await client.query('COMMIT');
            return {
                statusCode: existing.response_status,
                body: existing.response_body,
            } as TResponse;
        }
    } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
