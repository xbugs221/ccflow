/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';

/**
 * Environment Flag: Trust loopback hosts
 * Allows localhost/127.0.0.1 requests to reuse the first local account without JWT login.
 * This is enabled by default and can be disabled with CCFLOW_TRUST_LOCALHOST_AUTH=false.
 */
export const TRUST_LOCALHOST_AUTH = process.env.CCFLOW_TRUST_LOCALHOST_AUTH !== 'false';
