// @ts-check
/**
 * Exact rational arithmetic for division-of-interest math.
 *
 * Title decimals MUST sum to exactly 1.00000000. Binary floating point cannot
 * represent 1/3, 1/7, 3/16, etc., so a deck built on JS numbers silently drifts
 * (e.g. 0.99999999 or 1.00000001) and an analyst chasing the missing penny is a
 * real, recurring division-order defect. We therefore carry every interest as a
 * reduced BigInt fraction and only round to a decimal string at the display edge.
 */

/** @param {bigint} a @param {bigint} b @returns {bigint} */
function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

export class Fraction {
  /** @type {bigint} */ n;
  /** @type {bigint} */ d;

  /**
   * @param {bigint} numerator
   * @param {bigint} [denominator]
   */
  constructor(numerator, denominator = 1n) {
    if (denominator === 0n) throw new Error('Fraction: denominator cannot be zero');
    // Normalize sign onto the numerator.
    if (denominator < 0n) {
      numerator = -numerator;
      denominator = -denominator;
    }
    const g = gcd(numerator, denominator) || 1n;
    this.n = numerator / g;
    this.d = denominator / g;
  }

  /**
   * Coerce a Fraction | bigint | integer-number | string into a Fraction.
   * Strings accept "3", "1/4", "3/16", "0.25", "-0.0625".
   * @param {Fraction|bigint|number|string} v
   * @returns {Fraction}
   */
  static from(v) {
    if (v instanceof Fraction) return v;
    if (typeof v === 'bigint') return new Fraction(v, 1n);
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) {
        // Defer to the string parser so we go through exact decimal handling.
        return Fraction.from(v.toString());
      }
      return new Fraction(BigInt(v), 1n);
    }
    if (typeof v === 'string') {
      const s = v.trim();
      if (s.includes('/')) {
        const [a, b] = s.split('/');
        return new Fraction(BigInt(a.trim()), BigInt(b.trim()));
      }
      if (s.includes('.')) {
        const neg = s.startsWith('-');
        const body = neg ? s.slice(1) : s;
        const [intPart, fracPart = ''] = body.split('.');
        const denom = 10n ** BigInt(fracPart.length);
        const num = BigInt((intPart || '0') + fracPart);
        return new Fraction(neg ? -num : num, denom);
      }
      return new Fraction(BigInt(s), 1n);
    }
    throw new Error(`Fraction.from: unsupported value ${String(v)}`);
  }

  static get ZERO() { return new Fraction(0n, 1n); }
  static get ONE() { return new Fraction(1n, 1n); }

  /** @param {Fraction|bigint|number|string} o */ add(o) { const f = Fraction.from(o); return new Fraction(this.n * f.d + f.n * this.d, this.d * f.d); }
  /** @param {Fraction|bigint|number|string} o */ sub(o) { const f = Fraction.from(o); return new Fraction(this.n * f.d - f.n * this.d, this.d * f.d); }
  /** @param {Fraction|bigint|number|string} o */ mul(o) { const f = Fraction.from(o); return new Fraction(this.n * f.n, this.d * f.d); }
  /** @param {Fraction|bigint|number|string} o */ div(o) { const f = Fraction.from(o); if (f.n === 0n) throw new Error('Fraction: divide by zero'); return new Fraction(this.n * f.d, this.d * f.n); }
  neg() { return new Fraction(-this.n, this.d); }

  /** @param {Fraction|bigint|number|string} o @returns {-1|0|1} */
  cmp(o) {
    const f = Fraction.from(o);
    const lhs = this.n * f.d;
    const rhs = f.n * this.d;
    return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
  }
  /** @param {Fraction|bigint|number|string} o */ eq(o) { return this.cmp(o) === 0; }
  /** @param {Fraction|bigint|number|string} o */ lt(o) { return this.cmp(o) < 0; }
  /** @param {Fraction|bigint|number|string} o */ lte(o) { return this.cmp(o) <= 0; }
  /** @param {Fraction|bigint|number|string} o */ gt(o) { return this.cmp(o) > 0; }
  /** @param {Fraction|bigint|number|string} o */ gte(o) { return this.cmp(o) >= 0; }
  isZero() { return this.n === 0n; }
  /** @returns {-1|0|1} */ sign() { return this.n < 0n ? -1 : this.n > 0n ? 1 : 0; }

  /** Lossy — for charts/sorting only, never for the authoritative deck. */
  toNumber() { return Number(this.n) / Number(this.d); }

  /**
   * Round-half-up to a fixed-decimal string (the disbursement representation).
   * @param {number} [places]
   * @returns {string}
   */
  toDecimal(places = 8) {
    const sign = this.n < 0n ? '-' : '';
    const num = this.n < 0n ? -this.n : this.n;
    const scale = 10n ** BigInt(places);
    const scaled = num * scale;
    let q = scaled / this.d;
    const r = scaled % this.d;
    if (r * 2n >= this.d) q += 1n; // round half up
    const digits = q.toString().padStart(places + 1, '0');
    const cut = digits.length - places;
    const intPart = digits.slice(0, cut);
    const fracPart = digits.slice(cut);
    return places > 0 ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
  }

  /** Human fraction, e.g. "1/30" or "3". */
  toFractionString() { return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`; }
  toString() { return this.toFractionString(); }
}

/**
 * Exact sum of a list of fractions.
 * @param {Array<Fraction|bigint|number|string>} items
 * @returns {Fraction}
 */
export function sum(items) {
  return items.reduce((/** @type {Fraction} */ acc, it) => acc.add(it), Fraction.ZERO);
}

export const F = Fraction.from;
