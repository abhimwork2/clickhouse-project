import type { Product } from '../types/external-apis';

const products: Product[] = [
    {
        id: '22222222-2222-4222-8222-222222222222',
        sku: 'LAPTOP-001',
        name: 'Laptop',
        description: 'Example laptop',
        price: 999.99,
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
    },
];

export const getProduct = async (
    productId: string,
): Promise<Product | null> => {
    return products.find((product) => product.id === productId) ?? null;
};