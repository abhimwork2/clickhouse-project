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

    if (process.env.SIMULATE_SHIPMENT_FAILURE === 'true') {
        throw new Error('Simulated shipment failure');
    }

    return {
        id: crypto.randomUUID(),
    };
};