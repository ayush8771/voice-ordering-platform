/**
 * The one place a session ID becomes a storage key.
 *
 * A session ID is an unguessable bearer capability, so nothing persists it:
 * both the `orderingSessions` and `cartDrafts` documents are keyed by this
 * hash instead (docs/SECURITY.md section 1). The hash is the full SHA-256 hex
 * so the keyspace stays as large as the token's; the 12-character log
 * reference in `deriveSessionRef` is a prefix of it and is not a storage key.
 */

import { createHash } from 'node:crypto';

export function hashSessionKey(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex');
}
