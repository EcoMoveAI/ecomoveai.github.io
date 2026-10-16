import * as Crypto from 'expo-crypto';

/** RFC 4122 v4 UUID generated on the device; used as the primary key everywhere (idempotent sync). */
export function newId(): string {
  return Crypto.randomUUID();
}
