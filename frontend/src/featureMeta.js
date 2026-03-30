// Centralized feature metadata and parameter-key mappings for popovers and controls

// Normalize frontend labels to backend feature names (UI may use slight variants)
export const normalizeFeatureLabelForBackend = (name) => {
  const map = {
    nonlinear: 'non-linear',
    'high_amplitude': 'high-amplitude',
    'low_amplitude': 'low-amplitude',
  };
  return map[name] || name;
};

// Mapping of feature → backend parameter key(s)
// Empty array means no threshold parameter (pure structural check)
export const FEATURE_TO_PARAM_KEYS = {
  global: {
    high: ['high'],
    low: ['low'],
    typical: ['low', 'high'],
    unusual: ['low','high'],
  },
  local: {
    rising: [],
    falling: [],
    concave: [],
    convex: [],
    'linear': ['is_linear'],
    'non-linear': ['is_linear'],
    constant: ['is_constant'],
    smooth: ['is_smooth'],
    noisy: ['is_noisy'],
    complex: ['is_complex'],
    simple: ['is_simple'],
    spiky: ['is_spiky'],
    dropout: ['is_dropout'],
    periodic: ['is_periodic'],
    aperiodic: ['is_periodic'],
    symmetric: [],
    asymmetric: [],
    step: ['is_step'],
    'no-step': ['is_step'],
    'high-amplitude': ['is_high_amplitude'],
    'low-amplitude': ['is_low_amplitude'],
    'high-volume': ['is_high_volume'],
    'low-volume': ['is_low_volume'],
  },
};

export const isGlobalFeature = (name) => ['high', 'low', 'typical', 'unusual'].includes(name);

export const getParamKeysForFeature = (name, type) => {
  const normalized = normalizeFeatureLabelForBackend(name);
  const scope = type === 'global' ? FEATURE_TO_PARAM_KEYS.global : FEATURE_TO_PARAM_KEYS.local;
  return scope[normalized] || [];
};

export const featureUsesParameters = (name, type) => getParamKeysForFeature(name, type).length > 0;

export const countParamKeys = (name, type) => getParamKeysForFeature(name, type).length;


