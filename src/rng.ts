/** Seeded randomness helpers. Every generator/executor decision goes through these, never Math.random. */
import seedrandom from 'seedrandom';

export type Rng = seedrandom.PRNG;

export const makeRng = (seed: string | number): Rng => seedrandom(String(seed));

/** Integer in [lo, hi). */
export const rint = (rng: Rng, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo));

export const pick = <T>(rng: Rng, arr: readonly T[]): T => {
  if (arr.length === 0) throw new Error('pick from empty array');
  return arr[rint(rng, 0, arr.length)]!;
};

/** In-place Fisher–Yates. */
export const shuffle = <T>(rng: Rng, arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rint(rng, 0, i + 1);
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
};
