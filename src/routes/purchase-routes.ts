
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
    createPurchase,
    createRefund,
    getPurchaseHistory,
} from '../services/purchase-service';

const createPurchaseSchema = z.object({
    customerId: z.string().uuid(),
    items: z.array(
        z.object({
            productId: z.string().uuid(),
            quantity: z.number().int().positive().safe(),
        }),
    ).min(1),
});

const purchaseRoutes: FastifyPluginAsync = async (app) => {

    // Get customer purchase history
    app.get<{ Params: { customerId: string } }>(
        '/customers/:customerId/purchases',
        async (request) => {
            const { customerId } = request.params;

            return getPurchaseHistory(customerId);
        },
    );

    // Create a full or partial refund
    app.post<{ Params: { purchaseId: string } }>(
        '/purchases/:purchaseId/refunds',
        async (request, reply) => {
            const { purchaseId } = request.params;

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

            try {
                const refund = await createRefund({
                    purchaseId,
                    amountCents: validation.data.amountCents,
                    reason: validation.data.reason,
                });

                return reply.status(201).send(refund);
            } catch (error: unknown) {
                if (error instanceof Error) {
                    const statusCode =
                        error.message === 'Purchase not found' ? 404 : 400;

                    return reply.status(statusCode).send({
                        error: error.message,
                    });
                }

                throw error;
            }
        },
    );

    //Post a new purchase
    app.post('/purchases', async (request, reply) => {
        const validation = createPurchaseSchema.safeParse(request.body);

        if (!validation.success) {
            return reply.status(400).send({
                error: 'Invalid request body',
                details: validation.error.issues,
            });
        }

        try {
            const purchase = await createPurchase(validation.data);

            return reply.status(201).send(purchase);
        } catch (error: unknown) {
            if (error instanceof Error) {
                return reply.status(400).send({
                    error: error.message,
                });
            }

            throw error;
        }
    });
};

export default purchaseRoutes;
