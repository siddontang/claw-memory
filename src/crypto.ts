/**
 * AES-256-GCM encryption/decryption using Web Crypto API.
 * Supports two-layer encryption: server key + optional client key.
 */

/** Derive an AES-256-GCM key from server key (+ optional client key) using HKDF */
async function deriveKey(serverKey: string, clientKey?: string): Promise<CryptoKey> {
  const combined = clientKey ? `${serverKey}:${clientKey}` : serverKey;
  const encoder = new TextEncoder();

  // Import the combined key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(combined),
    "HKDF",
    false,
    ["deriveKey"]
  );

  // Derive AES-256-GCM key via HKDF
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("claw-memory-v1"),
      info: encoder.encode("aes-256-gcm"),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Encrypt plaintext with AES-256-GCM. Returns base64 ciphertext + hex IV. */
export async function encrypt(
  plaintext: string,
  serverKey: string,
  clientKey?: string
): Promise<{ ciphertext: string; iv: string }> {
  const key = await deriveKey(serverKey, clientKey);
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  );

  // Base64-encode ciphertext
  const ciphertext = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  // Hex-encode IV
  const ivHex = Array.from(iv, (b) => b.toString(16).padStart(2, "0")).join("");

  return { ciphertext, iv: ivHex };
}

/** Decrypt AES-256-GCM ciphertext. Throws on wrong key. */
export async function decrypt(
  ciphertext: string,
  iv: string,
  serverKey: string,
  clientKey?: string
): Promise<string> {
  const key = await deriveKey(serverKey, clientKey);

  // Decode base64 ciphertext
  const encryptedBytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  // Decode hex IV
  const ivBytes = new Uint8Array(iv.match(/.{2}/g)!.map((h) => parseInt(h, 16)));

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    key,
    encryptedBytes
  );

  return new TextDecoder().decode(decrypted);
}
