import path from 'path';

interface NativeCrypto {
  encrypt_native(plainText: string, key: string): string;
  decrypt_native(cipherText: string, key: string): string;
}

let nativeCrypto: NativeCrypto | null = null;
let isNative = false;

try {
  // Attempt to load the compiled C addon
  // Depending on whether it's running via ts-node-dev or dist/
  const addonPath = path.resolve(__dirname, '../../build/Release/native_crypto.node');
  nativeCrypto = require(addonPath);
  isNative = true;
  console.log('⚡ Loaded high-performance C native cryptography addon successfully.');
} catch (err) {
  console.warn('⚠️ Could not load C native addon. Falling back to pure TypeScript cryptography. Error:', (err as Error).message);
}

// Interoperable fallback encryption in pure TS/JS
function encryptFallback(plainText: string, key: string): string {
  const plainBuf = Buffer.from(plainText, 'utf8');
  const keyBuf = Buffer.from(key, 'utf8');
  const cipherBuf = Buffer.alloc(plainBuf.length);
  for (let i = 0; i < plainBuf.length; i++) {
    cipherBuf[i] = plainBuf[i] ^ keyBuf[i % keyBuf.length] ^ (i & 0xff);
  }
  return cipherBuf.toString('hex');
}

// Interoperable fallback decryption in pure TS/JS
function decryptFallback(hexCipherText: string, key: string): string {
  const cipherBuf = Buffer.from(hexCipherText, 'hex');
  const keyBuf = Buffer.from(key, 'utf8');
  const plainBuf = Buffer.alloc(cipherBuf.length);
  for (let i = 0; i < cipherBuf.length; i++) {
    plainBuf[i] = cipherBuf[i] ^ keyBuf[i % keyBuf.length] ^ (i & 0xff);
  }
  return plainBuf.toString('utf8');
}

/**
 * Encrypts sensitive data using the compiled C addon or TS fallback.
 */
export function encrypt(plainText: string, key: string): string {
  if (isNative && nativeCrypto) {
    try {
      return nativeCrypto.encrypt_native(plainText, key);
    } catch (e) {
      // Fallback if native execution errors
      return encryptFallback(plainText, key);
    }
  }
  return encryptFallback(plainText, key);
}

/**
 * Decrypts sensitive data using the compiled C addon or TS fallback.
 */
export function decrypt(hexCipherText: string, key: string): string {
  if (isNative && nativeCrypto) {
    try {
      return nativeCrypto.decrypt_native(hexCipherText, key);
    } catch (e) {
      // Fallback if native execution errors
      return decryptFallback(hexCipherText, key);
    }
  }
  return decryptFallback(hexCipherText, key);
}

/**
 * Helper to check if native C module is currently active
 */
export function isUsingNative(): boolean {
  return isNative;
}
