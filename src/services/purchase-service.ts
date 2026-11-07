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

export interface CreateRefundInput {
    purchaseId: string;
    amountCents: number;
    reason: string;
}

export interface RefundResult {
    refundId: string;
    purchaseId: string;
    amountCents: number;
    totalRefundedCents: number;
    purchaseStatus: 'partially_refunded' | 'refunded';
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

        const purchaseUpdate = await client.query(
            `UPDATE purchases
            SET status = 'completed',
                shipment_id = $1,
                updated_at = NOW()
            WHERE id = $2
            AND customer_id = $3
            AND status = 'pending_shipment'`,
            [shipmentId, purchaseId, customerId],
        );

        if (purchaseUpdate.rowCount !== 1) {
            throw new Error('Purchase is not pending or cannot be completed');
        }

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

export interface PurchaseHistoryItem {
    productId: string;
    sku: string;
    productName: string;
    unitPriceCents: number;
    quantity: number;
    lineTotalCents: number;
}

export interface PurchaseHistoryRecord {
    purchaseId: string;
    totalCents: number;
    status: string;
    shipmentId: string | null;
    createdAt: Date;
    items: PurchaseHistoryItem[];
}

export const getPurchaseHistory = async (
    customerId: string,
): Promise<PurchaseHistoryRecord[]> => {
    const result = await pool.query<{
        purchase_id: string;
        total_cents: string;
        status: string;
        shipment_id: string | null;
        created_at: Date;
        product_id: string;
        sku: string;
        product_name: string;
        unit_price_cents: string;
        quantity: number;
        line_total_cents: string;
    }>(
        `SELECT
            p.id AS purchase_id,
            p.total_cents,
            p.status,
            p.shipment_id,
            p.created_at,
            pi.product_id,
            pi.sku,
            pi.product_name,
            pi.unit_price_cents,
            pi.quantity,
            pi.line_total_cents
         FROM purchases p
         JOIN purchase_items pi ON pi.purchase_id = p.id
         WHERE p.customer_id = $1
         ORDER BY p.created_at DESC`,
        [customerId],
    );

    const purchases = new Map<string, PurchaseHistoryRecord>();

    for (const row of result.rows) {
        let purchase = purchases.get(row.purchase_id);

        if (!purchase) {
            purchase = {
                purchaseId: row.purchase_id,
                totalCents: Number(row.total_cents),
                status: row.status,
                shipmentId: row.shipment_id,
                createdAt: row.created_at,
                items: [],
            };

            purchases.set(row.purchase_id, purchase);
        }

        purchase.items.push({
            productId: row.product_id,
            sku: row.sku,
            productName: row.product_name,
            unitPriceCents: Number(row.unit_price_cents),
            quantity: row.quantity,
            lineTotalCents: Number(row.line_total_cents),
        });
    }

    return Array.from(purchases.values());
};

export const createRefund = async (
    input: CreateRefundInput,
): Promise<RefundResult> => {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
        throw new Error('Refund amount must be a positive integer');
    }

    if (!input.reason.trim()) {
        throw new Error('Refund reason is required');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Lock the purchase to prevent concurrent refunds.
        const purchaseResult = await client.query<{
            id: string;
            customer_id: string;
            total_cents: string;
            status: string;
        }>(
            `SELECT id, customer_id, total_cents, status
             FROM purchases
             WHERE id = $1
             FOR UPDATE`,
            [input.purchaseId],
        );

        const purchase = purchaseResult.rows[0];

        if (!purchase) {
            throw new Error('Purchase not found');
        }

        if (
            purchase.status !== 'completed' &&
            purchase.status !== 'partially_refunded'
        ) {
            throw new Error('Purchase is not eligible for a refund');
        }

        const refundTotalResult = await client.query<{
            total_refunded: string;
        }>(
            `SELECT COALESCE(SUM(amount_cents), 0) AS total_refunded
             FROM refunds
             WHERE purchase_id = $1`,
            [input.purchaseId],
        );

        const totalRefunded = Number(
            refundTotalResult.rows[0]?.total_refunded ?? 0,
        );

        const purchaseTotal = Number(purchase.total_cents);
        const remainingRefundable = purchaseTotal - totalRefunded;

        if (input.amountCents > remainingRefundable) {
            throw new Error(
                `Refund exceeds remaining refundable amount: ${remainingRefundable} cents`,
            );
        }

        const refundResult = await client.query<{ id: string }>(
            `INSERT INTO refunds (purchase_id, amount_cents, reason)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [input.purchaseId, input.amountCents, input.reason.trim()],
        );

        const refundId = refundResult.rows[0]?.id;

        if (!refundId) {
            throw new Error('Failed to create refund');
        }

        await client.query(
            `UPDATE credit_accounts
             SET balance_cents = balance_cents + $1,
                 updated_at = NOW()
             WHERE customer_id = $2`,
            [input.amountCents, purchase.customer_id],
        );

        await client.query(
            `INSERT INTO credit_ledger
             (customer_id, amount_cents, entry_type, reason, reference_id)
             VALUES ($1, $2, 'refund_credit', $3, $4)`,
            [
                purchase.customer_id,
                input.amountCents,
                input.reason.trim(),
                refundId,
            ],
        );

        const totalRefundedCents = totalRefunded + input.amountCents;

        const purchaseStatus =
            totalRefundedCents === purchaseTotal
                ? 'refunded'
                : 'partially_refunded';

        await client.query(
            `UPDATE purchases
             SET status = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [purchaseStatus, input.purchaseId],
        );

        await client.query('COMMIT');

        return {
            refundId,
            purchaseId: input.purchaseId,
            amountCents: input.amountCents,
            totalRefundedCents,
            purchaseStatus,
        };
    } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};