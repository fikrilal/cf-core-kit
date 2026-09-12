export function encodeBytesBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function encodeBase64Url(input: string): string {
  return encodeBytesBase64Url(new TextEncoder().encode(input));
}

export function decodeBytesBase64Url(input: string): Uint8Array {
  const base64 = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function decodeBase64Url(input: string): string {
  return new TextDecoder().decode(decodeBytesBase64Url(input));
}
