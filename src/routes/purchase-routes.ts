
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createPurchase } from '../services/purchase-service';

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
