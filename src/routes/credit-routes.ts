
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
    getCreditBalance,
    grantCredit,
    deductCredit,
} from '../services/credit-service';
import {
    executeIdempotently,
    IdempotencyConflictError,
    normalizeIdempotencyKey,
} from '../services/idempotency-service';
import type {
    ApiErrorResponse,
    CreditAdjustmentRequest,
    CreditBalanceResponse,
    CustomerIdParams,
} from '../types/api';

const creditAdjustmentSchema = z.object({
    amountCents: z.number().int().positive().safe(),
    reason: z.string().trim().min(1),
});

const creditRoutes: FastifyPluginAsync = async (app) => {
    // Get customer credit balance
    app.get<{
        Params: CustomerIdParams;
        Reply: { 200: CreditBalanceResponse; 404: ApiErrorResponse };
    }>(
        '/customers/:customerId/credit',
        async (request, reply) => {
            const { customerId } = request.params;

            const balance = await getCreditBalance(customerId);

            if (!balance) {
                return reply.status(404).send({
                    error: 'Credit account not found',
                });
            }

            return balance;
        },
    );

    // Grant customer credit
    app.post<{
        Params: CustomerIdParams;
        Body: CreditAdjustmentRequest;
        Reply: {
            200: CreditBalanceResponse;
            400: ApiErrorResponse;
            409: ApiErrorResponse;
        };
    }>(
        '/customers/:customerId/credit/grant',
        async (request, reply) => {
            const { customerId } = request.params;
            const validation = creditAdjustmentSchema.safeParse(request.body);

            if (!validation.success) {
                return reply.status(400).send({
                    error: 'Invalid request body',
                    details: validation.error.issues,
                });
            }

            const key = normalizeIdempotencyKey(
                request.headers['idempotency-key'],
            );
            if (!key) {
                return reply.status(400).send({
                    error: 'A valid Idempotency-Key header is required',
                });
            }

            try {
                const response = await executeIdempotently<
                    | { statusCode: 200; body: CreditBalanceResponse }
                    | { statusCode: 400 | 409; body: ApiErrorResponse }
                >(
                    'credit.grant',
                    key,
                    { customerId, ...validation.data },
                    async (client) => {
                        await grantCredit({
                            customerId,
                            amountCents: validation.data.amountCents,
                            reason: validation.data.reason,
                        }, client);
                        const balance = await getCreditBalance(customerId, client);
                        if (!balance) {
                            throw new Error('Credit account missing after grant');
                        }
                        return {
                            statusCode: 200,
                            body: balance,
                        };
                    },
                );
                return reply.status(response.statusCode).send(response.body);
            } catch (error: unknown) {
                if (error instanceof IdempotencyConflictError) {
                    return reply.status(409).send({ error: error.message });
                }
                throw error;
            }
        },
    );

    // Deduct customer credit
    app.post<{
        Params: CustomerIdParams;
        Body: CreditAdjustmentRequest;
        Reply: {
            200: CreditBalanceResponse;
            400: ApiErrorResponse;
            409: ApiErrorResponse;
        };
    }>(
        '/customers/:customerId/credit/deduct',
        async (request, reply) => {
            const { customerId } = request.params;
            const validation = creditAdjustmentSchema.safeParse(request.body);

            if (!validation.success) {
                return reply.status(400).send({
                    error: 'Invalid request body',
                    details: validation.error.issues,
                });
            }

            const key = normalizeIdempotencyKey(
                request.headers['idempotency-key'],
            );
            if (!key) {
                return reply.status(400).send({
                    error: 'A valid Idempotency-Key header is required',
                });
            }

            try {
                const response = await executeIdempotently<
                    | { statusCode: 200; body: CreditBalanceResponse }
                    | { statusCode: 400 | 409; body: ApiErrorResponse }
                >(
                    'credit.deduct',
                    key,
                    { customerId, ...validation.data },
                    async (client) => {
                        await client.query('SAVEPOINT credit_deduction');
                        try {
                            await deductCredit({
                                customerId,
                                amountCents: validation.data.amountCents,
                                reason: validation.data.reason,
                            }, client);
                        } catch (error: unknown) {
                            await client.query(
                                'ROLLBACK TO SAVEPOINT credit_deduction',
                            );
                            await client.query(
                                'RELEASE SAVEPOINT credit_deduction',
                            );
                            if (
                                error instanceof Error &&
                                error.message ===
                                'Customer not found or insufficient available credit'
                            ) {
                                return {
                                    statusCode: 400,
                                    body: { error: error.message },
                                };
                            }
                            throw error;
                        }
                        await client.query('RELEASE SAVEPOINT credit_deduction');

                        const balance = await getCreditBalance(customerId, client);
                        if (!balance) {
                            throw new Error('Credit account missing after deduction');
                        }
                        return {
                            statusCode: 200,
                            body: balance,
                        };
                    },
                );
                return reply.status(response.statusCode).send(response.body);
            } catch (error: unknown) {
                if (error instanceof IdempotencyConflictError) {
                    return reply.status(409).send({ error: error.message });
                }
                throw error;
            }
        },
    );
};

export default creditRoutes;
