export type CdnPolicy = Readonly<{
  sMaxAgeSeconds: number;
  staleWhileRevalidateSeconds?: number;
}>;

export function cdnCacheControl(policy: CdnPolicy): string {
  const parts = ["public", `s-maxage=${String(policy.sMaxAgeSeconds)}`];

  if (policy.staleWhileRevalidateSeconds !== undefined) {
    parts.push(
      `stale-while-revalidate=${String(policy.staleWhileRevalidateSeconds)}`,
    );
  }

  return parts.join(", ");
}

export function withCdnCache(response: Response, policy: CdnPolicy): Response {
  response.headers.set("Cache-Control", cdnCacheControl(policy));

  return response;
}
