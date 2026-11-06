import { describe, expect, it } from 'vitest';
import { createRefund } from '../src/services/purchase-service';

describe('createRefund', () => {
    it('rejects a zero refund amount', async () => {
        await expect(
            createRefund({
                purchaseId: '05cfe3c7-40ee-4ede-8b96-37aadbb36aea',
                amountCents: 0,
                reason: 'Test refund',
            }),
        ).rejects.toThrow('Refund amount must be a positive integer');
    });

    it('rejects a negative refund amount', async () => {
        await expect(
            createRefund({
                purchaseId: '05cfe3c7-40ee-4ede-8b96-37aadbb36aea',
                amountCents: -100,
                reason: 'Test refund',
            }),
        ).rejects.toThrow('Refund amount must be a positive integer');
    });

    it('rejects an empty refund reason', async () => {
        await expect(
            createRefund({
                purchaseId: '05cfe3c7-40ee-4ede-8b96-37aadbb36aea',
                amountCents: 1000,
                reason: '   ',
            }),
        ).rejects.toThrow('Refund reason is required');
    });

    it('rejects an unsafe integer refund amount', async () => {
        await expect(
            createRefund({
                purchaseId: '05cfe3c7-40ee-4ede-8b96-37aadbb36aea',
                amountCents: Number.MAX_SAFE_INTEGER + 1,
                reason: 'Test refund',
            }),
        ).rejects.toThrow('Refund amount must be a positive integer');
    });
});