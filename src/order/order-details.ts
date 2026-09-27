/**
 * How an order reaches the customer — held separately from what is in the cart.
 *
 * The cart payload stays satellite-local on purpose: a flower shop's is bouquet-shaped, a product
 * shop's is {productKey, quantity}, so there is nothing to generalize. What every shop does share is
 * "pickup or delivery, on this date, to this address".
 */
export interface Address {
    firstname: string;
    lastname: string;
    company?: string;
    address: string;
    city: string;
    postalCode: string;
    country?: string;
}

/**
 * Dates are ISO `YYYY-MM-DD` strings, never `Date`. A Date does not survive the JSON round trip to
 * core and back, and core's DTOs serialize `LocalDate` in exactly this shape.
 */
export interface PickupFulfilment {
    type: 'pickup';
    date: string;
}

export interface DeliveryFulfilment {
    type: 'delivery';
    date: string;
    address: Address;
    phone?: string;
}

export type Fulfilment = PickupFulfilment | DeliveryFulfilment;

/** Pickup and delivery are independently enable-able — a shop may offer either, both, or neither. */
export interface FulfilmentOptions {
    pickup: boolean;
    delivery: boolean;
}

export function isDelivery(fulfilment: Fulfilment): fulfilment is DeliveryFulfilment {
    return fulfilment.type === 'delivery';
}

export function isPickup(fulfilment: Fulfilment): fulfilment is PickupFulfilment {
    return fulfilment.type === 'pickup';
}

/**
 * The modes a shop currently offers, in a fixed order so the UI does not reorder between renders.
 *
 * Returns an empty list when neither is enabled rather than defaulting to delivery: a satellite
 * misconfigured with no fulfilment mode should render an explicit error, not silently ship goods
 * under an assumption nobody made.
 */
export function availableFulfilments(options: FulfilmentOptions): Array<Fulfilment['type']> {
    const all: Array<Fulfilment['type']> = ['pickup', 'delivery'];
    return all.filter((type) => options[type]);
}
