export interface Customer {
    id: string;
    name: string;
    billingAddress: Address;
    shippingAddress: Address;
    email: string;
    createdAt: number;
    lastModifiedAt: number;
}

export interface Product {
    id: string;
    sku: string;
    name: string;
    description: string;
    price: number;
    createdAt: number;
    lastModifiedAt: number;
}

export interface ShipmentRequest {
    shippingAddress: Address;
    products: Array<{
        sku: string;
        quantity: number;
    }>;
}

export interface ShipmentResponse {
    id: string;
}

export interface Address {
    line1: string;
    line2?: string;
    city: string;
    postalCode: string;
    state: string;
    country: string;
}