// Build-time crypto helpers for restricted ("secret") wiki content.
// Uses Node's WebCrypto (require("node:crypto").webcrypto.subtle), which implements
// the same SubtleCrypto spec as browsers, so ciphertext produced here is decryptable
// by scripts/assets/secrets.js using the browser's native crypto.subtle.
const { webcrypto } = require("node:crypto");
const { subtle } = webcrypto;

const PBKDF2_ITERATIONS = 400000;
const ROLE_SALT_NAMESPACE = "iorien-wiki-role:";

function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function textToBytes(text) {
  return new TextEncoder().encode(text);
}

async function roleSalt(roleId) {
  const digest = await subtle.digest("SHA-256", textToBytes(ROLE_SALT_NAMESPACE + roleId));
  return new Uint8Array(digest);
}

async function deriveRoleKey(passphrase, roleId) {
  const salt = await roleSalt(roleId);
  const baseKey = await subtle.importKey("raw", textToBytes(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

// Encrypts `html` with a fresh random content key, then wraps that key once per
// role in `roles` (envelope encryption) so any one of their passphrases can unlock it.
async function encryptSecret(html, roles, roleConfig) {
  const contentKey = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    contentKey,
    textToBytes(html)
  );
  const rawContentKey = await subtle.exportKey("raw", contentKey);

  const wraps = {};
  for (const roleId of roles) {
    const passphrase = roleConfig[roleId];
    if (!passphrase) {
      console.warn(`  aviso: papel "${roleId}" sem senha configurada — bloco ficará ilegível para esse papel nesta build.`);
      continue;
    }
    const wrapKey = await deriveRoleKey(passphrase, roleId);
    const wrapIv = webcrypto.getRandomValues(new Uint8Array(12));
    const wrappedKey = await subtle.encrypt(
      { name: "AES-GCM", iv: wrapIv, tagLength: 128 },
      wrapKey,
      rawContentKey
    );
    wraps[roleId] = { iv: toBase64(wrapIv), wrappedKey: toBase64(wrappedKey) };
  }

  return {
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    wraps,
  };
}

module.exports = { encryptSecret, PBKDF2_ITERATIONS };
