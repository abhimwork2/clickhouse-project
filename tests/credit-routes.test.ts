import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getCreditBalance: vi.fn(),
    grantCredit: vi.fn(),
    deductCredit: vi.fn(),
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
}));

vi.mock('../src/services/credit-service', () => mocks);
vi.mock('../src/services/idempotency-service', () => mocks);

import creditRoutes from '../src/routes/credit-routes';

describe('Credit routes', () => {
    it('returns the customer credit balance', async () => {
        mocks.getCreditBalance.mockResolvedValue({
            customerId: '11111111-1111-4111-8111-111111111111',
            balanceCents: 100000,
            heldCents: 20000,
            availableCents: 80000,
        });

        const app = Fastify();
        await app.register(creditRoutes);

        const response = await app.inject({
            method: 'GET',
            url: '/customers/11111111-1111-4111-8111-111111111111/credit',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            balanceCents: 100000,
            heldCents: 20000,
            availableCents: 80000,
        });

        await app.close();
    });

    it('grants credit and returns the updated balance', async () => {
        mocks.grantCredit.mockResolvedValue(undefined);
        mocks.getCreditBalance.mockResolvedValue({
            customerId: '11111111-1111-4111-8111-111111111111',
            balanceCents: 150000,
            heldCents: 0,
            availableCents: 150000,
        });

        const app = Fastify();
        await app.register(creditRoutes);

        const response = await app.inject({
            method: 'POST',
            url: '/customers/11111111-1111-4111-8111-111111111111/credit/grant',
            headers: { 'idempotency-key': 'grant-1' },
            payload: {
                amountCents: 50000,
                reason: 'Test credit grant',
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            balanceCents: 150000,
            availableCents: 150000,
        });
        expect(mocks.grantCredit).toHaveBeenCalledWith({
            customerId: '11111111-1111-4111-8111-111111111111',
            amountCents: 50000,
            reason: 'Test credit grant',
        }, expect.any(Object));

        await app.close();
    });

    it('rejects a credit grant with an invalid amount', async () => {
        const app = Fastify();
        await app.register(creditRoutes);

        const response = await app.inject({
            method: 'POST',
            url: '/customers/11111111-1111-4111-8111-111111111111/credit/grant',
            payload: {
                amountCents: 0,
                reason: 'Invalid grant',
            },
        });

        expect(response.statusCode).toBe(400);
        expect(mocks.grantCredit).not.toHaveBeenCalled();

        await app.close();
    });

    it('returns 404 when the customer credit account does not exist', async () => {
        mocks.getCreditBalance.mockResolvedValue(null);

        const app = Fastify();
        await app.register(creditRoutes);

        const response = await app.inject({
            method: 'GET',
            url: '/customers/11111111-1111-4111-8111-111111111111/credit',
        });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({
            error: 'Credit account not found',
        });

        await app.close();
    });

    it('rejects a deduction when available credit is insufficient', async () => {
        mocks.deductCredit.mockRejectedValue(
            new Error('Customer not found or insufficient available credit'),
        );

        const app = Fastify();
        await app.register(creditRoutes);

        const response = await app.inject({
            method: 'POST',
            url: '/customers/11111111-1111-4111-8111-111111111111/credit/deduct',
            headers: { 'idempotency-key': 'deduct-1' },
            payload: {
                amountCents: 500000,
                reason: 'Test deduction',
            },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
            error: 'Customer not found or insufficient available credit',
        });

        await app.close();
    });

    it('deducts credit and returns the updated balance', async () => {
        mocks.deductCredit.mockResolvedValue(undefined);
        mocks.getCreditBalance.mockResolvedValue({
            customerId: '11111111-1111-4111-8111-111111111111',
            balanceCents: 90000,
            heldCents: 10000,
            availableCents: 80000,
        });

        const app = Fastify();
        await app.register(creditRoutes);

        const response = await app.inject({
            method: 'POST',
            url: '/customers/11111111-1111-4111-8111-111111111111/credit/deduct',
            headers: { 'idempotency-key': 'deduct-2' },
            payload: {
                amountCents: 10000,
                reason: 'Test deduction',
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            balanceCents: 90000,
            heldCents: 10000,
            availableCents: 80000,
        });
        expect(mocks.deductCredit).toHaveBeenCalledWith({
            customerId: '11111111-1111-4111-8111-111111111111',
            amountCents: 10000,
            reason: 'Test deduction',
        }, expect.any(Object));

        await app.close();
    });

    it('requires an idempotency key for credit grants', async () => {
        const app = Fastify();
        await app.register(creditRoutes);

        const response = await app.inject({
            method: 'POST',
            url: '/customers/11111111-1111-4111-8111-111111111111/credit/grant',
            payload: {
                amountCents: 50000,
                reason: 'Test credit grant',
            },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
            error: 'A valid Idempotency-Key header is required',
        });
        expect(mocks.executeIdempotently).not.toHaveBeenCalled();

        await app.close();
    });

});