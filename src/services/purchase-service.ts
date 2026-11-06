import { pool } from '../db';
import { getCustomer } from '../mocks/customer-api';
import { getProduct } from '../mocks/product-api';
import { createShipment } from '../mocks/shipment-api';
import type {
    ShipmentRequest,
    ShipmentResponse,
} from '../types/external-apis';


export interface PurchaseItemInput {
    productId: string;
    quantity: number;
}

export interface CreatePurchaseInput {
    customerId: string;
    items: PurchaseItemInput[];
}

export interface PurchaseResult {
    purchaseId: string;
    totalCents: number;
    status: 'pending_shipment' | 'completed' | 'shipment_failed';
    shipmentId: string | null;
}

interface PurchaseItemSnapshot {
    productId: string;
    sku: string;
    productName: string;
    unitPriceCents: number;
    quantity: number;
    lineTotalCents: number;
}

const dollarsToCents = (price: number): number => {
    if (!Number.isFinite(price) || price <= 0) {
        throw new Error('Product price must be a positive number');
    }

    const cents = Math.round(price * 100);

    if (!Number.isSafeInteger(cents)) {
        throw new Error('Product price is too large');
    }

    return cents;
};

const validatePurchaseItems = (items: PurchaseItemInput[]): void => {
    if (items.length === 0) {
        throw new Error('A purchase must contain at least one item');
    }

    const productIds = items.map((item) => item.productId);

    if (new Set(productIds).size !== productIds.length) {
        throw new Error('Duplicate products are not allowed');
    }

    for (const item of items) {
        if (!item.productId.trim()) {
            throw new Error('Product ID is required');
        }

        if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
            throw new Error('Product quantity must be a positive integer');
        }
    }
};

const loadPurchaseItemSnapshots = async (
    items: PurchaseItemInput[],
): Promise<PurchaseItemSnapshot[]> => {
    return Promise.all(
        items.map(async (item) => {
            const product = await getProduct(item.productId);

            if (!product) {
                throw new Error(`Product not found: ${item.productId}`);
            }

            const unitPriceCents = dollarsToCents(product.price);
            const lineTotalCents = unitPriceCents * item.quantity;

            if (!Number.isSafeInteger(lineTotalCents)) {
                throw new Error('Purchase item total is too large');
            }

            return {
                productId: product.id,
                sku: product.sku,
                productName: product.name,
                unitPriceCents,
                quantity: item.quantity,
                lineTotalCents,
            };
        }),
    );
};

const calculatePurchaseTotal = (
    items: PurchaseItemSnapshot[],
): number => {
    const totalCents = items.reduce(
        (total, item) => total + item.lineTotalCents,
        0,
    );

    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
        throw new Error('Invalid purchase total');
    }

    return totalCents;
};

const buildShipmentRequest = (
    shippingAddress: NonNullable<
        Awaited<ReturnType<typeof getCustomer>>
    >['shippingAddress'],
    items: PurchaseItemSnapshot[],
): ShipmentRequest => ({
    shippingAddress,
    products: items.map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
    })),
});

