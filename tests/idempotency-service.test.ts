import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    type RecordValue = {
        request_hash: string;
        status: 'processing' | 'completed';
        response_status: number | null;
        response_body: unknown;
    };

    const records = new Map<string, RecordValue>();
    const recordKey = (operation: string, key: string) => `${operation}:${key}`;
    const createClient = () => {
        let claimedKey: string | null = null;
        return {
            query: vi.fn(async (sql: string, parameters: unknown[] = []) => {
                if (sql.includes('INSERT INTO idempotency_keys')) {
                    const [operation, key, requestHash] = parameters as string[];
                    const id = recordKey(operation, key);
                    if (records.has(id)) {
                        return { rowCount: 0, rows: [] };
                    }
                    records.set(id, {
                        request_hash: requestHash,
                        status: 'processing',
                        response_status: null,
                        response_body: null,
                    });
                    claimedKey = id;
                    return { rowCount: 1, rows: [] };
                }

                if (sql.includes('SELECT request_hash, status')) {
                    const [operation, key] = parameters as string[];
                    const record = records.get(recordKey(operation, key));
                    return { rowCount: record ? 1 : 0, rows: record ? [record] : [] };
                }

                if (sql.includes('UPDATE idempotency_keys')) {
                    const [operation, key, responseStatus, serializedBody] =
                        parameters as [string, string, number, string];
                    const record = records.get(recordKey(operation, key));
                    if (!record || record.status !== 'processing') {
                        return { rowCount: 0, rows: [] };
                    }
                    record.status = 'completed';
                    record.response_status = responseStatus;
                    record.response_body = JSON.parse(serializedBody);
                    return { rowCount: 1, rows: [] };
                }

                if (sql === 'ROLLBACK' && claimedKey) {
                    records.delete(claimedKey);
                    claimedKey = null;
                }
                if (sql === 'COMMIT') {
                    claimedKey = null;
                }
                return { rowCount: null, rows: [] };
            }),
            release: vi.fn(),
        };
    };

    return {
        records,
        createClient,
        connect: vi.fn(async () => createClient()),
    };
});

vi.mock('../src/db', () => ({
    pool: {
        connect: mocks.connect,
    },
}));

import {
    executeIdempotently,
    IdempotencyConflictError,
} from '../src/services/idempotency-service';

describe('executeIdempotently', () => {
    beforeEach(() => {
        mocks.records.clear();
    });

    it('replays the original response without executing the action again', async () => {
        const action = vi.fn(async () => ({
            statusCode: 201,
            body: { purchaseId: 'purchase-1' },
        }));

        const first = await executeIdempotently(
            'purchase.create',
            'key-1',
            { customerId: 'customer-1' },
            action,
        );
        const replay = await executeIdempotently(
            'purchase.create',
            'key-1',
            { customerId: 'customer-1' },
            action,
        );

        expect(first).toEqual(replay);
        expect(action).toHaveBeenCalledTimes(1);
    });

    it('rejects reusing a key with a different request', async () => {
        await executeIdempotently(
            'purchase.create',
            'key-2',
            { customerId: 'customer-1' },
            async () => ({ statusCode: 201, body: { purchaseId: 'purchase-2' } }),
        );

        await expect(
            executeIdempotently(
                'purchase.create',
                'key-2',
                { customerId: 'customer-2' },
                async () => ({ statusCode: 201, body: { purchaseId: 'purchase-3' } }),
            ),
        ).rejects.toBeInstanceOf(IdempotencyConflictError);
    });

    it('rolls back the key when the operation fails', async () => {
        await expect(
            executeIdempotently(
                'purchase.create',
                'key-failure',
                { customerId: 'customer-1' },
                async () => {
                    throw new Error('operation failed');
                },
            ),
        ).rejects.toThrow('operation failed');

        expect(mocks.records.has('purchase.create:key-failure')).toBe(false);
    });

    it('rejects a duplicate while the first request is processing', async () => {
        let completeAction: (response: { statusCode: number; body: unknown }) => void =
            () => {
                throw new Error('Action has not started');
            };
        const firstRequest = executeIdempotently(
            'purchase.create',
            'key-3',
            { customerId: 'customer-1' },
            () => new Promise((resolve) => {
                completeAction = resolve;
            }),
        );

        await vi.waitFor(() => {
            expect(mocks.records.has('purchase.create:key-3')).toBe(true);
        });

        await expect(
            executeIdempotently(
                'purchase.create',
                'key-3',
                { customerId: 'customer-1' },
                async () => ({ statusCode: 201, body: { purchaseId: 'duplicate' } }),
            ),
        ).rejects.toBeInstanceOf(IdempotencyConflictError);

        completeAction({ statusCode: 201, body: { purchaseId: 'purchase-3' } });
        await expect(firstRequest).resolves.toEqual({
            statusCode: 201,
            body: { purchaseId: 'purchase-3' },
        });
    });
});
