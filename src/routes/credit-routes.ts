
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
    getCreditBalance,
    grantCredit,
    deductCredit,
} from '../services/credit-service';

const creditAdjustmentSchema = z.object({
    amountCents: z.number().int().positive().safe(),
    reason: z.string().trim().min(1),
});

const creditRoutes: FastifyPluginAsync = async (app) => {
    // Get customer credit balance
    app.get<{ Params: { customerId: string } }>(
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
    app.post<{ Params: { customerId: string } }>(
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

            await grantCredit({
                customerId,
                amountCents: validation.data.amountCents,
                reason: validation.data.reason,
            });

            const balance = await getCreditBalance(customerId);
            return reply.status(200).send(balance);
        },
    );

    // Deduct customer credit
    app.post<{ Params: { customerId: string } }>(
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

            try {
                await deductCredit({
                    customerId,
                    amountCents: validation.data.amountCents,
                    reason: validation.data.reason,
                });
            } catch (error: unknown) {
                if (
                    error instanceof Error &&
                    error.message ===
                    'Customer not found or insufficient available credit'
                ) {
                    return reply.status(400).send({
                        error: error.message,
                    });
                }

                throw error;
            }

            const balance = await getCreditBalance(customerId);
            return reply.status(200).send(balance);
        },
    );
};

export default creditRoutes;
