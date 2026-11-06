import { pool } from '../db';

export interface CreditBalance {
    customerId: string;
    balanceCents: number;
    heldCents: number;
    availableCents: number;
}

export interface CreditAdjustment {
    customerId: string;
    amountCents: number;
    reason: string;
}

export interface CreditHold {
    customerId: string;
    amountCents: number;
    reason: string;
    referenceId: string;
}

export const getCreditBalance = async (
    customerId: string,
): Promise<CreditBalance | null> => {
    const result = await pool.query<{
        balance_cents: string;
        held_cents: string;
    }>(
        `SELECT balance_cents, held_cents
     FROM credit_accounts
     WHERE customer_id = $1`,
        [customerId],
    );

    const account = result.rows[0];

    if (!account) {
        return null;
    }

    const balanceCents = Number(account.balance_cents);
    const heldCents = Number(account.held_cents);

    return {
        customerId,
        balanceCents,
        heldCents,
        availableCents: balanceCents - heldCents,
    };
};

export const grantCredit = async (
    adjustment: CreditAdjustment,
): Promise<void> => {

    if (
        !Number.isSafeInteger(adjustment.amountCents) ||
        adjustment.amountCents <= 0
    ) {
        throw new Error('Grant amount must be a positive integer');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        await client.query(
            `INSERT INTO credit_accounts (customer_id, balance_cents)
       VALUES ($1, $2)
       ON CONFLICT (customer_id)
       DO UPDATE SET
         balance_cents = credit_accounts.balance_cents + EXCLUDED.balance_cents,
         updated_at = NOW()`,
            [adjustment.customerId, adjustment.amountCents],
        );

        await client.query(
            `INSERT INTO credit_ledger
       (customer_id, amount_cents, entry_type, reason)
       VALUES ($1, $2, 'grant', $3)`,
            [adjustment.customerId, adjustment.amountCents, adjustment.reason],
        );

        await client.query('COMMIT');
    } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const deductCredit = async (
    adjustment: CreditAdjustment,
): Promise<void> => {
    if (!Number.isSafeInteger(adjustment.amountCents) || adjustment.amountCents <= 0) {
        throw new Error('Deduction amount must be a positive integer');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE credit_accounts
       SET balance_cents = balance_cents - $1,
           updated_at = NOW()
       WHERE customer_id = $2
         AND balance_cents - held_cents >= $1`,
            [adjustment.amountCents, adjustment.customerId],
        );

        if (result.rowCount === 0) {
            throw new Error('Customer not found or insufficient available credit');
        }

        await client.query(
            `INSERT INTO credit_ledger
       (customer_id, amount_cents, entry_type, reason)
       VALUES ($1, $2, 'deduction', $3)`,
            [adjustment.customerId, -adjustment.amountCents, adjustment.reason],
        );

        await client.query('COMMIT');
    } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const placeCreditHold = async (
    hold: CreditHold,
): Promise<void> => {
    if (!Number.isSafeInteger(hold.amountCents) || hold.amountCents <= 0) {
        throw new Error('Hold amount must be a positive integer');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE credit_accounts
       SET held_cents = held_cents + $1,
           updated_at = NOW()
       WHERE customer_id = $2
         AND balance_cents - held_cents >= $1`,
            [hold.amountCents, hold.customerId],
        );

        if (result.rowCount === 0) {
            throw new Error('Customer not found or insufficient available credit');
        }

        await client.query(
            `INSERT INTO credit_ledger
       (customer_id, amount_cents, entry_type, reason, reference_id)
       VALUES ($1, $2, 'hold', $3, $4)`,
            [hold.customerId, hold.amountCents, hold.reason, hold.referenceId],
        );

        await client.query('COMMIT');
    } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const captureCreditHold = async (
    hold: CreditHold,
): Promise<void> => {

    if (!Number.isSafeInteger(hold.amountCents) || hold.amountCents <= 0) {
        throw new Error('Hold amount must be a positive integer');
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
            [hold.amountCents, hold.customerId],
        );

        if (result.rowCount === 0) {
            throw new Error('Customer not found or insufficient held credit');
        }

        await client.query(
            `INSERT INTO credit_ledger
       (customer_id, amount_cents, entry_type, reason, reference_id)
       VALUES ($1, $2, 'capture', $3, $4)`,
            [hold.customerId, -hold.amountCents, hold.reason, hold.referenceId],
        );

        await client.query('COMMIT');
    } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};