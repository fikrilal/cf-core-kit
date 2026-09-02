import { describe, expect, it } from "vitest";

import { fixedClock, systemClock } from "./clock";

describe("systemClock", () => {
  it("returns the current time as a Date", () => {
    const before = Date.now();
    const now = systemClock.now();

    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("fixedClock", () => {
  it("returns defensive copies of the configured instant", () => {
    const instant = new Date("2026-10-10T00:00:00.000Z");
    const clock = fixedClock(instant);

    expect(clock.now()).toEqual(instant);
    expect(clock.now()).not.toBe(instant);
  });
});
