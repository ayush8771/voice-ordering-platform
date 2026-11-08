/**
 * Public surface of the Sarvam adapter.
 *
 * Callers depend on the provider-neutral types in `../llm/types.js`; only
 * construction and configuration are vendor-specific, which keeps the provider
 * replaceable (docs/ARCHITECTURE.md section 5).
 */

export {
  isSarvamConfigured,
  loadSarvamConfig,
  SARVAM_DEFAULT_BASE_URL,
  SARVAM_DEFAULT_MODEL,
  SARVAM_DEFAULT_TIMEOUT_MS,
  type SarvamConfig,
  type SarvamConfigSummary,
} from './config.js';
export {
  createSarvamProvider,
  SARVAM_PROVIDER_ID,
  type SarvamProviderDeps,
} from './provider.js';
