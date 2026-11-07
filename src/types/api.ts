export interface ApiErrorResponse {
    error: string;
    details?: Array<{
        code: string;
        path: PropertyKey[];
        message: string;
    }>;
}

export interface CustomerIdParams {
    customerId: string;
}

export interface PurchaseIdParams {
    purchaseId: string;
}

export interface CreditAdjustmentRequest {
    amountCents: number;
    reason: string;
}

export interface CreditBalanceResponse {
    customerId: string;
    balanceCents: number;
    heldCents: number;
    availableCents: number;
}

export interface PurchaseItemRequest {
    productId: string;
    quantity: number;
}

export interface CreatePurchaseRequest {
    customerId: string;
    items: PurchaseItemRequest[];
}

export interface PurchaseResponse {
    purchaseId: string;
    totalCents: number;
    status: 'pending_shipment' | 'completed' | 'shipment_failed';
    shipmentId: string | null;
}

export interface CreateRefundRequest {
    amountCents: number;
    reason: string;
}

export interface RefundResponse {
    refundId: string;
    purchaseId: string;
    amountCents: number;
    totalRefundedCents: number;
    purchaseStatus: 'partially_refunded' | 'refunded';
}

export interface PurchaseHistoryItemResponse {
    productId: string;
    sku: string;
    productName: string;
    unitPriceCents: number;
    quantity: number;
    lineTotalCents: number;
}

export interface PurchaseHistoryEntryResponse {
    purchaseId: string;
    totalCents: number;
    status: string;
    shipmentId: string | null;
    createdAt: string;
    items: PurchaseHistoryItemResponse[];
}

export type PurchaseHistoryResponse = PurchaseHistoryEntryResponse[];
