
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
    createPurchase,
    createRefund,
    getPurchaseHistory,
    ShipmentCreationError,
} from '../services/purchase-service';
import {
    executeIdempotently,
    IdempotencyConflictError,
    normalizeIdempotencyKey,
} from '../services/idempotency-service';
import type {
    ApiErrorResponse,
    CreatePurchaseRequest,
    CreateRefundRequest,
    CustomerIdParams,
    PurchaseHistoryResponse,
    PurchaseIdParams,
    PurchaseResponse,
    RefundResponse,
} from '../types/api';

const createPurchaseSchema = z.object({
    customerId: z.string().uuid(),
    items: z.array(
        z.object({
            productId: z.string().uuid(),
            quantity: z.number().int().positive().safe(),
        }),
    ).min(1),
});

const purchaseIdSchema = z.string().uuid();

const purchaseRoutes: FastifyPluginAsync = async (app) => {

    // Get customer purchase history
    app.get<{
        Params: CustomerIdParams;
        Reply: { 200: PurchaseHistoryResponse };
    }>(
        '/customers/:customerId/purchases',
        async (request) => {
            const { customerId } = request.params;

            return getPurchaseHistory(customerId);
        },
    );

    // Create a full or partial refund
    app.post<{
        Params: PurchaseIdParams;
        Body: CreateRefundRequest;
        Reply: {
            201: RefundResponse;
            400: ApiErrorResponse;
            404: ApiErrorResponse;
            409: ApiErrorResponse;
        };
    }>(
        '/purchases/:purchaseId/refunds',
        async (request, reply) => {
            const paramValidation = purchaseIdSchema.safeParse(
                request.params.purchaseId,
            );

            if (!paramValidation.success) {
                return reply.status(400).send({
                    error: 'Invalid purchase ID',
                });
            }

            const purchaseId = paramValidation.data;

            const refundSchema = z.object({
                amountCents: z.number().int().positive().safe(),
                reason: z.string().trim().min(1),
            });

            const validation = refundSchema.safeParse(request.body);

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
                    | { statusCode: 201; body: RefundResponse }
                    | { statusCode: 400 | 404 | 409; body: ApiErrorResponse }
                >(
                    'purchase.refund',
                    key,
                    { purchaseId, ...validation.data },
                    async (client) => {
                        await client.query('SAVEPOINT refund_operation');
                        try {
                            const refund = await createRefund({
                                purchaseId,
                                amountCents: validation.data.amountCents,
                                reason: validation.data.reason,
                            }, client);
                            await client.query('RELEASE SAVEPOINT refund_operation');
                            return { statusCode: 201, body: refund };
                        } catch (error: unknown) {
                            await client.query(
                                'ROLLBACK TO SAVEPOINT refund_operation',
                            );
                            await client.query(
                                'RELEASE SAVEPOINT refund_operation',
                            );
                            if (error instanceof Error) {
                                return {
                                    statusCode: error.message === 'Purchase not found'
                                        ? 404
                                        : 400,
                                    body: { error: error.message },
                                };
                            }
                            throw error;
                        }
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

    //Post a new purchase
    app.post<{
        Body: CreatePurchaseRequest;
        Reply: {
            201: PurchaseResponse;
            400: ApiErrorResponse;
            409: ApiErrorResponse;
        };
    }>('/purchases', async (request, reply) => {
        const validation = createPurchaseSchema.safeParse(request.body);

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
                | { statusCode: 201; body: PurchaseResponse }
                | { statusCode: 400 | 409; body: ApiErrorResponse }
            >(
                'purchase.create',
                key,
                validation.data,
                async (client) => {
                    await client.query('SAVEPOINT purchase_operation');
                    try {
                        const purchase = await createPurchase(
                            validation.data,
                            client,
                            key,
                        );
                        await client.query(
                            'RELEASE SAVEPOINT purchase_operation',
                        );
                        return { statusCode: 201, body: purchase };
                    } catch (error: unknown) {
                        if (error instanceof ShipmentCreationError) {
                            await client.query(
                                'RELEASE SAVEPOINT purchase_operation',
                            );
                            return {
                                statusCode: 400,
                                body: { error: error.message },
                            };
                        }
                        await client.query(
                            'ROLLBACK TO SAVEPOINT purchase_operation',
                        );
                        await client.query(
                            'RELEASE SAVEPOINT purchase_operation',
                        );
                        if (error instanceof Error) {
                            return {
                                statusCode: 400,
                                body: { error: error.message },
                            };
                        }
                        throw error;
                    }
                },
            );
            return reply.status(response.statusCode).send(response.body);
        } catch (error: unknown) {
            if (error instanceof IdempotencyConflictError) {
                return reply.status(409).send({ error: error.message });
            }
            throw error;
        }
    });
};

export default purchaseRoutes;
