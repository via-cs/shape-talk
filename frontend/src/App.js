import React, { useState, useEffect, useRef, Component } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import axios from 'axios';
import './App.css';
import * as d3 from 'd3';
import TaskBar from './components/TaskBar';
import FeatureQueryEditor from './components/FeatureQueryEditor';
import ChatBox from './components/ChatBox';
import CanvasDraw from "react-canvas-draw";
//import { Button, Slider } from "@mui/material";
// import Canvas from './Canvas'

const LOCAL_FEATURE_COLORS = {
  rising: '#e74c3c', // red
  falling: '#3498db', // blue
  concave: '#9b59b6',
  convex: '#f1c40f',
  linear: '#2ecc71',
  'non-linear': '#e67e22',
  constant: '#95a5a6',
  smooth: '#16a085',
  noisy: '#7f8c8d',
  complex: '#34495e',
  simple: '#27ae60',
  spiky: '#c0392b',
  dropout: '#d35400',
  periodic: '#8e44ad',
  aperiodic: '#bdc3c7',
  symmetric: '#2980b9',
  asymmetric: '#f39c12',
  step: '#1abc9c',
  'no-step': '#7f8c8d',
  'high-amplitude': '#e84393',
  'low-amplitude': '#00b894',
  'high-volume': '#636e72',
  'low-volume': '#b2bec3',
};

// Deterministic color for composite labels or unknown features
const getColorForFeature = (label) => {
  if (LOCAL_FEATURE_COLORS[label]) return LOCAL_FEATURE_COLORS[label];
  // Normalize composite labels (e.g., "linear, rising") to consistent key
  const parts = String(label).split(',').map(s => s.trim()).filter(Boolean).sort();
  const normalized = parts.join(', ');
  if (LOCAL_FEATURE_COLORS[normalized]) return LOCAL_FEATURE_COLORS[normalized];
  // Hash-based fallback color palette
  const palette = ['#E57373', '#64B5F6', '#81C784', '#FFD54F', '#4DB6AC', '#BA68C8', '#A1887F', '#90A4AE', '#F06292', '#4FC3F7'];
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
};

class VisualizationErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Visualization Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-container" style={{ 
          padding: '20px', 
          margin: '10px', 
          backgroundColor: '#ffebee',
          border: '1px solid #ef9a9a',
          borderRadius: '4px',
          color: '#c62828'
        }}>
          <h3>Visualization Error</h3>
          <p>There was an error loading the visualization. Please try refreshing the page.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [isDrawing, setIsDrawing] = useState(false);

  const canvasRef = useRef(null);
  const [query, setQuery] = useState('');
  const [featureDescriptions, setFeatureDescriptions] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  //const [predictedQuery, setPredictedQuery] = useState('');
  const [chartData, setChartData] = useState(null);
  const [matchedSegments, setMatchedSegments] = useState([]);
  const [sketchMatchedSegments, setSketchMatchedSegments] = useState([]);
  const [selectedSegments, setSelectedSegments] = useState([]);
  const [windowLength, setWindowLength] = useState(6);
  const [topK, setTopK] = useState(5);
  const [sketchData, setSketchData] = useState([]);
  // const [brushRadius, setBrushRadius] = useState(4);
  const [delta, setDelta] = useState(0.2); 
  const [showOriginalSegments, setShowOriginalSegments] = useState(true);
  const svgRef = useRef();
  const fullChartRef = useRef(null);
  const [chartSize, setChartSize] = useState({
      width: window.innerWidth * 0.9,
      height: Math.min(window.innerHeight * 0.4, 400)
  });
  const [tool, setTool] = useState("pen");
  const [strokes, setStrokes] = useState([]);
  const [paths, setPaths] = useState([]);
  const [currentPath, setCurrentPath] = useState([]);
  const toolRef = useRef("pen");
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  //const [selectedFile, setSelectedFile] = useState(null);

  const matchedSegmentsRef = useRef(null);
  const sketchMatchedSegmentsRef = useRef(null);

  const [selectedSketchSegments, setSelectedSketchSegments] = useState([]);

  // Add new state for stroke lengths
  const [strokeLengths, setStrokeLengths] = useState([]);

  // Add toggle states for rectangle visibility
  const [showGreySegments, setShowGreySegments] = useState(false);   // Grey rectangles
  const [showQbTMatches, setShowQbTMatches] = useState(true);       // Yellow rectangles
  const [showQbSMatches, setShowQbSMatches] = useState(true);       // Red rectangles

  const handleInputChange = (event) => {
    setQuery(event.target.value);
  };

const isSubmitting = useRef(false);

const handleSubmit = async (event) => {
  event.preventDefault();
  event.stopPropagation();

  console.log("🔄 Query Submission State:", {
    isCurrentlySubmitting: isSubmitting.current,
    currentQuery: query,
    currentWindowLength: windowLength,
    currentMatchedSegments: matchedSegments.length,
    timestamp: new Date().toISOString()
  });

  if (isSubmitting.current) {
    console.warn("⚠️ Previous query still processing, skipping new submission");
    return;
  }

  isSubmitting.current = true;
  const finalWindowLength = windowLength || 6;

  try {
    console.log("🚀 Starting new query submission:", {
      query,
      windowLength: finalWindowLength,
      timestamp: new Date().toISOString()
    });

    setLoading(true);
    setError('');

    console.log("📤 Sending request to backend...");
    const response = await axios.post('http://127.0.0.1:8000/user-query', { 
      query, 
      window_length: finalWindowLength
    });
    
    // Debug: Log full backend response
    console.log('[DEBUG] Backend response:', response.data);
    
    console.log("📥 Received backend response:", {
      featureDescriptions: response.data['Feature Descriptions'],
      matchedSegmentsCount: response.data['Matched Segments']?.length,
      timestamp: new Date().toISOString()
    });

    // Track state updates
    console.log("🔄 Updating feature descriptions and matched segments...");
    setFeatureDescriptions(response.data['Feature Descriptions'] || '');
    // Always update matchedSegments, even if empty, to clear previous results
    setMatchedSegments(response.data['Matched Segments'] || []);
    
    console.log("✅ Query processing completed successfully");

  } catch (err) {
    console.error("❌ Error during query submission:", {
      error: err,
      errorMessage: err.message,
      errorStack: err.stack,
      errorResponse: err.response?.data,
      timestamp: new Date().toISOString()
    });
    setError('Failed to fetch feature descriptions');
  } finally {
    console.log("🏁 Query submission cleanup");
    setLoading(false);
    isSubmitting.current = false;
  }
};


  

const isSubmittingSketch = useRef(false);

