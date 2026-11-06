import type {
  ShipmentRequest,
  ShipmentResponse,
} from '../types/external-apis';

export const createShipment = async (
  request: ShipmentRequest,
): Promise<ShipmentResponse> => {
  console.log('Creating shipment:', request);

  if (request.products.some((product) => product.quantity <= 0)) {
    throw new Error('Shipment creation failed: invalid quantity');
  }

  return {
    id: crypto.randomUUID(),
  };
};