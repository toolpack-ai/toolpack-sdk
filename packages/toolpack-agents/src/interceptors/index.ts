// Interceptor system for composable agent middleware
// Enables cross-cutting concerns like filtering, classification, and rate limiting

export {
  SKIP_SENTINEL,
  type InterceptorResult,
  type InterceptorContext,
  type NextFunction,
  type Interceptor,
  type InterceptorChainConfig,
  isSkipSentinel,
  skip,
} from './types.js';

export {
  type ComposedChain,
  InvocationDepthExceededError,
  composeChain,
  executeChain,
} from './chain.js';

// Built-in interceptors
export {
  createEventDedupInterceptor,
  type EventDedupConfig,
  createNoiseFilterInterceptor,
  type NoiseFilterConfig,
  createSelfFilterInterceptor,
  type SelfFilterConfig,
  createRateLimitInterceptor,
  type RateLimitConfig,
  createParticipantResolverInterceptor,
  type ParticipantResolverConfig,
  createCaptureInterceptor,
  CAPTURE_INTERCEPTOR_MARKER,
  type CaptureHistoryConfig,
  createAddressCheckInterceptor,
  type AddressCheckConfig,
  type AddressCheckResult,
  createIntentClassifierInterceptor,
  type IntentClassifierInterceptorConfig,
  createDepthGuardInterceptor,
  type DepthGuardConfig,
  DepthExceededError,
  createTracerInterceptor,
  type TracerConfig,
} from './builtins/index.js';