const savePurchase = async (
    customerId: string,
    totalCents: number,
    shippingAddress: NonNullable<
        Awaited<ReturnType<typeof getCustomer>>
    >['shippingAddress'],
    items: PurchaseItemSnapshot[],
): Promise<string> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const purchaseResult = await client.query<{ id: string }>(
            `INSERT INTO purchases
       (customer_id, total_cents, status, shipping_address)
       VALUES ($1, $2, 'pending_shipment', $3)
       RETURNING id`,
            [customerId, totalCents, JSON.stringify(shippingAddress)],
        );

        const purchaseId = purchaseResult.rows[0]?.id;

        if (!purchaseId) {
            throw new Error('Failed to create purchase');
        }

        for (const item of items) {
            await client.query(
                `INSERT INTO purchase_items
         (purchase_id, product_id, sku, product_name,
          unit_price_cents, quantity, line_total_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    purchaseId,
                    item.productId,
                    item.sku,
                    item.productName,
                    item.unitPriceCents,
                    item.quantity,
                    item.lineTotalCents,
                ],
            );
        }

        const holdResult = await client.query(
            `UPDATE credit_accounts
       SET held_cents = held_cents + $1,
           updated_at = NOW()
       WHERE customer_id = $2
         AND balance_cents - held_cents >= $1`,
            [totalCents, customerId],
        );

        if (holdResult.rowCount === 0) {
            throw new Error('Insufficient available credit');
        }

        await client.query(
            `INSERT INTO credit_ledger
       (customer_id, amount_cents, entry_type, reason, reference_id)
       VALUES ($1, $2, 'hold', $3, $4)`,
            [customerId, totalCents, 'Purchase credit hold', purchaseId],
        );

        await client.query('COMMIT');

        return purchaseId;
    } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const completePurchase = async (
    purchaseId: string,
    customerId: string,
    amountCents: number,
    shipmentId: string,
): Promise<void> => {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        throw new Error('Amount must be a positive integer');
    }
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE credit_accounts
       SET balance_cents = balance_cents - $1,
           held_cents = held_cents - $1,
           updated_at = NOW()
       WHERE customer_id = $2
         AND held_cents >= $1`,
            [amountCents, customerId],
        );

        if (result.rowCount === 0) {
            throw new Error('Unable to capture credit hold');
        }

        await client.query(
            `INSERT INTO credit_ledger
       (customer_id, amount_cents, entry_type, reason, reference_id)
       VALUES ($1, $2, 'capture', $3, $4)`,
            [customerId, -amountCents, 'Purchase completed', purchaseId],
        );

        await client.query(
            `UPDATE purchases
       SET status = 'completed',
           shipment_id = $1,
           updated_at = NOW()
       WHERE id = $2`,
            [shipmentId, purchaseId],
        );

        await client.query('COMMIT');
    } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const failPurchase = async (
    purchaseId: string,
    customerId: string,
    amountCents: number,
): Promise<void> => {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        throw new Error('Amount must be a positive integer');
    }
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE credit_accounts
       SET held_cents = held_cents - $1,
           updated_at = NOW()
       WHERE customer_id = $2
         AND held_cents >= $1`,
            [amountCents, customerId],
        );

        if (result.rowCount === 0) {
            throw new Error('Unable to release credit hold');
        }

        await client.query(
            `INSERT INTO credit_ledger
       (customer_id, amount_cents, entry_type, reason, reference_id)
       VALUES ($1, $2, 'release', $3, $4)`,
            [customerId, -amountCents, 'Shipment creation failed', purchaseId],
        );

        await client.query(
            `UPDATE purchases
       SET status = 'shipment_failed',
           updated_at = NOW()
       WHERE id = $1`,
            [purchaseId],
        );

        await client.query('COMMIT');
    } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const createPurchase = async (
    input: CreatePurchaseInput,
): Promise<PurchaseResult> => {

    if (!input.customerId.trim()) {
        throw new Error('Customer ID is required');
    }

    validatePurchaseItems(input.items);

    const customer = await getCustomer(input.customerId);

    if (!customer) {
        throw new Error(`Customer not found: ${input.customerId}`);
    }

    const items = await loadPurchaseItemSnapshots(input.items);
    const totalCents = calculatePurchaseTotal(items);

    const purchaseId = await savePurchase(
        customer.id,
        totalCents,
        customer.shippingAddress,
        items,
    );

    const shipmentRequest = buildShipmentRequest(
        customer.shippingAddress,
        items,
    );

    let shipment: ShipmentResponse;

    try {
        shipment = await createShipment(shipmentRequest);
    } catch (error: unknown) {
        await failPurchase(
            purchaseId,
            customer.id,
            totalCents,
        );

        throw error;
    }

    await completePurchase(
        purchaseId,
        customer.id,
        totalCents,
        shipment.id,
    );

    return {
        purchaseId,
        totalCents,
        status: 'completed',
        shipmentId: shipment.id,
    };
};