// Built-in interceptors shipped with the agents package
// All are opt-in via the registration list - none run unless explicitly listed

export { createEventDedupInterceptor, type EventDedupConfig } from './event-dedup.js';
export { createNoiseFilterInterceptor, type NoiseFilterConfig } from './noise-filter.js';
export { createSelfFilterInterceptor, type SelfFilterConfig } from './self-filter.js';
export { createRateLimitInterceptor, type RateLimitConfig } from './rate-limit.js';
export { createParticipantResolverInterceptor, type ParticipantResolverConfig } from './participant-resolver.js';
export { createCaptureInterceptor, CAPTURE_INTERCEPTOR_MARKER, type CaptureHistoryConfig } from './capture-history.js';
export { createAddressCheckInterceptor, type AddressCheckConfig, type AddressCheckResult } from './address-check.js';
export { createIntentClassifierInterceptor, type IntentClassifierInterceptorConfig } from './intent-classifier.js';
export { createDepthGuardInterceptor, type DepthGuardConfig, DepthExceededError } from './depth-guard.js';
export { createTracerInterceptor, type TracerConfig } from './tracer.js';
