export type ListPayload = Readonly<{
  items: readonly unknown[];
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
}>;

export function data(payload: unknown, init?: ResponseInit): Response {
  return Response.json({ data: payload }, init);
}

export function list(payload: ListPayload, init?: ResponseInit): Response {
  return Response.json(
    {
      data: payload.items,
      meta: {
        ...(payload.nextCursor === undefined
          ? {}
          : { nextCursor: payload.nextCursor }),
        limit: payload.limit,
        hasMore: payload.hasMore,
      },
    },
    init,
  );
}

export function created(
  payload: unknown,
  location?: string,
  init?: ResponseInit,
): Response {
  const headers = new Headers(init?.headers);

  if (location !== undefined) {
    headers.set("Location", location);
  }

  return Response.json({ data: payload }, { ...init, status: 201, headers });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}
