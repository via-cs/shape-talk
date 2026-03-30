import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getParamKeysForFeature, isGlobalFeature, normalizeFeatureLabelForBackend } from '../featureMeta';

const Panel = ({ children, left, top, onClose }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const onClick = (e) => { /* simple outside close by data-attr */
      const el = e.target.closest('[data-feature-popover]');
      if (!el) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);
  return (
    <div
      data-feature-popover
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 10000,
        background: '#23272f',
        color: '#fff',
        border: '1px solid #444a57',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
        width: 320,
        padding: 12,
      }}
    >
      {children}
    </div>
  );
};

const NumericField = ({ label, value, onChange, placeholder }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
    <div style={{ minWidth: 80, color: '#b8c2cc' }}>{label}</div>
    <input
      type="number"
      step="any"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #3a3f4b', background: '#1a1d23', color: '#fff' }}
    />
  </div>
);

const FeatureParamPopover = ({ anchorEl, featureName, type, open, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState({});
  const [initialValues, setInitialValues] = useState({});
  const [descriptions, setDescriptions] = useState({ global: {}, local: {} });

  // Support multiple features: coerce into a list
  const featureList = useMemo(() => {
    if (!featureName) return [];
    return Array.isArray(featureName) ? featureName : [featureName];
  }, [featureName]);

  const featureConfigs = useMemo(() => {
    return featureList.map((name) => {
      const normalized = normalizeFeatureLabelForBackend(name || '');
      const keysForFeature = getParamKeysForFeature(name || '', type || 'local');
      return { name, normalized, keys: keysForFeature };
    });
  }, [featureList, type]);

  const allKeys = useMemo(() => {
    const set = new Set();
    featureConfigs.forEach(cfg => (cfg.keys || []).forEach(k => set.add(k)));
    return Array.from(set);
  }, [featureConfigs]);
  const isGlobal = type === 'global';

  const position = useMemo(() => {
    if (!anchorEl) return { left: 100, top: 100 };
    const rect = anchorEl.getBoundingClientRect();
    return { left: rect.right + 8, top: rect.top };
  }, [anchorEl]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    fetch('http://127.0.0.1:8000/parameters')
      .then((r) => r.json())
      .then((data) => {
        const scope = isGlobal ? data.global : data.local;
        setDescriptions({ global: data.global?.descriptions || {}, local: data.local?.descriptions || {} });
        const current = {};
        allKeys.forEach((k) => {
          current[k] = scope.values?.[k] ?? '';
        });
        setValues(current);
        setInitialValues(current);
      })
      .catch((e) => setError('Failed to load parameters'))
      .finally(() => setLoading(false));
  }, [open, isGlobal, allKeys]);

  const hasChanges = useMemo(() => {
    const keysList = Object.keys(values || {});
    return keysList.some((k) => String(values[k]) !== String(initialValues[k]));
  }, [values, initialValues]);

  const handleConfirm = () => {
    setError('');
    const updates = Object.keys(values).map((k) => ({ key: k, value: parseFloat(values[k]) }));
    if (updates.some((u) => Number.isNaN(u.value))) {
      setError('Please enter valid numeric values');
      return;
    }
    const url = isGlobal ? 'http://127.0.0.1:8000/parameters/global' : 'http://127.0.0.1:8000/parameters/local';
    fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    })
      .then((r) => {
        if (!r.ok) throw new Error('Update failed');
        return r.json();
      })
      .then(() => onClose?.())
      .catch(() => setError('Failed to update parameter(s)'));
  };

  if (!open) return null;

  return (
    <Panel left={position.left} top={position.top} onClose={onClose}>
      <div style={{ fontWeight: 'bold', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{Array.isArray(featureName) ? featureName.join(', ') : featureName}</span>
        <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: '#b8c2cc', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>
      {loading ? (
        <div style={{ color: '#b8c2cc' }}>Loading…</div>
      ) : (
        <>
          {/* Render one block per feature */}
          {featureConfigs.map((cfg, idx) => {
            const scope = isGlobal ? descriptions.global : descriptions.local;
            const desc = scope?.[cfg.normalized] || '';
            const k = cfg.keys || [];
            return (
            <div key={`${cfg.name}-${idx}`} style={{ marginTop: idx === 0 ? 0 : 12, paddingTop: idx === 0 ? 0 : 12, borderTop: idx === 0 ? 'none' : '1px solid #3a3f4b' }}>
              <div style={{ color: '#b8c2cc', lineHeight: 1.3 }}>{desc}</div>
                {k.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {k.map((paramKey) => (
                      <NumericField
                        key={paramKey}
                        label={paramKey}
                        value={values[paramKey] ?? ''}
                        onChange={(v) => setValues((prev) => ({ ...prev, [paramKey]: v }))}
                      />
                    ))}
                  </div>
                )}
                {k.length === 0 && (
                  <div style={{ color: '#8fa3b0', fontSize: 12, marginTop: 8 }}>This feature has no editable parameters.</div>
                )}
              </div>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <div style={{ color: '#8fa3b0', fontSize: 12 }}>After changing parameters, click "Update Matches" to re-run.</div>
            <button onClick={handleConfirm} disabled={!hasChanges} style={{ background: hasChanges ? '#42657E' : '#2f3e47', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: hasChanges ? 'pointer' : 'not-allowed', fontWeight: 'bold' }}>Confirm</button>
          </div>
        </>
      )}
      {error && <div style={{ color: '#ff6b6b', marginTop: 8 }}>{error}</div>}
    </Panel>
  );
};

export default FeatureParamPopover;


