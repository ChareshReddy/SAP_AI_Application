import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for GCM

/**
 * Derives a 32-byte key from the environment variable ENCRYPTION_KEY.
 * If provided as a 64-char hex string, uses Buffer.from(..., 'hex').
 * Otherwise, hashes it with sha256 to ensure exact 32-byte length.
 */
function getKey() {
  const envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error('ENCRYPTION_KEY environment variable is not set.');
  }

  if (envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
    return Buffer.from(envKey, 'hex');
  }

  return crypto.createHash('sha256').update(envKey).digest();
}

/**
 * Encrypts an object (or string) using AES-256-GCM.
 * Never logs credentials.
 * @param {object|string} data 
 * @returns {string} iv:authTag:encryptedContent in hex format
 */
export function encryptCredentials(data) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const textToEncrypt = typeof data === 'string' ? data : JSON.stringify(data);
  let encrypted = cipher.update(textToEncrypt, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  const ivHex = iv.toString('hex');

  return `${ivHex}:${authTag}:${encrypted}`;
}

/**
 * Decrypts payload encrypted by encryptCredentials.
 * Never logs credentials.
 * @param {string} encryptedPayload 
 * @returns {object|string} Decrypted object or string
 */
export function decryptCredentials(encryptedPayload) {
  if (!encryptedPayload || typeof encryptedPayload !== 'string') {
    throw new Error('Invalid encrypted payload format');
  }

  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  try {
    return JSON.parse(decrypted);
  } catch {
    return decrypted;
  }
}