const handleSketchSubmit = async () => {
  // Add detailed logging of sketch data
  console.log("📊 Submitting Sketch Query with data:", {
    rawSketchData: sketchData,
    numberOfPoints: sketchData.length,
    pointsSample: sketchData.slice(0, 5), // Show first 5 points as sample
    dataStructure: sketchData.length > 0 ? Object.keys(sketchData[0]) : [],
    timestamp: new Date().toISOString()
  });

  if (isSubmittingSketch.current) {
    console.log("🚫 Sketch submission already in progress, skipping...");
    return;
  }
  isSubmittingSketch.current = true;

  if (!Array.isArray(sketchData)) {
    console.error("❌ Invalid sketch data format:", sketchData);
    alert("Invalid sketch data format. Please redraw your sketch.");
    isSubmittingSketch.current = false;
    return;
  }

  // Z-score normalization for sketch points
  const validPoints = sketchData
    .filter(point => point && typeof point === "object" && "x" in point && "y" in point)
    .map(point => ({
      x: point.x,
      y: svgRef.current.clientHeight - point.y  // Invert y coordinate
    }));
  
  if (validPoints.length === 0) {
    console.error("❌ No valid sketch points found");
    alert("No valid sketch points. Please redraw your sketch.");
    isSubmittingSketch.current = false;
    return;
  }

  // Calculate mean and standard deviation for y values
  const yValues = validPoints.map(p => p.y);
  const mean = yValues.reduce((sum, y) => sum + y, 0) / yValues.length;
  const std = Math.sqrt(yValues.reduce((sum, y) => sum + Math.pow(y - mean, 2), 0) / yValues.length);

  // Apply Z-score normalization
  const validatedSketchData = validPoints.map((point, index) => ({
    x: index / (validPoints.length - 1),  // Normalize x to [0,1] for sequence
    y: std === 0 ? 0 : (point.y - mean) / std  // Z-score normalization for y
  }));

  console.log("📊 Sketch Submission Details:");
  console.log("- Raw Sketch Data:", sketchData);
  console.log("- Z-normalized Points:", validatedSketchData);
  console.log("- Number of Points:", validatedSketchData.length);
  console.log("- Mean:", mean);
  console.log("- Standard Deviation:", std);
  console.log("- Top K Value:", topK);
  console.log("- Window Length:", windowLength);

  if (validatedSketchData.length === 0) {
    console.error("❌ No valid sketch points found after validation");
    alert("Sketch data is invalid. Please try again.");
    isSubmittingSketch.current = false;
    return;
  }

  try {
    console.log("🔍 Sending sketch query to backend...");
    const response = await axios.post(
      "http://127.0.0.1:8000/query-sketch/",
      { 
        sketch: validatedSketchData, 
        top_k: topK,
        window_length: windowLength || 6  // Changed from 5 to 6
      },
      { headers: { "Content-Type": "application/json" } }
    );

    console.log("✅ Received backend response:", response.data);

    if (response.status >= 400) {
      console.error("❌ Query failed with status:", response.status);
      alert("Sketch query failed: " + JSON.stringify(response.data));
    } else {
      const transformedData = response.data.data.map((segment, segmentIndex) => {
        console.log(`Processing segment ${segmentIndex}:`, segment);
        
        return segment.map((point, offset) => {
          // Find the corresponding date in chartData based on the segment's start index
          const startIndex = chartData.findIndex(d => 
            new Date(d.Date).getTime() === new Date(segment[0].Date).getTime()
          );
          const globalIndex = startIndex + offset;
          const chartPoint = chartData?.[globalIndex];

          console.log(`Point ${offset} details:`, {
            point,
            globalIndex,
            chartPoint,
            hasDate: chartPoint?.Date != null,
            hasZNorm: point?.ZNormalizedValue != null,
            hasNorm: point?.NormalizedValue != null
          });

          if (!chartPoint || chartPoint.Date == null || (point.ZNormalizedValue == null && point.NormalizedValue == null)) {
            console.log(`⚠️ Skipping invalid point at offset ${offset}`);
            return null;
          }

          return {
            Value: chartPoint.Value, // use original (absolute) value for visualization
            Date: chartPoint.Date,
            NormalizedValue: point.ZNormalizedValue ?? point.NormalizedValue ?? NaN, // keep normalized for reference
            featureType: "sketch"
          };
        }).filter(Boolean);
      });

      console.log("🎯 Final transformed segments:", transformedData);
      setSketchMatchedSegments(transformedData);
    }

  } catch (error) {
    console.error("❌ Sketch query failed:", error);
    console.error("Error details:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    alert("Sketch query failed: " + (error.response?.data ? JSON.stringify(error.response.data) : error.message));
  } finally {
    console.log("🏁 Sketch submission completed");
    isSubmittingSketch.current = false;
  }
};

useEffect(() => { //current added useeffect
  const finishDrawing = () => {
    setIsDrawing(false);
    setCurrentPath([]);
  };

  window.addEventListener("mouseup", finishDrawing);
  return () => window.removeEventListener("mouseup", finishDrawing);
}, []);

const drawFullChart = (data, matchedSegments, sketchMatchedSegments, showGreySegments, showQbTMatches, showQbSMatches) => {
    console.log("Drawing chart with selections:", {
        qbtSelections: selectedSegments.length,
        qbsSelections: selectedSketchSegments.length
    });

    d3.select("#fullChart").selectAll("*").remove();
    const svg = d3.select(fullChartRef.current);
    if (!svg.node()) {
        console.error("SVG container not found, skipping chart draw.");
        return;
    }

    svg.selectAll("*").remove();

    if (!data || data.length === 0) {
        console.warn("No data available for chart.");
        return;
    }

    // Get the actual SVG width from the DOM
    const svgNode = svg.node();
    const svgWidth = svgNode ? svgNode.clientWidth || svgNode.width.baseVal.value : chartSize.width;
    const svgHeight = svgNode ? svgNode.clientHeight || svgNode.height.baseVal.value : chartSize.height;

    const margin = { top: 20, right: 20, bottom: 40, left: 80 };
    const width = svgWidth - margin.left - margin.right;
    const height = svgHeight - margin.top - margin.bottom;

    svg.attr('width', svgWidth)
       .attr('height', svgHeight);

    const x = d3.scaleTime().range([0, width]);
    const y = d3.scaleLinear().range([height, 0]);

    x.domain(d3.extent(data, d => new Date(d.Date)));
    y.domain([d3.min(data, d => d.Value), d3.max(data, d => d.Value)]);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const line = d3.line()
        .x(d => x(new Date(d.Date)))
        .y(d => y(d.Value));

    const xAxisGroup = g.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(x));

    const yAxisGroup = g.append('g')
        .call(d3.axisLeft(y));

    const path = g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', 'steelblue')
        .attr('stroke-width', 2.5)
        .attr('d', line);

    // Combine all segments for visualization
    const allSegments = [
      ...matchedSegments.map(seg => Array.isArray(seg) ? seg : seg.points),
      ...sketchMatchedSegments.map(seg => Array.isArray(seg) ? seg : seg.points)
    ];

    let segmentBars = g
        .selectAll(".segment-highlight")
        .data(allSegments.filter(d => {
          const isQbTSelected = selectedSegments.some(s => s[0]?.Date === d[0]?.Date);
          const isQbSSelected = selectedSketchSegments.some(s => s[0]?.Date === d[0]?.Date);
          const isSketchMatch = sketchMatchedSegments.some(seg => seg[0]?.Date === d[0]?.Date);
          // Both dark and light red (QbS selected and QbS match) are controlled by showQbSMatches
          if ((isQbSSelected || isSketchMatch) && showQbSMatches) return true;
          if (isQbTSelected && showQbTMatches) return true;
          if (!isQbTSelected && !isQbSSelected && !isSketchMatch && showGreySegments) return true;
          return false;
        }))
        .enter()
        .append("rect")
        .attr("class", (d) =>
            d.featureType === "sketch" ? "sketch-highlight" : "segment-highlight"
        )
        .style("fill", (d) => {
            const isQbTSelected = selectedSegments.some(s => s[0]?.Date === d[0]?.Date);
            const isQbSSelected = selectedSketchSegments.some(s => s[0]?.Date === d[0]?.Date);
            const isSketchMatch = sketchMatchedSegments.some(seg => seg[0]?.Date === d[0]?.Date);
            
            if (isQbTSelected && isQbSSelected) {
                return "rgba(220, 53, 69, 0.5)"; // Brighter red with higher opacity for both selections
            } else if (isQbTSelected) {
                return "rgba(255, 215, 0, 0.3)"; // Yellow for QbT selection
            } else if (isQbSSelected) {
                return "rgba(220, 53, 69, 0.4)"; // Brighter red for QbS selection
            }
            // Different default color based on whether it's a QbS or QbT segment
            return isSketchMatch ? "rgba(220, 53, 69, 0.15)" : "rgba(220, 220, 220, 0.2)";
        })
        .style("stroke", (d) => {
            const isQbTSelected = selectedSegments.some(s => s[0]?.Date === d[0]?.Date);
            const isQbSSelected = selectedSketchSegments.some(s => s[0]?.Date === d[0]?.Date);
            const isSketchMatch = sketchMatchedSegments.some(seg => seg[0]?.Date === d[0]?.Date);
            
            if (isQbTSelected && isQbSSelected) {
                return "#dc3545"; // Solid bright red for both selections
            } else if (isQbTSelected) {
                return "rgb(255, 215, 0)"; // Yellow for QbT selection
            } else if (isQbSSelected) {
                return "#dc3545"; // Solid bright red for QbS selection
            }
            // Different default border color based on whether it's a QbS or QbT segment
            return isSketchMatch ? "rgba(220, 53, 69, 0.3)" : "rgba(170, 170, 170, 0.5)";
        })
        .style("stroke-width", (d) => {
            const isQbTSelected = selectedSegments.some(s => s[0]?.Date === d[0]?.Date);
            const isQbSSelected = selectedSketchSegments.some(s => s[0]?.Date === d[0]?.Date);
            return (isQbTSelected || isQbSSelected) ? "2px" : "1px";
        })
        .style("opacity", 1)
        .style("cursor", "pointer")
        .on("click", (event, d) =>
            zoomToSegment(new Date(d[0].Date), new Date(d[d.length - 1].Date))
        );

    function updateSegmentPositions(newX) {
        segmentBars
            .attr('x', d => {
                if (!d[0]?.Date || !d[d.length - 1]?.Date) return -1000;
                const startX = newX(new Date(d[0].Date));
                return isNaN(startX) ? -1000 : startX;
            })
            .attr('width', d => {
                if (!d[0]?.Date || !d[d.length - 1]?.Date) return 0;
                const endX = newX(new Date(d[d.length - 1].Date));
                const startX = newX(new Date(d[0].Date));
                const width = endX - startX;
                return isNaN(width) || width < 0 ? 1 : width;
            })
            .attr('y', y(d3.max(data, d => d.Value)))
            .attr('height', height - y(d3.max(data, d => d.Value)));
    }

    const zoom = d3.zoom()
        .scaleExtent([0.1, 20])  // Allow zooming out more and in more
        .translateExtent([[0, 0], [width, height]])
        .extent([[0, 0], [width, height]])  // Define the zoomable area
        .on("zoom", (event) => {
            const newX = event.transform.rescaleX(x);
            xAxisGroup.call(d3.axisBottom(newX));
            path.attr("d", line.x(d => newX(new Date(d.Date))));
            updateSegmentPositions(newX);
        });

    svg.call(zoom);

    function zoomToSegment(startDate, endDate) {
        if (!startDate || !endDate) return;
        svg.transition().duration(750).call(
            zoom.transform,
            d3.zoomIdentity.scale(width / (x(endDate) - x(startDate))).translate(-x(startDate), 0)
        );
    }

    updateSegmentPositions(x);

    // Make axis tick labels larger and more visible
    xAxisGroup.selectAll('text')
      .style('font-size', '20px')
      .style('fill', '#fff')
      .style('font-weight', 'bold');
    yAxisGroup.selectAll('text')
      .style('font-size', '20px')
      .style('fill', '#fff')
      .style('font-weight', 'bold');
};


  // const handleSegmentClick = (segmentIndex) => {
  //   const modal = document.getElementById('annotation-modal');
  //   const modalTitle = document.getElementById('modal-title');
  //   const annotationInput = document.getElementById('annotation-input');
  //   const saveButton = document.getElementById('save-annotation');


  //   modalTitle.textContent = `Annotate Segment ${segmentIndex + 1}`;
  //   modal.style.display = 'block';

  //   saveButton.onclick = () => {
  //     const annotation = annotationInput.value;
  //     console.log(`Annotation for Segment ${segmentIndex + 1}:`, annotation);
  //     modal.style.display = 'none';
  //     annotationInput.value = '';
  //   };
  // };


  const visualizeMatchedSegments = (segments, windowLength) => {
    if (!segments || segments.length === 0) {
      console.warn("No segments to visualize");
      return;
    }

    const container = matchedSegmentsRef.current;
    if (!container) {
      console.warn("Container not ready");
      return;
    }

    // Clear existing content
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Create grid container with fixed layout
    const gridContainer = d3.select(container)
      .append("div")
      .style("display", "grid")
      .style("grid-template-columns", "repeat(auto-fit, minmax(250px, 1fr))")
      .style("gap", "30px")
      .style("padding", "20px 30px 20px 20px")
      .style("width", "calc(100% - 10px)")
      .style("max-width", "100%")
      .style("box-sizing", "border-box")
      .style("overflow", "hidden")
      .style("justify-items", "center")
      .style("justify-content", "center");

    segments.forEach((segmentObj, index) => {
      const segment = segmentObj.points;
      const localFeatures = segmentObj.local_features || [];
      const isSelected = selectedSegments.some(s => s[0]?.Date === segment[0]?.Date);

      // Define colors based on selection state
      const colors = {
        background: isSelected ? "#4A5568" : "#2E343A",
        border: isSelected ? "#FFD700" : "#464F57",
        stroke: isSelected ? "#FFD700" : "#8B9BA8",
        text: isSelected ? "#FFD700" : "#FFFFFF",
        hover: isSelected ? "#4A5568" : "#363C42"
      };

      const segmentContainer = gridContainer
        .append("div")
        .style("width", "100%")
        .style("min-height", "160px")
        .style("background-color", colors.background)
        .style("border", `2px solid ${colors.border}`)
        .style("border-radius", "8px")
        .style("padding", "12px")
        .style("cursor", "pointer")
        .style("position", "relative")
        .style("transition", "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)")
        .on("mouseover", function() {
          if (!isSelected) {
            d3.select(this)
              .style("transform", "translateY(-2px)")
              .style("box-shadow", "0 4px 12px rgba(0,0,0,0.2)")
              .style("background-color", colors.hover);
          }
        })
        .on("mouseout", function() {
          if (!isSelected) {
            d3.select(this)
              .style("transform", "translateY(0)")
              .style("box-shadow", "none")
              .style("background-color", colors.background);
          }
        })
        .on("click", function() {
          const element = d3.select(this);
          handleSegmentSelect(segmentObj);
          
          // Add click animation
          element
            .style("transform", "scale(0.95)")
            .transition()
            .duration(100)
            .style("transform", "scale(1.02)")
            .transition()
            .duration(100)
            .style("transform", "scale(1)");
        });

      // Add selection indicator with animation
      if (isSelected) {
        segmentContainer
          .append("div")
          .style("position", "absolute")
          .style("top", "10px")
          .style("right", "10px")
          .style("color", colors.stroke)
          .style("font-size", "16px")
          .style("opacity", "0")
          .html("&#10003;") // Checkmark symbol
          .transition()
          .duration(300)
          .style("opacity", "1");

        // Add highlight effect
        segmentContainer
          .style("box-shadow", `0 0 15px rgba(255, 215, 0, 0.2)`)
          .style("transform", "translateY(-2px)");
      }

      const svg = segmentContainer
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", "0 0 250 160")
        .attr("preserveAspectRatio", "xMidYMid meet");

      const margin = { top: 20, right: 20, bottom: 30, left: 40 };
      const width = 250 - margin.left - margin.right;
      const height = 160 - margin.top - margin.bottom;

      const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      // Add segment number with highlight if selected
      g.append("text")
        .attr("x", width / 2)
        .attr("y", -5)
        .attr("text-anchor", "middle")
        .style("fill", colors.text)
        .style("font-size", "12px")
        .style("font-weight", isSelected ? "bold" : "normal")
        .text(`Segment ${index + 1}`)
        .style("transition", "all 0.3s ease");

      const xScale = d3.scaleTime()
        .domain([
          d3.min(segment, d => new Date(d.Date)),
          d3.max(segment, d => new Date(d.Date))
        ])
        .range([0, width]);

      const yValues = segment.map(d => d.Value ?? d.NormalizedValue);
      const yScale = d3.scaleLinear()
        .domain([d3.min(yValues), d3.max(yValues)])
        .range([height, 0]);

      // Draw each sub-interval with its feature color and label
      localFeatures.forEach((sub, i) => {
        const { feature, start, end } = sub;
        const color = getColorForFeature(feature);
        const subPoints = segment.slice(start, end + 1);
        if (subPoints.length < 2) return;
        const line = d3.line()
          .x(d => xScale(new Date(d.Date)))
          .y(d => yScale(d.Value ?? d.NormalizedValue));
        g.append("path")
          .datum(subPoints)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", isSelected ? 3 : 2)
          .attr("d", line);
        // Add label at the middle of the sub-interval
        const midIdx = Math.floor((start + end) / 2);
        const midPoint = segment[midIdx];
        if (midPoint) {
          g.append("text")
            .attr("x", xScale(new Date(midPoint.Date)))
            .attr("y", yScale(midPoint.Value ?? midPoint.NormalizedValue) - 8)
            .attr("text-anchor", "middle")
            .style("fill", color)
            .style("font-size", "10px")
            .style("font-weight", "bold")
            .text(feature);
        }
      });

      // Draw white dashed lines between sub-intervals for visual continuity
      for (let i = 0; i < localFeatures.length - 1; i++) {
        const currentSub = localFeatures[i];
        const nextSub = localFeatures[i + 1];
        
        // Find the connection point between current and next sub-interval
        const currentEndPoint = segment[currentSub.end];
        const nextStartPoint = segment[nextSub.start];
        
        if (currentEndPoint && nextStartPoint) {
          const x1 = xScale(new Date(currentEndPoint.Date));
          const y1 = yScale(currentEndPoint.Value ?? currentEndPoint.NormalizedValue);
          const x2 = xScale(new Date(nextStartPoint.Date));
          const y2 = yScale(nextStartPoint.Value ?? nextStartPoint.NormalizedValue);
          
          g.append("line")
            .attr("x1", x1)
            .attr("y1", y1)
            .attr("x2", x2)
            .attr("y2", y2)
            .attr("stroke", "white")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "3,3")
            .attr("opacity", 0.7);
        }
      }

      // If no local features, draw the entire segment as a dashed line
      if (localFeatures.length === 0) {
        const line = d3.line()
          .x(d => xScale(new Date(d.Date)))
          .y(d => yScale(d.Value ?? d.NormalizedValue));
        
        g.append("path")
          .datum(segment)
          .attr("fill", "none")
          .attr("stroke", "#8B9BA8")  // Default gray color
          .attr("stroke-width", isSelected ? 3 : 2)
          .attr("stroke-dasharray", "5,5")  // Dashed pattern
          .attr("opacity", 0.8)
          .attr("d", line);
      }

      // Add axes with smooth color transition
      g.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(5))
        .style("color", colors.text)
        .style("transition", "color 0.3s ease");

      g.append("g")
        .call(d3.axisLeft(yScale).ticks(5))
        .style("color", colors.text)
        .style("transition", "color 0.3s ease");
    });
  };


  const handleSegmentSelect = (segmentObj) => {
    const segment = segmentObj.points || segmentObj; // fallback for array
    setSelectedSegments(prevSelected => {
      const isAlreadySelected = prevSelected.some(
        s => s[0]?.Date === segment[0]?.Date
      );
      const newSelection = isAlreadySelected
        ? prevSelected.filter(s => s[0]?.Date !== segment[0]?.Date)
        : [...prevSelected, segment];
      return newSelection;
    });
  };
  
  
  // const visualizeSketchMatchedSegments = (segments, windowLength) => { //draw the graph of sketched elements
  //   const container = d3.select("#sketch-matched-segments");

  //   if (container.empty()) {
  //       console.warn("Sketch matched segments container not found.");
  //       return;
  //   }

  //   container.selectAll("*").remove();

  //   setTimeout(() => {
  //       if (!segments || segments.length === 0) {
  //           console.warn("No sketch segments to render.");
  //           return;
  //       }

  //       const containerWidth = document.getElementById("sketch-matched-segments").clientWidth;///here is error
  //       const numColumns = 3;
  //       const segmentWidth = containerWidth / numColumns - 20;
  //       const segmentHeight = segmentWidth * 0.5;

  //       const margin = { top: 10, right: 10, bottom: 30, left: 40 };
  //       const width = segmentWidth - margin.left - margin.right;
  //       const height = segmentHeight - margin.top - margin.bottom;

  //       const rowContainer = container.append("div").attr("class", "segments-row-container");

  //       segments.forEach((segment, index) => {
  //           const limitedSegment = segment.slice(0, windowLength);

  //           // 🛡️ Safely filter only valid points
  //           const validPoints = limitedSegment
  //               .map((d, i) => d && d.Value != null ? { x: i, Value: d.Value } : null)
  //               .filter(d => d !== null);

  //           if (validPoints.length < 2) {
  //               console.warn(`Skipping segment ${index} due to insufficient valid points.`);
  //               return;
  //           }

  //           const segmentContainer = rowContainer
  //               .append("div")
  //               .attr("class", "segment-container")
  //               .style("width", `${segmentWidth}px`)
  //               .style("height", `${segmentHeight}px`);

  //           const svg = segmentContainer
  //               .append("svg")
  //               .attr("width", width + margin.left + margin.right)
  //               .attr("height", height + margin.top + margin.bottom)
  //               .append("g")
  //               .attr("transform", `translate(${margin.left},${margin.top})`);

  //           const yValues = validPoints.map(d => d.Value);

  //           const minY = d3.min(yValues);
  //           const maxY = d3.max(yValues);

  //           const xScale = d3.scaleLinear()
  //               .domain([0, validPoints.length - 1])
  //               .range([0, width]);

  //           const yScale = d3.scaleLinear()
  //               .domain([minY, maxY])
  //               .range([height, 0]);

  //           const line = d3.line()
  //               .x(d => xScale(d.x))
  //               .y(d => yScale(d.Value))
  //               .curve(d3.curveLinear);

  //           svg.append("path")
  //               .datum(validPoints)
  //               .attr("fill", "none")
  //               .attr("stroke", "#C47061")
  //               .attr("stroke-width", 2)
  //               .attr("d", line);

  //           svg.append("g").call(d3.axisLeft(yScale).ticks(3));

  //           svg.append("g")
  //               .attr("transform", `translate(0,${height})`)
  //               .call(d3.axisBottom(xScale).ticks(validPoints.length));
  //       });
  //   }, 10);
  // };
  const handleClear = () => {
    console.log("🧹 Clearing sketch canvas");
    setSketchData([]);
    setPaths([]);
    setCurrentPath([]);
    console.log("Canvas cleared");
  };

  const handleSketchSegmentSelect = (segment) => {
    setSelectedSketchSegments(prevSelected => {
      const isAlreadySelected = prevSelected.some(
        s => s[0]?.Date === segment[0]?.Date
      );
      
      return isAlreadySelected
        ? prevSelected.filter(s => s[0]?.Date !== segment[0]?.Date)
        : [...prevSelected, segment];
    });
  };

  const visualizeSketchMatchedSegments = (segments, windowLength) => {
    if (!segments || segments.length === 0) {
      console.warn("No sketch segments to visualize");
      return;
    }

    const container = sketchMatchedSegmentsRef.current;
    if (!container) {
      console.warn("Sketch container not ready");
      return;
    }

    // Clear existing content
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Create grid container with fixed layout
    const gridContainer = d3.select(container)
      .append("div")
      .style("display", "grid")
      .style("grid-template-columns", "repeat(auto-fit, minmax(250px, 1fr))")
      .style("gap", "30px")
      .style("padding", "20px 30px 20px 20px")
      .style("width", "calc(100% - 10px)")
      .style("max-width", "100%")
      .style("box-sizing", "border-box")
      .style("overflow", "hidden")
      .style("justify-items", "center")
      .style("justify-content", "center");

    segments.forEach((segment, index) => {
      const limitedSegment = segment.slice(0, windowLength);
      const isSelected = selectedSketchSegments.some(
        s => s[0]?.Date === segment[0]?.Date
      );

      const segmentContainer = gridContainer
        .append("div")
        .style("width", "100%")
        .style("min-height", "160px")
        .style("background-color", isSelected ? "#4A3636" : "#2E343A")
        .style("border", `2px solid ${isSelected ? "#C47061" : "#464F57"}`)
        .style("border-radius", "8px")
        .style("padding", "12px")
        .style("cursor", "pointer")
        .style("transition", "all 0.3s ease")
        .on("mouseover", function() {
          if (!isSelected) {
            d3.select(this)
              .style("transform", "translateY(-2px)")
              .style("box-shadow", "0 4px 12px rgba(0,0,0,0.2)")
              .style("background-color", "#363C42");
          }
        })
        .on("mouseout", function() {
          if (!isSelected) {
            d3.select(this)
              .style("transform", "translateY(0)")
              .style("box-shadow", "none")
              .style("background-color", "#2E343A");
          }
        })
        .on("click", () => handleSketchSegmentSelect(segment));

      // Rest of the visualization code remains the same
      const svg = segmentContainer
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", "0 0 250 160")
        .attr("preserveAspectRatio", "xMidYMid meet");

      const margin = { top: 20, right: 20, bottom: 30, left: 40 };
      const width = 250 - margin.left - margin.right;
      const height = 160 - margin.top - margin.bottom;

      const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      g.append("text")
        .attr("x", width / 2)
        .attr("y", -5)
        .attr("text-anchor", "middle")
        .style("fill", isSelected ? "#C47061" : "white")
        .style("font-size", "12px")
        .text(`Segment ${index + 1}`);

      const xScale = d3.scaleTime()
        .domain([
          new Date(limitedSegment[0].Date),
          new Date(limitedSegment[limitedSegment.length - 1].Date)
        ])
        .range([0, width]);

      const yValues = limitedSegment.map(d => d.Value);
      const yScale = d3.scaleLinear()
        .domain([d3.min(yValues), d3.max(yValues)])
        .range([height, 0]);

      const line = d3.line()
        .x(d => xScale(new Date(d.Date)))
        .y(d => yScale(d.Value));

      g.append("path")
        .datum(limitedSegment)
        .attr("fill", "none")
        .attr("stroke", isSelected ? "#C47061" : "#8B9BA8")
        .attr("stroke-width", isSelected ? 3 : 2)
        .attr("d", line);

      g.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(3).tickFormat(d3.timeFormat("%m/%d")))
        .style("color", isSelected ? "#C47061" : "#8B9BA8");

      g.append("g")
        .call(d3.axisLeft(yScale).ticks(5))
        .style("color", isSelected ? "#C47061" : "#8B9BA8");
    });
  };
  
  


  
  const drawGridOnCanvas = () => {
    const canvas = canvasRef.current?.canvasContainer.children[1];
    if (!canvas) return;
  
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const gridSize = 20;
  
    context.clearRect(0, 0, width, height);
  
    context.strokeStyle = "lightgray";
    context.lineWidth = 0.5;
  
    for (let x = 0; x < width; x += gridSize) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
  
    for (let y = 0; y < height; y += gridSize) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  };
  
  useEffect(() => {
    drawGridOnCanvas();
  }, [canvasRef]);
  
  const drawSelectedSegments = () => { // draw selected segments on the canvas
    const canvas = canvasRef.current?.canvasContainer.children[0];
    if (!canvas) return;
  
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
  
    selectedSegments.forEach((segment) => {
      context.beginPath();
      segment.forEach((point, index) => {
        const x = (index / segment.length) * canvas.width;
        const y = canvas.height - point.NormalizedValue * canvas.height;
        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });
      context.strokeStyle = "lightgray";
      context.lineWidth = 2;
      context.stroke();
    });
  };

  useEffect(() => {//It runs drawSelectedSegments() only when selectedSegments changes
    drawSelectedSegments();
  }, [selectedSegments]);


  // const handleClear = () => {
  //   canvasRef.current.clear();
  //   setSketchData([]);
  //   console.log("Sketch cleared");
  // };
  // const handleClear = () => {
  //   if (svgRef.current) {
  //     d3.select(svgRef.current).selectAll("circle, polyline").remove();
  //   }
  //   setPaths([]);
  //   setSketchData([]);
  //   console.log("Sketch cleared");
  // };
  
  
  

  const preprocessSegments = (segments, windowLength) => {
    return segments.map((segment, idx) => {
      if (!Array.isArray(segment)) {
        console.warn(`preprocessSegments: segment at index ${idx} is not an array`, segment);
        return [];
      }
      const length = windowLength || segment.length;
      return segment
        .filter((point) => typeof point.NormalizedValue === "number")
        .map((point, index) => ({
          x: index / (length - 1),
          y: point.NormalizedValue ?? point.y ?? NaN,
        }));
    });
  };
    
   
  const generateEnvelope = (segments, fixedThickness = 0.2, windowLength) => {
    const upper = [];
    const lower = [];
    const numPoints = windowLength || segments[0]?.length || 0;

    if (numPoints === 0) {
      console.warn("No valid segments provided for envelope generation.");
      return { upper, lower };
    }

    for (let i = 0; i < numPoints; i++) {
      const yValues = segments
        .map((segment) => segment[i]?.y)
        .filter((v) => typeof v === "number" && !isNaN(v));

      if (yValues.length === 0) {
        console.warn(`No valid y-values found for point ${i}. Skipping.`);
        continue;
      }

      const avgY = yValues.reduce((sum, y) => sum + y, 0) / yValues.length;

      upper.push({ x: i / (numPoints - 1), y: avgY + fixedThickness / 2 });
      lower.push({ x: i / (numPoints - 1), y: avgY - fixedThickness / 2 });
    }

    return { upper, lower };
};

