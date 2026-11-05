import type { Customer } from '../types/external-apis';

const customers: Customer[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'John Doe',
    billingAddress: '10 Main Street, New York, NY',
    shippingAddress: '10 Main Street, New York, NY',
    email: 'john@example.com',
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
  },
];

export const getCustomer = async (
  customerId: string,
): Promise<Customer | null> => {
  return customers.find((customer) => customer.id === customerId) ?? null;
};