export type Memoized<T> = Readonly<{
  get: () => Promise<T>;
}>;

export type MemoizeOptions = Readonly<{
  ttlMs: number;
}>;

export function memoize<T>(
  resolver: () => Promise<T>,
  options: MemoizeOptions,
): Memoized<T> {
  let cached: { value: T } | undefined;
  let expiresAt = 0;
  let inflight: Promise<T> | undefined;

  return {
    get: () => {
      if (cached !== undefined && Date.now() < expiresAt) {
        return Promise.resolve(cached.value);
      }

      inflight ??= resolver()
        .then((value) => {
          cached = { value };
          expiresAt = Date.now() + options.ttlMs;
          inflight = undefined;

          return value;
        })
        .catch((error: unknown) => {
          inflight = undefined;
          throw error;
        });

      return inflight;
    },
  };
}
