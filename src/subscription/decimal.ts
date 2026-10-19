// Exact decimal arithmetic for amounts, so the SDK rounds the way core's BigDecimal does. Binary floats cannot: 1.005 is
// 1.00499999… as a double, so (1.005).toFixed(2) is "1.00" where core's HALF_UP gives 1.01. A number is read through String(),
// the same shortest representation JSON.stringify sends and core parses.

export interface Decimal {
    /** The value is units × 10^-scale. */
    units: bigint;
    scale: number;
}

const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export function parseDecimal(value: number | string): Decimal {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError(`Not a finite amount: ${value}`);
    const text = String(value).trim();
    const match = DECIMAL.exec(text);
    const whole = match?.[2] ?? '';
    const fraction = match?.[3] ?? '';
    if (!match || whole + fraction === '') throw new RangeError(`Not a decimal amount: ${text}`);
    let units = BigInt(whole + fraction);
    let scale = fraction.length - Number(match[4] ?? '0');
    if (scale < 0) {
        units *= 10n ** BigInt(-scale);
        scale = 0;
    }
    return { units: match[1] === '-' ? -units : units, scale };
}

export function multiply(a: Decimal, b: Decimal): Decimal {
    return { units: a.units * b.units, scale: a.scale + b.scale };
}

export function add(a: Decimal, b: Decimal): Decimal {
    const scale = Math.max(a.scale, b.scale);
    return { units: a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale), scale };
}

/** Java's `RoundingMode.HALF_UP`: a tie rounds away from zero, for negative amounts too. */
export function roundHalfUp(a: Decimal, scale: number): Decimal {
    if (a.scale <= scale) return { units: a.units * 10n ** BigInt(scale - a.scale), scale };
    const divisor = 10n ** BigInt(a.scale - scale);
    const magnitude = a.units < 0n ? -a.units : a.units;
    const quotient = magnitude / divisor + ((magnitude % divisor) * 2n >= divisor ? 1n : 0n);
    return { units: a.units < 0n ? -quotient : quotient, scale };
}

export function compareDecimal(a: Decimal, b: Decimal): number {
    const difference = add(a, { units: -b.units, scale: b.scale }).units;
    return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}

export function formatDecimal(a: Decimal): string {
    const negative = a.units < 0n;
    const digits = (negative ? -a.units : a.units).toString().padStart(a.scale + 1, '0');
    const text = a.scale === 0 ? digits : `${digits.slice(0, -a.scale)}.${digits.slice(-a.scale)}`;
    return negative ? `-${text}` : text;
}
