import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createPurchase: vi.fn(),
    createRefund: vi.fn(),
    getPurchaseHistory: vi.fn(),
    executeIdempotently: vi.fn(async (
        _operation: string,
        _key: string,
        _request: unknown,
        action: (client: { query: () => Promise<{ rowCount: number; rows: unknown[] }> }) =>
            Promise<{ statusCode: number; body: unknown }>,
    ) => action({ query: async () => ({ rowCount: 1, rows: [] }) })),
    normalizeIdempotencyKey: (header: string | string[] | undefined) =>
        typeof header === 'string' && header.trim() ? header.trim() : null,
    IdempotencyConflictError: class extends Error {},
    ShipmentCreationError: class extends Error {},
}));

vi.mock('../src/services/purchase-service', () => mocks);
vi.mock('../src/services/idempotency-service', () => mocks);

import purchaseRoutes from '../src/routes/purchase-routes';

describe('Purchase routes', () => {
    it('rejects an invalid purchase ID with HTTP 400', async () => {
        const app = Fastify();

        await app.register(purchaseRoutes);

        const response = await app.inject({
            method: 'POST',
            url: '/purchases/not-a-valid-uuid/refunds',
            payload: {
                amountCents: 1000,
                reason: 'Test refund',
            },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({
            error: 'Invalid purchase ID',
        });
        expect(mocks.createRefund).not.toHaveBeenCalled();

        await app.close();
    });

    it('returns HTTP 404 when the purchase does not exist', async () => {
        mocks.createRefund.mockRejectedValue(
            new Error('Purchase not found'),
        );

        const app = Fastify();
        await app.register(purchaseRoutes);

        const response = await app.inject({
            method: 'POST',
            url: '/purchases/05cfe3c7-40ee-4ede-8b96-37aadbb36aea/refunds',
            headers: { 'idempotency-key': 'refund-1' },
            payload: {
                amountCents: 1000,
                reason: 'Test refund',
            },
        });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({
            error: 'Purchase not found',
        });

        await app.close();
    });

    it('rejects an invalid refund amount with HTTP 400', async () => {
        const app = Fastify();
        await app.register(purchaseRoutes);

        const response = await app.inject({
            method: 'POST',
            url: '/purchases/05cfe3c7-40ee-4ede-8b96-37aadbb36aea/refunds',
            payload: {
                amountCents: 0,
                reason: 'Test refund',
            },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toHaveProperty('error', 'Invalid request body');
        expect(mocks.createRefund).not.toHaveBeenCalled();

        await app.close();
    });

    it('creates a refund and returns HTTP 201', async () => {
        mocks.createRefund.mockResolvedValue({
            refundId: '3c8173ca-f325-4394-9a27-82db3976b6dd',
            purchaseId: '05cfe3c7-40ee-4ede-8b96-37aadbb36aea',
            amountCents: 25000,
            totalRefundedCents: 25000,
            purchaseStatus: 'partially_refunded',
        });

        const app = Fastify();
        await app.register(purchaseRoutes);

        const response = await app.inject({
            method: 'POST',
            url: '/purchases/05cfe3c7-40ee-4ede-8b96-37aadbb36aea/refunds',
            headers: { 'idempotency-key': 'refund-2' },
            payload: {
                amountCents: 25000,
                reason: 'Partial refund test',
            },
        });

        expect(response.statusCode).toBe(201);
        expect(response.json()).toMatchObject({
            amountCents: 25000,
            totalRefundedCents: 25000,
            purchaseStatus: 'partially_refunded',
        });

        expect(mocks.createRefund).toHaveBeenCalledWith({
            purchaseId: '05cfe3c7-40ee-4ede-8b96-37aadbb36aea',
            amountCents: 25000,
            reason: 'Partial refund test',
        }, expect.any(Object));

        await app.close();
    });

    it('requires an idempotency key for refunds', async () => {
        const app = Fastify();
        await app.register(purchaseRoutes);

        const response = await app.inject({
            method: 'POST',
            url: '/purchases/05cfe3c7-40ee-4ede-8b96-37aadbb36aea/refunds',
            payload: {
                amountCents: 1000,
                reason: 'Test refund',
            },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
            error: 'A valid Idempotency-Key header is required',
        });
        expect(mocks.executeIdempotently).not.toHaveBeenCalled();

        await app.close();
    });

    it('replays the stored response for an identical idempotent request', async () => {
        mocks.executeIdempotently.mockResolvedValue({
            statusCode: 201,
            body: {
                refundId: '3c8173ca-f325-4394-9a27-82db3976b6dd',
                purchaseId: '05cfe3c7-40ee-4ede-8b96-37aadbb36aea',
                amountCents: 25000,
                totalRefundedCents: 25000,
                purchaseStatus: 'partially_refunded',
            },
        });

        const app = Fastify();
        await app.register(purchaseRoutes);

        const response = await app.inject({
            method: 'POST',
            url: '/purchases/05cfe3c7-40ee-4ede-8b96-37aadbb36aea/refunds',
            headers: { 'idempotency-key': 'refund-replay' },
            payload: {
                amountCents: 25000,
                reason: 'Partial refund test',
            },
        });

        expect(response.statusCode).toBe(201);
        expect(mocks.createRefund).not.toHaveBeenCalled();

        await app.close();
    });

});