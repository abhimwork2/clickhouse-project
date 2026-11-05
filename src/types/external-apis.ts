export interface Customer {
  id: string;
  name: string;
  billingAddress: string;
  shippingAddress: string;
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
  shippingAddress: string;
  products: Array<{
    sku: string;
    quantity: number;
  }>;
}

export interface ShipmentResponse {
  id: string;
}