const drawOriginalSegments = (svg, segments, xScale, yScale) => {
    segments.forEach((segment) => {
      const lineGenerator = d3.line()
        .x((d) => xScale(d.x))
        .y((d) => yScale(d.y))
        .curve(d3.curveLinear);

      segment[0].x = 0;
      segment[segment.length - 1].x = 1;

      svg.append("path")
        .datum(segment)
        .attr("class", "original-segment")
        .attr("d", lineGenerator)
        .attr("stroke", "#d8bc1dff")
        .attr("stroke-width", 3)
        .attr("fill", "none");
    });
};

const drawEnvelope = (svg, upper, lower, xScale, yScale) => {
    const lineGenerator = d3.line()
      .x((d) => xScale(d.x))
      .y((d) => yScale(d.y))
      .curve(d3.curveLinear);

    upper[0].x = 0;
    lower[0].x = 0;
    upper[upper.length - 1].x = 1;
    lower[lower.length - 1].x = 1;

    svg.append("path")
      .datum([...upper, ...lower.reverse()])
      .attr("class", "envelope")
      .attr("d", lineGenerator)
      .attr("fill", "rgba(98, 98, 98, 1)")
      .attr("stroke", "none");
};

const drawSketchBackground = (segments, fixedThickness = 0.2, showOriginalSegments = true, windowLength) => {
  if (!svgRef.current) return;

  const svg = d3.select(svgRef.current);
  svg.selectAll("*").remove();

  if (segments.length === 0) {
    console.warn("No segments provided.");
    return;
  }

  const processedSegments = preprocessSegments(segments, windowLength);
  // Align each segment by shifting its median y value to 0.5
  const adjustedSegments = (processedSegments || []).map(segment => {
    if (!Array.isArray(segment) || segment.length === 0) return segment;
    const yValues = segment
      .map(d => d?.y)
      .filter(v => typeof v === "number" && !isNaN(v))
      .sort((a, b) => a - b);
    if (yValues.length === 0) return segment;
    const midIndex = Math.floor(yValues.length / 2);
    const midOfSegment = yValues.length % 2 !== 0
      ? yValues[midIndex]
      : (yValues[midIndex - 1] + yValues[midIndex]) / 2;
    const offset = midOfSegment - 0.5;
    return segment.map(p => ({ ...p, y: (typeof p?.y === "number" ? p.y - offset : p.y) }));
  });
  const { upper, lower } = generateEnvelope(adjustedSegments, fixedThickness, windowLength);

  if (upper.length === 0 || lower.length === 0) {
    console.warn("Generated envelope is empty. Check your input data.");
    return;
  }

  const width = svgRef.current.clientWidth;
  const height = svgRef.current.clientHeight;
  svg.attr("viewBox", `0 0 ${width} ${height}`);


  const xScale = d3.scaleLinear().domain([0, 1]).range([0, width]);

  const allYValues = [...upper, ...lower].map(d => d.y);
  const yMin = Math.min(...allYValues);
  const yMax = Math.max(...allYValues);

  const padding = (yMax - yMin) * 0.3;
  const yScale = d3.scaleLinear()
      .domain([yMin - padding, yMax + padding])
      .range([height, 0]);

  drawEnvelope(svg, upper, lower, xScale, yScale);

  if (showOriginalSegments) {
    drawOriginalSegments(svg, adjustedSegments, xScale, yScale);
  }
};


  const handleUndo = () => {
    if (paths.length === 0 || strokeLengths.length === 0) return;

    console.log("🔄 Undoing last stroke");
    
    // Remove last path
    setPaths(prevPaths => prevPaths.slice(0, -1));
    
    // Get the length of points to remove
    const pointsToRemove = strokeLengths[strokeLengths.length - 1];
    
    // Remove points from sketchData
    setSketchData(prevData => prevData.slice(0, -pointsToRemove));
    
    // Remove the length from strokeLengths
    setStrokeLengths(prev => prev.slice(0, -1));

    console.log("✂️ Removed stroke with length:", pointsToRemove);
  };
  
  const handleDeleteDrawing = () => {
    setStrokes([]);
  };

  useEffect(() => {
    if (chartData) {
        console.log("Redrawing chart due to selection change");
        drawFullChart(chartData, matchedSegments, sketchMatchedSegments, showGreySegments, showQbTMatches, showQbSMatches);
    }
  }, [chartData, matchedSegments, sketchMatchedSegments, selectedSegments, selectedSketchSegments, showGreySegments, showQbTMatches, showQbSMatches]);


  useEffect(() => {
    const handleResize = () => {
        setChartSize({
            width: window.innerWidth * 0.9,
            height: Math.min(window.innerHeight * 0.4, 400)
        });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
}, []);

useEffect(() => {
  if (matchedSegmentsRef.current) {
    try {
      if (matchedSegments.length > 0) {
        visualizeMatchedSegments(matchedSegments, windowLength);
      } else {
        // Clear the visualization when no segments
        while (matchedSegmentsRef.current.firstChild) {
          matchedSegmentsRef.current.removeChild(matchedSegmentsRef.current.firstChild);
        }
      }
    } catch (error) {
      console.error("Error visualizing matched segments:", error);
    }
  }
}, [matchedSegments, windowLength]);

useEffect(() => {
  if (sketchMatchedSegments.length > 0 && sketchMatchedSegmentsRef.current) {
    try {
      visualizeSketchMatchedSegments(sketchMatchedSegments, windowLength);
    } catch (error) {
      console.error("Error visualizing sketch segments:", error);
    }
  }
}, [sketchMatchedSegments, windowLength, selectedSketchSegments]);


  useEffect(() => {
    if (selectedSegments.length > 0) {
        console.log("Drawing background for selected segments:", selectedSegments);
        drawSketchBackground(selectedSegments, delta, showOriginalSegments, windowLength);
    } else {
        // Clear only the background elements when no segments are selected
        const svg = d3.select(svgRef.current);
        if (svg) {
            svg.selectAll(".envelope, .original-segment").remove();
        }
    }
  }, [selectedSegments, delta, showOriginalSegments, windowLength]);
    
  
  useEffect(() => {
    // Removed D3.js DOM manipulation to prevent React conflicts
    // The SVG is now controlled entirely by React state
  }, []);

//   const handleMouseDown = (event) => {
//     const svg = svgRef.current;
//     if (!svg) return;

//     const point = getSVGCoordinates(event);

//     if (toolRef.current === "eraser") {
//         console.log("Eraser selected - attempting to erase");
//         eraseStroke(point);
//     } else {
//         console.log("Pen selected - starting new path");
//         setCurrentPath([point]);
//     }
// };
// const handleMouseDown = (event) => {//new mouse down
//   if (tool === "eraser") return;

//   const point = getSVGCoordinates(event);
//   setCurrentPath([point]);
//   setPaths(prev => [...prev, [point]]);
// };
const handleMouseDown = (event) => {
  if (tool === "eraser") return;

  const point = getSVGCoordinates(event);
  console.log("🖊️ Started drawing at:", point);
  setCurrentPath([point]);
  setPaths(prev => [...prev, [point]]);
  setIsDrawing(true);
  // Don't reset sketchData here, we want to keep previous strokes
};




// const handleMouseMove = (event) => {
//   if (currentPath.length === 0 || tool === "eraser") return;

//   const point = getSVGCoordinates(event);
//   setCurrentPath([...currentPath, point]);
// };
// const handleMouseMove = (event) => {/// new one
//   if (tool === "eraser") return;

//   const point = getSVGCoordinates(event);
//   const newPath = [...currentPath, point];

//   setCurrentPath(newPath);
//   setPaths(prev => {
//     const updated = [...prev];
//     updated[updated.length - 1] = newPath;
//     return updated;
//   });
// };
const handleMouseMove = (event) => {
  if (!isDrawing || tool === "eraser" || currentPath.length === 0) return;

  const point = getSVGCoordinates(event);
  const newPath = [...currentPath, point];
  
  // Log every 5th point to avoid console spam
  if (newPath.length % 5 === 0) {
    console.log("✏️ Drawing path points:", {
      totalPoints: newPath.length,
      lastPoint: point,
      pathBounds: {
        minX: Math.min(...newPath.map(p => p.x)),
        maxX: Math.max(...newPath.map(p => p.x)),
        minY: Math.min(...newPath.map(p => p.y)),
        maxY: Math.max(...newPath.map(p => p.y))
      }
    });
  }
  
  setCurrentPath(newPath);
  setPaths(prev => {
    const updated = [...prev];
    updated[updated.length - 1] = newPath;
    return updated;
  });
};



const eraseStroke = (erasePoint) => {
  const threshold = 10;
  console.log("Erasing at:", erasePoint);

  setPaths((prevPaths) =>
      prevPaths.filter((path) => {
          const shouldErase = path.some((point) => {
              const dx = point.x - erasePoint.x;
              const dy = point.y - erasePoint.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              return distance < threshold;
          });

          console.log("Stroke Removed?", shouldErase);
          return !shouldErase;
      })
  );
};


// const handleMouseUp = () => {
//     if (currentPath.length === 0) return;

//     if (tool === "eraser") {
//         eraseStroke(currentPath);
//     } else {
//         setPaths([...paths, currentPath]);
//     }

//     setCurrentPath([]);
// };
// const handleMouseUp = () => {//new handle mouse up
//   setCurrentPath([]);
// };
const handleMouseUp = () => {
  if (currentPath.length > 0) {
    console.log("🎨 Finished drawing path:", {
      numberOfPoints: currentPath.length,
      points: currentPath
    });
    
    // Add current path points to sketchData and track its length
    setSketchData(prevData => [...prevData, ...currentPath]);
    setStrokeLengths(prev => [...prev, currentPath.length]);
  }
  setIsDrawing(false);
  setCurrentPath([]);
};



const getSVGCoordinates = (event) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
}; 

