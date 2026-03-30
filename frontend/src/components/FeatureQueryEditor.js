import React, { useCallback, useState, useEffect } from "react";
import { useDrag, useDrop, DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import "./FeatureQueryEditor.css";
import FeatureParamPopover from "./FeatureParamPopover";
import { isGlobalFeature } from "../featureMeta";

const ALL_LOCAL_FEATURES = [
  "rising", "falling", "concave", "convex", "linear", "nonlinear", "constant", "smooth", "noisy", "complex", "simple", "spiky", "dropout", "periodic", "aperiodic", "symmetric", "asymmetric", "step", "no-step", "high_amplitude", "low_amplitude", "high-volume", "low-volume"
];

// Helper function to get the correct image filename for each feature
const getFeatureImageName = (featureName) => {
  const imageMap = {
    "non-linear": "nonlinear",
    "high-amplitude": "high_ampltude", 
    "low-amplitude": "low_amplitude",
    "high-volume": "high_volume",
    "low-volume": "low_volume"
  };
  return imageMap[featureName] || featureName;
};

const ALL_GLOBAL_FEATURES = [
  "high", "low", "typical", "unusual"
];

const ItemType = "FEATURE";

const DraggableFeature = ({ feature, index, moveFeature, removeFeature, onClick }) => {
  const [, ref] = useDrag({
    type: ItemType,
    item: { index },
  });

  const [, drop] = useDrop({
    accept: ItemType,
    hover: (draggedItem) => {
      if (draggedItem.index !== index) {
        moveFeature(draggedItem.index, index);
        draggedItem.index = index;
      }
    },
  });

  // Display all features in the array separated by commas
  const displayText = Array.isArray(feature) ? feature.join(', ') : feature;

  return (
    <div ref={(node) => ref(drop(node))} className="draggable-feature" onClick={(e) => onClick?.(e, feature)}>
      {displayText}
      <span onClick={(e) => { e.stopPropagation(); removeFeature(index); }} className="remove-feature">×</span>
    </div>
  );
};

const FeatureQueryEditor = ({ featureDescriptions, updateQuery, setMatchedSegments, windowLength }) => {
  console.log('[FeatureQueryEditor] Component called with windowLength:', windowLength);
  
  const [localFeatures, setLocalFeatures] = useState([]);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addMenuAnchor, setAddMenuAnchor] = useState(null);
  const [globalFeatures, setGlobalFeatures] = useState([]);
  const [showAddGlobalMenu, setShowAddGlobalMenu] = useState(false);
  const [globalMenuAnchor, setGlobalMenuAnchor] = useState(null);
  const [popover, setPopover] = useState({ open: false, featureName: '', type: 'local', anchorEl: null });

  useEffect(() => {
    if (featureDescriptions?.local) {
      // Always keep as array of arrays
      const extractedLocal = featureDescriptions.local.map(f => Array.isArray(f) ? f : [f]);
      if (JSON.stringify(extractedLocal) !== JSON.stringify(localFeatures)) {
        setLocalFeatures(extractedLocal);
      }
    }
  }, [featureDescriptions]);

  // Sync global features from props
  useEffect(() => {
    if (featureDescriptions?.global) {
      setGlobalFeatures(featureDescriptions.global.map(f => (Array.isArray(f) ? f[0] : f)));
    }
  }, [featureDescriptions]);

  // Debug: Log local and global features whenever they change
  useEffect(() => {
    console.log('[DEBUG] localFeatures:', localFeatures);
    console.log('[DEBUG] globalFeatures:', globalFeatures);
  }, [localFeatures, globalFeatures]);

  const moveFeature = (dragIndex, hoverIndex) => {
    setLocalFeatures((prevFeatures) => {
      const updatedFeatures = [...prevFeatures];
      const [movedFeature] = updatedFeatures.splice(dragIndex, 1);
      updatedFeatures.splice(hoverIndex, 0, movedFeature);
      return updatedFeatures;
    });
  };

  const removeFeature = useCallback((index) => {
    setLocalFeatures((prevFeatures) => prevFeatures.filter((_, i) => i !== index));
  }, []);

  // Remove global feature
  const removeGlobalFeature = (index) => {
    setGlobalFeatures(prev => prev.filter((_, i) => i !== index));
  };
  const openPopoverFor = (event, feature, type) => {
    setPopover({ open: true, featureName: feature, type, anchorEl: event.currentTarget });
  };

  const closePopover = () => setPopover({ open: false, featureName: '', type: 'local', anchorEl: null });

  // Add feature handler
  const handleAddFeature = (feature) => {
    setLocalFeatures(prev => [...prev, [feature]]);
    setShowAddMenu(false);
  };

  // Add global feature
  const handleAddGlobalFeature = (feature) => {
    setGlobalFeatures(prev => [...prev, feature]);
    setShowAddGlobalMenu(false);
  };

  const sendNewQuery = (query) => {
    console.log("new query:", query);

    fetch("http://127.0.0.1:8000/user-query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: query,
        window_length: windowLength,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        console.log("features:", data);
        updateQuery(data["Feature Descriptions"]);
        setMatchedSegments(data["Matched Segments"]);
      })
      .catch((error) => console.error("Error while query:", error));
  };

  const runAutoMatching = () => {
    console.log("🚀 Running auto-matching with manually edited features:", localFeatures);
  
    const finalWindowLength = windowLength || 6;  // Use same logic as handleSubmit
    const sentFeatures = {
      global: globalFeatures || [],
      local: localFeatures || [],
    };

    fetch("http://127.0.0.1:8000/user-query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "",
        window_length: windowLength,
        features: {
          global: globalFeatures || [],
          local: localFeatures || [],
        },
      }),
    })
    .then((response) => response.json())
    .then((data) => {
        // Debug: Log full backend response
        console.log('[DEBUG] Backend response (Update Matches):', data);
        if (!data || !data["Matched Segments"]) {
          console.warn("matched segments data is missing or empty");
          // Clear matched segments when no data is returned
          setMatchedSegments([]);
          return;
        }
        // Only update local/global features if backend response is different
        const backendLocal = data["Feature Descriptions"]?.local?.map(f => Array.isArray(f) ? f : [f]) || [];
        const backendGlobal = data["Feature Descriptions"]?.global || [];
        if (JSON.stringify(backendLocal) !== JSON.stringify(localFeatures)) {
          setLocalFeatures(backendLocal);
        }
        if (JSON.stringify(backendGlobal) !== JSON.stringify(globalFeatures)) {
          setGlobalFeatures(backendGlobal);
        }
        // Always update matchedSegments, even if empty, to clear previous results
        setMatchedSegments(data["Matched Segments"] || []);
    })
    .catch((error) => console.error("Error with matching redo:", error));
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="feature-query-container">

      <div className="feature-query-header">
        <h2 style={{ fontSize: '1.5em', fontWeight: 'bold', margin: '0 0 12px 0' }}>Feature Descriptions</h2>
        <button onClick={runAutoMatching} className="update-query-btn" style={{ fontSize: '1.2em', padding: '10px 20px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', gap: '10px', borderRadius: '12px' }}>
          <i className="fas fa-sync-alt" style={{ fontSize: '1.5em' }}></i>
          <span style={{ fontWeight: 'bold', fontSize: '1em' }}>Update Matches</span>
        </button>
      </div>

        <h3 style={{ fontSize: '1.3em', fontWeight: 'bold' }}>Global Features:</h3>
        {globalFeatures.length ? (
          <div className="global-features-container" style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
            {globalFeatures.map((feature, index) => (
              <div key={index} className="global-feature-item" style={{ background: '#23272f', color: '#fff', borderRadius: '18px', padding: '6px 18px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={(e) => openPopoverFor(e, feature, 'global')}>
                {feature}
                <span onClick={(e) => { e.stopPropagation(); removeGlobalFeature(index); }} style={{ color: '#ff4d4f', cursor: 'pointer', fontWeight: 'bold', marginLeft: '4px' }}>×</span>
              </div>
            ))}
            <button
              className="add-feature-btn"
              style={{ marginLeft: '8px', fontSize: '1.3em', padding: '0 18px', borderRadius: '18px', border: 'none', background: '#42657E', color: '#fff', fontWeight: 'bold', cursor: 'pointer', height: '36px', width: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
              onClick={e => { setShowAddGlobalMenu(v => !v); setGlobalMenuAnchor(e.currentTarget); }}
              title="Add global feature"
            >
              +
            </button>
            {showAddGlobalMenu && globalMenuAnchor && (
              <div className="add-feature-dropdown" style={{ 
                position: 'fixed', 
                zIndex: 10, 
                background: '#23272f', 
                color: '#fff', 
                border: '1px solid #444a57', 
                borderRadius: '6px', 
                left: `${globalMenuAnchor.getBoundingClientRect().right + 5}px`,
                top: `${globalMenuAnchor.getBoundingClientRect().top}px`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.25)', 
                minWidth: '180px',
                maxHeight: '800px',
                overflowY: 'auto'
              }}>
                {ALL_GLOBAL_FEATURES.filter(f => !globalFeatures.includes(f)).length === 0 ? (
                  <div style={{ padding: '8px 16px', color: '#888', fontStyle: 'italic' }}>No more features</div>
                ) : (
                  ALL_GLOBAL_FEATURES.filter(f => !globalFeatures.includes(f)).map(f => (
                    <div
                      key={f}
                      style={{ padding: '8px 16px', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 0.15s' }}
                      onClick={() => handleAddGlobalFeature(f)}
                      onMouseDown={e => e.preventDefault()}
                      onMouseOver={e => e.currentTarget.style.background = '#444a57'}
                      onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {f}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="global-features-container" style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
            <p>No global features</p>
            <button
              className="add-feature-btn"
              style={{ marginLeft: '8px', fontSize: '1.3em', padding: '0 18px', borderRadius: '18px', border: 'none', background: '#42657E', color: '#fff', fontWeight: 'bold', cursor: 'pointer', height: '36px', width: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
              onClick={e => { setShowAddGlobalMenu(v => !v); setGlobalMenuAnchor(e.currentTarget); }}
              title="Add global feature"
            >
              +
            </button>
            {showAddGlobalMenu && globalMenuAnchor && (
              <div className="add-feature-dropdown" style={{ 
                position: 'fixed', 
                zIndex: 10, 
                background: '#23272f', 
                color: '#fff', 
                border: '1px solid #444a57', 
                borderRadius: '6px', 
                left: `${globalMenuAnchor.getBoundingClientRect().right + 5}px`,
                top: `${globalMenuAnchor.getBoundingClientRect().top}px`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.25)', 
                minWidth: '180px',
                maxHeight: '800px',
                overflowY: 'auto'
              }}>
                {ALL_GLOBAL_FEATURES.filter(f => !globalFeatures.includes(f)).length === 0 ? (
                  <div style={{ padding: '8px 16px', color: '#888', fontStyle: 'italic' }}>No more features</div>
                ) : (
                  ALL_GLOBAL_FEATURES.filter(f => !globalFeatures.includes(f)).map(f => (
                    <div
                      key={f}
                      style={{ padding: '8px 16px', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 0.15s' }}
                      onClick={() => handleAddGlobalFeature(f)}
                      onMouseDown={e => e.preventDefault()}
                      onMouseOver={e => e.currentTarget.style.background = '#444a57'}
                      onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {f}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        <h3 style={{ fontSize: '1.3em', fontWeight: 'bold' }}>Local Features:</h3>
        {localFeatures.length ? (
          <div className="local-features-container" style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
            {localFeatures.map((feature, index) => (
              <React.Fragment key={index}>
                <DraggableFeature feature={feature} index={index} moveFeature={moveFeature} removeFeature={removeFeature} onClick={(e, f) => openPopoverFor(e, f, 'local')} />
                {index < localFeatures.length - 1 && <span className="feature-arrow">→</span>}
              </React.Fragment>
            ))}
            {/* + button to add new feature */}
            <button
              className="add-feature-btn"
              style={{
                marginLeft: '8px',
                fontSize: '1.3em',
                padding: '0 18px',
                borderRadius: '18px',
                border: 'none',
                background: '#42657E',
                color: '#fff',
                fontWeight: 'bold',
                cursor: 'pointer',
                height: '36px',
                width: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
              }}
              onClick={e => { setShowAddMenu(v => !v); setAddMenuAnchor(e.currentTarget); }}
              title="Add local feature"
            >
              +
            </button>
            {/* Dropdown menu for adding features */}
            {showAddMenu && addMenuAnchor && (
              <div className="add-feature-dropdown" style={{ 
                position: 'fixed', 
                zIndex: 9999, 
                background: '#23272f', 
                color: '#fff', 
                border: '1px solid #444a57', 
                borderRadius: '6px', 
                left: `${addMenuAnchor.getBoundingClientRect().right + 5}px`,
                top: `${addMenuAnchor.getBoundingClientRect().top}px`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.25)', 
                minWidth: '180px',
                maxHeight: '800px',
                overflowY: 'auto'
              }}>
                {ALL_LOCAL_FEATURES.map(f => (
                  <div
                    key={f}
                    style={{ 
                      padding: '8px 16px', 
                      cursor: 'pointer', 
                      whiteSpace: 'nowrap', 
                      transition: 'background 0.15s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                    onClick={() => handleAddFeature(f)}
                    onMouseDown={e => e.preventDefault()}
                    onMouseOver={e => e.currentTarget.style.background = '#444a57'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <img 
                      src={`/feature-images/${getFeatureImageName(f)}.png`} 
                      alt={f}
                      style={{ width: '110px', height: '66px', objectFit: 'contain' }}
                    />
                    {f}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="local-features-container" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <p>No local features</p>
            <button
              className="add-feature-btn"
              style={{
                marginLeft: '8px',
                fontSize: '1.3em',
                padding: '0 18px',
                borderRadius: '18px',
                border: 'none',
                background: '#42657E',
                color: '#fff',
                fontWeight: 'bold',
                cursor: 'pointer',
                height: '36px',
                width: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
              }}
              onClick={e => { setShowAddMenu(v => !v); setAddMenuAnchor(e.currentTarget); }}
              title="Add local feature"
            >
              +
            </button>
            {showAddMenu && addMenuAnchor && (
              <div className="add-feature-dropdown" style={{ 
                position: 'fixed', 
                zIndex: 9999, 
                background: '#23272f', 
                color: '#fff', 
                border: '1px solid #444a57', 
                borderRadius: '6px', 
                left: `${addMenuAnchor.getBoundingClientRect().right + 5}px`,
                top: `${addMenuAnchor.getBoundingClientRect().top}px`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.25)', 
                minWidth: '180px',
                maxHeight: '800px',
                overflowY: 'auto'
              }}>
                {ALL_LOCAL_FEATURES.map(f => (
                  <div
                    key={f}
                    style={{ 
                      padding: '8px 16px', 
                      cursor: 'pointer', 
                      whiteSpace: 'nowrap', 
                      transition: 'background 0.15s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                    onClick={() => handleAddFeature(f)}
                    onMouseDown={e => e.preventDefault()}
                    onMouseOver={e => e.currentTarget.style.background = '#444a57'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <img 
                      src={`/feature-images/${getFeatureImageName(f)}.png`} 
                      alt={f}
                      style={{ width: '110px', height: '66px', objectFit: 'contain' }}
                    />
                    {f}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <FeatureParamPopover open={popover.open} featureName={popover.featureName} type={popover.type} anchorEl={popover.anchorEl} onClose={closePopover} />
    </DndProvider>
  );
};

export default FeatureQueryEditor;
