import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AppError } from "../errors/app-error";
import { decode } from "./validation";

const profileSchema = z.object({
  email: z.string().min(1),
  age: z.number().int(),
});

function thrownAppError(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }

    throw error;
  }

  throw new Error("expected the function to throw");
}

describe("decode", () => {
  it("returns parsed data for valid input", () => {
    expect(decode(profileSchema, { email: "a@example.com", age: 30 })).toEqual({
      email: "a@example.com",
      age: 30,
    });
  });

  it("throws a validation AppError with field issues", () => {
    const error = thrownAppError(() =>
      decode(profileSchema, { email: "", age: "old" }),
    );

    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.message).toBe("");
    expect(error.issues?.map((issue) => issue.field)).toEqual(["email", "age"]);
    expect(error.issues?.every((issue) => issue.message.length > 0)).toBe(true);
  });

  it("omits the field for root-level issues", () => {
    const error = thrownAppError(() => decode(z.string(), 42));

    expect(error.issues).toHaveLength(1);
    expect(error.issues?.[0]?.field).toBeUndefined();
  });
});
