
import {
    getCreditBalance,
    grantCredit,
} from '../services/credit-service';
import { createPurchase } from '../services/purchase-service';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';

const main = async (): Promise<void> => {
    const balance = await getCreditBalance(CUSTOMER_ID);

    if (!balance) {
        await grantCredit({
            customerId: CUSTOMER_ID,
            amountCents: 200_000,
            reason: 'Initial test credit',
        });
    }

    const purchase = await createPurchase({
        customerId: CUSTOMER_ID,
        items: [
            {
                productId: PRODUCT_ID,
                quantity: 1,
            },
        ],
    });

    console.log('Purchase result:', purchase);
};

main().catch((error: unknown) => {
    console.error('Test failed:', error);
    process.exitCode = 1;
});
