import type {
  ShipmentRequest,
  ShipmentResponse,
} from '../types/external-apis';

export const createShipment = async (
  request: ShipmentRequest,
): Promise<ShipmentResponse> => {
  console.log('Creating shipment:', request);

  return {
    id: crypto.randomUUID(),
  };
};