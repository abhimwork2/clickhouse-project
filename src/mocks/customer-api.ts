import type { Customer } from '../types/external-apis';

const customers: Customer[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'John Doe',
billingAddress: {
  line1: '10 Main Street',
  city: 'New York',
  postalCode: '10001',
  state: 'NY',
  country: 'USA',
},
shippingAddress: {
  line1: '10 Main Street',
  city: 'New York',
  postalCode: '10001',
  state: 'NY',
  country: 'USA',
},
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