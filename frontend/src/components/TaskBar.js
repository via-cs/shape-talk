import React, { useState, useEffect } from 'react';
import './TaskBar.css';
import axios from 'axios';
import { FaInfoCircle } from "react-icons/fa";

const TaskBar = ({ setChartData, setWindowLength }) => {
    const [selectedFile, setSelectedFile] = useState(null);
    const [windowLengthInput, setWindowLengthInput] = useState("");
    const [selectedModel, setSelectedModel] = useState("gpt-4o");
    const [usePracticeFile, setUsePracticeFile] = useState(false);
    const [showTooltip, setShowTooltip] = useState(false);
    const [metadata, setMetadata] = useState(null);
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
    const [showInfoTooltip, setShowInfoTooltip] = useState(false);
    const [notification, setNotification] = useState({ show: false, message: "", type: "success" });

    const practiceFiles = [
        { name: 'Energy Consumption', value: 'AEP_hourly.csv' },
        { name: 'Bitcoin', value: 'BTCUSD.csv' },
        { name: 'Weather', value: 'Weather.csv' }
    ];

    const showNotification = (message, type = "success") => {
        setNotification({ show: true, message, type });
        setTimeout(() => {
            setNotification(prev => ({ ...prev, fadeOut: true }));
            setTimeout(() => {
                setNotification({ show: false, message: "", type: "success", fadeOut: false });
            }, 300);
        }, 2000);
    };

    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setSelectedFile(file.name);
        setUsePracticeFile(false);

        const formData = new FormData();
        formData.append('file', file);

        const finalWindowLength = windowLengthInput || "6";

        try {
            await axios.post(`http://127.0.0.1:8000/uploadfile/?top_k=5&window_length=${finalWindowLength}`, formData);
            showNotification("File uploaded successfully");

            const response = await axios.get('http://127.0.0.1:8000/get-data/');
            setChartData(response.data);
        } catch (error) {
            console.error('Error uploading file:', error);
            showNotification("Failed to upload file", "error");
        }
    };

    const handleMouseEnter = (event) => {
        const rect = event.target.getBoundingClientRect();
        const tooltipWidth = 250;
        const tooltipHeight = 100;

        setTooltipPosition({
            x: Math.min(rect.left + window.scrollX + 15, window.innerWidth - tooltipWidth),
            y: Math.max(rect.top + window.scrollY - tooltipHeight, 20)
        });
        setShowTooltip(true);
    };

    const handlePracticeFileSelect = async (event) => {
        const selectedPracticeFile = event.target.value;
        if (!selectedPracticeFile) return;

        setSelectedFile(selectedPracticeFile);
        setUsePracticeFile(true);

        console.log('Fetching practice file:', selectedPracticeFile);

        try {
            const response = await axios.get(`http://127.0.0.1:8000/get-practice-data/${selectedPracticeFile}?top_k=5&window_length=${windowLengthInput || "6"}`);
            setChartData(response.data);
            showNotification("Practice file loaded successfully");
        } catch (error) {
            console.error('Error fetching practice file:', error);
            showNotification("Failed to load practice file", "error");
        }
    };

    const handleWindowLengthChange = (e) => {
        const value = e.target.value;
        if (/^\d*$/.test(value)) {
            setWindowLengthInput(value);
            setWindowLength(value ? Number(value) : 6);
        }
    };

    const handleModelChange = async (e) => {
        const newModel = e.target.value;
        setSelectedModel(newModel);

        try {
            await axios.post("http://127.0.0.1:8000/set-model/", { model: newModel });
            console.log("Model updated to:", newModel);
        } catch (error) {
            console.error("Error updating model:", error);
        }
    };

    useEffect(() => {
        const fetchModel = async () => {
            try {
                const res = await axios.get("http://127.0.0.1:8000/get-model/");
                setSelectedModel(res.data.selected_model);
            } catch (error) {
                console.error("Error fetching selected model:", error);
            }
        };
        fetchModel();
    }, []);

    return (
        <>
            {notification.show && (
                <div className={`notification ${notification.type} ${notification.fadeOut ? 'fade-out' : ''}`}>
                    {notification.message}
                </div>
            )}
            <div className="taskbar">
                <div className="taskbar-left">
                    <p className="body-large">Speak to Draw</p>

                    <div className="file-selector-container" style={{ marginLeft: '12px' }}>
                        <select onChange={handlePracticeFileSelect} className="file-dropdown">
                            <option value="">Select a practice dataset</option>
                            {practiceFiles.map((file) => (
                                <option key={file.value} value={file.value}>{file.name}</option>
                            ))}
                        </select>

                        <label htmlFor="file-upload" className="file-upload-icon">
                            <i className="fas fa-upload"></i>
                        </label>
                        <input type="file" id="file-upload" onChange={handleFileUpload} className="hidden-file-input" />

                        {selectedFile && (
                            <span className="selected-file">
                                {usePracticeFile ? `Using: ${selectedFile}` : `Uploaded: ${selectedFile}`}
                                <FaInfoCircle
                                    className="info-icon"
                                    onMouseEnter={handleMouseEnter}
                                    onMouseLeave={() => setShowTooltip(false)}
                                />
                            </span>
                        )}
                    </div>

                    {/* Window Length with Info Tooltip */}
                    <div className="query-window-container" style={{ marginLeft: '30px' }}>
                        <label className="query-label" style={{ marginRight: '10px' }}>Query Window</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="6"
                            value={windowLengthInput}
                            onChange={handleWindowLengthChange}
                            className="window-length-input"
                            style={{ color: windowLengthInput ? "black" : "gray" }} 
                        />
                        <FaInfoCircle 
                            className="info-icon"
                            onMouseEnter={() => setShowInfoTooltip(true)}
                            onMouseLeave={() => setShowInfoTooltip(false)}
                        />
                    </div>
                    {showInfoTooltip && (
                        <div className="tooltip-box">
                            If left blank, the query window will default to 6.
                        </div>
                    )}
                </div>

                {/* Select Model - Right Most */}
                {/* <div className="model-selection-container" style={{ position: 'absolute', right: '20px' }}>
                    <label className="query-label" style={{ marginRight: "15px" }}>Select Model</label>
                    <select value={selectedModel} onChange={handleModelChange} className="model-dropdown">
                        <option value="gpt-4o">GPT-4o</option>
                        <option value="deepseek">DeepSeek Prover V2</option>
                        <option value="mistral">Devstral Small 2025</option>
                    </select>
                </div> */}
            </div>
        </>
    );
};

export default TaskBar;
