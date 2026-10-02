const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;

export async function sha256Hex(material: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0'))
    .join('');
}
