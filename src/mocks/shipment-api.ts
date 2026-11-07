import type {
    ShipmentRequest,
    ShipmentResponse,
} from '../types/external-apis';

const shipmentsByIdempotencyKey = new Map<string, ShipmentResponse>();

export const createShipment = async (
    request: ShipmentRequest,
    idempotencyKey?: string,
): Promise<ShipmentResponse> => {
    if (idempotencyKey) {
        const existingShipment = shipmentsByIdempotencyKey.get(idempotencyKey);
        if (existingShipment) {
            return existingShipment;
        }
    }

    console.log('Creating shipment:', request);

    if (request.products.some((product) => product.quantity <= 0)) {
        throw new Error('Shipment creation failed: invalid quantity');
    }

    if (process.env.SIMULATE_SHIPMENT_FAILURE === 'true') {
        throw new Error('Simulated shipment failure');
    }

    const shipment = {
        id: crypto.randomUUID(),
    };
    if (idempotencyKey) {
        shipmentsByIdempotencyKey.set(idempotencyKey, shipment);
    }
    return shipment;
};