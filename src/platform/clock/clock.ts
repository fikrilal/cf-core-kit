export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(instant: Date): Clock {
  return {
    now: () => new Date(instant),
  };
}