useEffect(() => {
  console.log("Tool Changed:", tool);
}, [tool]);

useEffect(() => {
  toolRef.current = tool;
}, [tool]);

useEffect(() => {
  if (!query) return;
  console.log("Query updated:", query);
}, [query]);


const handleSendQuery = async (userMessage) => {
  try {
      const response = await axios.post("http://127.0.0.1:8000/generate/", {
          model: selectedModel,
          user_message: userMessage,
      });

      console.log("AI Response:", response.data);
  } catch (error) {
      console.error("Error during API call:", error);
  }
};

useEffect(() => {
  // Cleanup function for D3 elements
  return () => {
    d3.select("#matched-segments").selectAll("*").remove();
    d3.select("#sketch-matched-segments").selectAll("*").remove();
  };
}, []); // Empty dependency array means this runs on unmount

// Add this useEffect to update visualizations when selection changes
useEffect(() => {
    if (matchedSegments.length > 0) {
        visualizeMatchedSegments(matchedSegments, windowLength);
    }
}, [matchedSegments, selectedSegments, windowLength]); // Added selectedSegments to dependencies

const handleUnselectAllSketchSegments = () => {
  setSelectedSketchSegments([]);
};



  return (
    <div className="App">
      <div className="app-container">

        
        <div className="main-content-container">
          {/* Left Side Container - 30% */}
          <ChatBox
          user_window_length={windowLength}
          setMatchedSegments={setMatchedSegments}
          setFeatureDescriptions={setFeatureDescriptions} />

          {/* Right Side Container - 70% */}
          <div className="right-column">
            {/* Upper Left Section - 61.8% */}
            <div className="upper-left-section">
              {/* QbT Section - 50% of 61.8% */}
              <div className="qbt-section">
                <div style={{ flex: '0 0 auto', marginBottom: '8px' }}>
                  <h2 style={{ 
                    fontSize: '2.2rem', 
                    fontWeight: '700', 
                    margin: '0 0 8px 0', 
                    color: '#fff', 
                    letterSpacing: '0.5px',
                    textAlign: 'center'
                  }}>Query by Text</h2>
                  <TaskBar setChartData={setChartData} setWindowLength={setWindowLength} />
                </div>
                
                <div style={{ flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' }}>
                  <div style={{ flex: '0 0 auto', marginBottom: '8px' }}>
                    <FeatureQueryEditor 
                      featureDescriptions={featureDescriptions} 
                      windowLength={windowLength}
                      drawFullChart={drawFullChart}
                      setMatchedSegments={setMatchedSegments}
                      updateQuery={(newLocalFeatures) => {
                        console.log("Updating featureDescriptions in App.js:", newLocalFeatures);

                        setFeatureDescriptions(prev => ({
                          global: prev.global,
                          local: newLocalFeatures
                        }));
                      }}
                    />
                  </div>

                  <VisualizationErrorBoundary>
                    <div className="matched-segments-section" style={{ flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' }}>
                      <h2 style={{
                        textAlign: 'center',
                        marginBottom: '8px',
                        width: '100%',
                        display: 'block',
                        background: 'rgba(255,255,255,0.04)',
                        borderRadius: '6px',
                        padding: '6px 0',
                        flex: '0 0 auto'
                      }}>QbT Matched Segments</h2>
                      <div 
                        ref={matchedSegmentsRef} 
                        className="segments-container"
                        style={{ width: "100%", flex: '1', minHeight: '0' }}
                      ></div>
                    </div>
                  </VisualizationErrorBoundary>
                </div>
              </div>

              {/* QbS Section - 50% of 61.8% */}
              <div className="qbs-section">
                <div style={{ flex: '0 0 auto', marginBottom: '12px' }}>
                  <h2 style={{ 
                    fontSize: '2.2rem', 
                    fontWeight: '700', 
                    margin: '0 0 12px 0', 
                    color: '#fff', 
                    letterSpacing: '0.5px',
                    textAlign: 'center'
                  }}>Query by Sketch</h2>
                </div>

                <div style={{ background: '#2E343A', borderRadius: '16px', padding: '8px', marginBottom: '12px', flex: '0 0 50%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ flex: '0 0 auto', marginBottom: '12px' }}>
                    <div className="sketch-toolbar2" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <div className="segment-buttons-container" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '8px', flexShrink: 0 }}>
                        <button
                          className={`toggle-original-button ${showOriginalSegments ? 'active' : ''}`}
                          onClick={() => setShowOriginalSegments(!showOriginalSegments)}
                          style={{ display: 'none' }}
                        >
                          {showOriginalSegments ? "Hide Original Segments" : "Show Original Segments"}
                        </button>
                        
                        <button 
                          className="toggle-original-button" 
                          onClick={() => {
                            setSelectedSegments([]);
                            handleUnselectAllSketchSegments();
                          }}
                          title="Unselect all QbT and QbS segments"
                          style={{ fontSize: '0.9em', padding: '8px 12px', height: '36px', minWidth: '36px', display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '8px', flexShrink: 0 }}
                        >
                          <span style={{ fontWeight: 'bold', fontSize: '0.9em', whiteSpace: 'nowrap' }}>Unselect All Segments</span>
                        </button>

                        {/* Moved here so it's on the same row */}
                        <button
                          onClick={handleUndo}
                          title="Undo"
                          style={{ fontSize: '0.9em', padding: '8px 12px', height: '36px', minWidth: '36px', display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '8px' }}
                        >
                          <i className="fas fa-undo" aria-hidden="true"></i>
                          <span style={{ fontWeight: 'bold', fontSize: '0.9em', whiteSpace: 'nowrap' }}>Undo</span>
                        </button>

                        <button
                          onClick={handleClear}
                          title="Delete Drawing"
                          style={{ fontSize: '0.9em', padding: '8px 12px', height: '36px', minWidth: '36px', display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '8px' }}
                        >
                          <i className="fas fa-trash" aria-hidden="true"></i>
                          <span style={{ fontWeight: 'bold', fontSize: '0.9em', whiteSpace: 'nowrap' }}>Delete</span>
                        </button>
                      </div>

                      <div className="button-group" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <div className="input-group" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <label htmlFor="top-k-input" style={{ fontSize: '0.9em', fontWeight: 'bold', whiteSpace: 'nowrap' }}>Top Matches (k):</label>
                          <input
                            id="top-k-input"
                            type="number"
                            min="1"
                            max="100"
                            value={topK}
                            onChange={(e) => setTopK(Number(e.target.value))}
                            style={{ fontSize: '0.9em', padding: '4px 6px', borderRadius: '4px', border: '1px solid #ccc', width: '50px', textAlign: 'center' }}
                          />
                        </div>
                        <button className="primary-button" onClick={handleSketchSubmit} style={{ fontSize: '0.9em', padding: '8px 12px', height: '36px', minWidth: '36px', display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '8px' }}>
                          <span style={{ fontWeight: 'bold', fontSize: '0.9em' }}>Submit</span>
                        </button>
                        <button className="secondary-button" onClick={handleClear} style={{ display: 'none' }}>
                          Clear
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={{ flex: '1', position: 'relative', width: '100%', margin: '0 0 15px 0' }}>
                    <div className="sketch-canvas-center" style={{ width: 'calc(100% - 20px)', height: '100%', margin: '0 10px' }}>
                      <svg
                        ref={svgRef}
                        className="sketch-svg"
                        width="100%"
                        height="100%"
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                      >
                        {paths.map((path, index) => (
                          <polyline
                            key={index}
                            points={path.map(p => `${p.x},${p.y}`).join(" ")}
                            stroke={tool === "eraser" ? "rgba(200,0,0,0.8)" : "rgba(232, 87, 87, 1)"}
                            strokeWidth="6"
                            fill="none"
                          />
                        ))}
                      </svg>
                    </div>
                  </div>
                </div>

                <VisualizationErrorBoundary>
                  <div className="matched-segments-section">
                    <h2 style={{
                      textAlign: 'center',
                      marginBottom: '12px',
                      width: '100%',
                      display: 'block',
                      background: 'rgba(255,255,255,0.04)',
                      borderRadius: '6px',
                      padding: '6px 0',
                      flex: '0 0 auto'
                    }}>QbS Matched Segments</h2>
                    <div 
                      ref={sketchMatchedSegmentsRef} 
                      className="segments-container"
                      style={{ width: "100%" }}
                    ></div>
                  </div>
                </VisualizationErrorBoundary>
              </div>
            </div>

            {/* Lower Left Section - 38.2% */}
            <div className="lower-left-section">
              <div className="chart-title-wrapper">
                <p className="chart-title" style={{ fontSize: '2.2rem', fontWeight: '700', margin: '0 0 12px 0', color: '#fff', letterSpacing: '0.5px', textAlign: 'center' }}>Full Time Series View</p>
              </div>
              <div className="toggle-group">
                <button className={`toggle-btn grey${showGreySegments ? ' checked' : ''}`} onClick={() => setShowGreySegments(v => !v)}>
                  <span className="checkmark"></span>
                  Show all QbT matches
                </button>
                <button className={`toggle-btn yellow${showQbTMatches ? ' checked' : ''}`} onClick={() => setShowQbTMatches(v => !v)}>
                  <span className="checkmark"></span>
                  Show selected QbT matches
                </button>
                <button className={`toggle-btn red${showQbSMatches ? ' checked' : ''}`} onClick={() => setShowQbSMatches(v => !v)}>
                  <span className="checkmark"></span>
                  Show QbS matches
                </button>
              </div>
              <div className="chart-container">
                {!chartData || chartData.length === 0 ? (
                  <div className="placeholder-message">
                    <div style={{ fontSize: '48px', color: '#cccccc' }}>📊</div>
                    <p>The full time series chart will appear here once you select your data.</p>
                  </div>
                ) : null}
                <div className="chart-scroll-x" ref={el => window._chartScrollX = el}>
                  {(() => {
                    // Dynamically get the container width using a ref
                    const [containerWidth, setContainerWidth] = React.useState(chartSize.width);
                    React.useEffect(() => {
                      const handleResize = () => {
                        const el = window._chartScrollX;
                        if (el) setContainerWidth(el.clientWidth);
                      };
                      handleResize();
                      window.addEventListener('resize', handleResize);
                      return () => window.removeEventListener('resize', handleResize);
                    }, []);
                    
                    // Use container width directly since we're using D3 zoom/pan
                    const svgWidth = containerWidth;
                    
                    
                    // Dynamically set the viewBox height to match the container's height
                    const [svgViewBoxHeight, setSvgViewBoxHeight] = React.useState(400);
                    const svgRefCallback = (node) => {
                      if (node) {
                        const height = node.clientHeight || node.height.baseVal.value || 400;
                        if (height !== svgViewBoxHeight) setSvgViewBoxHeight(height);
                        fullChartRef.current = node;
                      }
                    };
                    return (
                      <svg
                        ref={svgRefCallback}
                        width={svgWidth}
                        height="100%"
                        viewBox={`0 0 ${svgWidth} ${svgViewBoxHeight}`}
                        preserveAspectRatio="xMidYMid meet"
                      />
                    );
                  })()}
                </div>

                <div
                  id="annotation-modal"
                  style={{
                    display: 'none',
                    position: 'fixed',
                    top: '30%',
                    left: '30%',
                    width: '50%',
                    background: 'white',
                    border: '1px solid gray',
                    padding: '20px',
                    zIndex: 1000,
                  }}
                >
                  <h3 id="modal-title">Annotate Segment</h3>

                  <div id="segment-chart-container" style={{ width: '100%', height: '200px', marginBottom: '20px' }}></div>

                  <textarea
                    id="annotation-input"
                    placeholder="Add your notes here..."
                    style={{ width: '100%', height: '100px', marginBottom: '10px' }}
                  ></textarea>

                  <button id="save-annotation" style={{ marginTop: '10px' }}>
                    Save
                  </button>
                </div>

                <div
                  id="modal-overlay"
                  style={{
                    display: 'none',
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: 'rgba(0, 0, 0, 0.5)',
                    zIndex: 999,
                  }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
  
}  

export default App;