// Global variables for serial communication
let port = null;
let reader = null;
let writer = null;
let isConnected = false;
let hexBuffer = ''; // Buffer for accumulating hex data
let asciiBuffer = ''; // Buffer for ASCII conversion

// Speed tracking variables
let readingCount = 0;
let lastSpeedUpdate = Date.now();
let speedUpdateInterval = null;

// Weight per count conversion variables
let weightPerCount = null; // Stores the Weight/Count value from SWC command
let isWeightPerCountSet = false; // Flag to track if SWC has been executed
let waitingForSWCResponse = false; // Flag to track if we're waiting for SWC response

// Graph variables
let graphData = []; // Array to store load values for graphing
let graphTimestamps = []; // Array to store timestamps
let maxGraphPoints = 100; // Maximum number of points to display
let graphCanvas = null;
let graphCtx = null;
let lastGraphUpdate = 0;
let graphUpdateInterval = 200; // Update graph every 200ms

// Cumulative data variables
let cumulativeData = []; // Array to store all load values (unlimited)
let cumulativeTimestamps = []; // Array to store all timestamps
let cumulativeCanvas = null;
let cumulativeCtx = null;
let lastCumulativeUpdate = 0;
let cumulativeUpdateInterval = 200; // Update cumulative chart every 200ms

// DOM elements
const connectionStatus = document.getElementById('connectionStatus');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const tareBtn = document.getElementById('tareBtn');
const swcBtn = document.getElementById('swcBtn');
const sensorDisplay = document.getElementById('sensorDisplay');
const asciiDisplay = document.getElementById('asciiDisplay');
const logContainer = document.querySelector('.log');
const readingsPerSecondElement = document.getElementById('readingsPerSecond');
const weightPerCountStatus = document.getElementById('weightPerCountStatus');
const weightPerCountValue = document.getElementById('weightPerCountValue');
const manualWeightPerCount = document.getElementById('manualWeightPerCount');
const setManualWeightBtn = document.getElementById('setManualWeightBtn');
const loadGraph = document.getElementById('loadGraph');
const clearGraphBtn = document.getElementById('clearGraphBtn');
const maxPointsElement = document.getElementById('maxPoints');
const cumulativeGraph = document.getElementById('cumulativeGraph');
const clearCumulativeBtn = document.getElementById('clearCumulativeBtn');
const cumulativePointsElement = document.getElementById('cumulativePoints');

// Connect to serial port
async function connectSerial() {
    try {
        // Request port access
        port = await navigator.serial.requestPort();
        
        // Get baud rate from select element
        const baudRate = parseInt(document.getElementById('baudRate').value);
        
        // Open the port
        await port.open({ baudRate: baudRate });
        
        // Set up text encoder/decoder
        const textDecoder = new TextDecoderStream();
        const readableStreamClosed = textDecoder.readable.pipeTo(new WritableStream({
            write(chunk) {
                handleSerialData(chunk);
            }
        }));
        
        // Set up reader and writer
        reader = port.readable.getReader();
        writer = port.writable.getWriter();
        
        // Start reading from the port
        reader.read().then(function processText({ done, value }) {
            if (done) {
                return;
            }
            
            // Convert the chunk to text and handle it
            const chunk = new TextDecoder().decode(value);
            handleSerialData(chunk);
            
            // Continue reading
            return reader.read().then(processText);
        });
        
        // Update UI
        isConnected = true;
        updateConnectionStatus();
        logMessage('Connected to serial port at ' + baudRate + ' baud', 'response');
        
        // Start speed counter updates
        readingCount = 0;
        lastSpeedUpdate = Date.now();
        speedUpdateInterval = setInterval(updateSpeedCounter, 1000); // Update every second
        
    } catch (error) {
        logMessage('Connection failed: ' + error.message, 'error');
        console.error('Serial connection error:', error);
    }
}

// Disconnect from serial port
async function disconnectSerial() {
    try {
        if (reader) {
            await reader.cancel();
            reader.releaseLock();
            reader = null;
        }
        
        if (writer) {
            await writer.close();
            writer = null;
        }
        
        if (port) {
            await port.close();
            port = null;
        }
        
        // Update UI
        isConnected = false;
        updateConnectionStatus();
        sensorDisplay.textContent = '---';
        asciiDisplay.textContent = '---';
        hexBuffer = '';
        asciiBuffer = '';
        
        // Reset weight per count
        weightPerCount = null;
        isWeightPerCountSet = false;
        weightPerCountStatus.style.display = 'none';
        manualWeightPerCount.style.display = 'none';
        setManualWeightBtn.style.display = 'none';
        
        // Clear graph data
        clearGraph();
        clearCumulativeGraph();
        
        logMessage('Disconnected from serial port', 'response');
        
        // Stop speed counter updates
        if (speedUpdateInterval) {
            clearInterval(speedUpdateInterval);
            speedUpdateInterval = null;
        }
        readingsPerSecondElement.textContent = '0';
        
    } catch (error) {
        logMessage('Disconnect error: ' + error.message, 'error');
        console.error('Disconnect error:', error);
    }
}

// Send command "H" to the sensor
async function sendCommandH() {
    if (!isConnected || !writer) {
        logMessage('Not connected to serial port', 'error');
        return;
    }
    
    try {
        // Try different command formats
        const commands = ['H\r\n'];
        
        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            await writer.write(new TextEncoder().encode(command));
            logMessage(`Sent command ${i + 1}: "${command.replace('\n', '\\n').replace('\r', '\\r')}"`, 'command');
            
            // Wait a bit between commands
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        // Clear the displays while waiting for response
        sensorDisplay.textContent = '...';
        asciiDisplay.textContent = '...';
        hexBuffer = '';
        asciiBuffer = '';
        
    } catch (error) {
        logMessage('Failed to send command: ' + error.message, 'error');
        console.error('Send command error:', error);
    }
}

// Send stop command to the sensor
async function sendStopCommand() {
    if (!isConnected || !writer) {
        logMessage('Not connected to serial port', 'error');
        return;
    }
    
    try {
        // Try multiple stop commands that are commonly used for Loadstar sensors
        const stopCommands = ['\r\n'];
        
        for (let i = 0; i < stopCommands.length; i++) {
            const command = stopCommands[i];
            await writer.write(new TextEncoder().encode(command));
            logMessage(`Sent stop command ${i + 1}: "${command.replace('\n', '\\n').replace('\r', '\\r')}"`, 'command');
            
            // Wait a bit between commands
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Clear the displays
        sensorDisplay.textContent = '---';
        asciiDisplay.textContent = '---';
        hexBuffer = '';
        asciiBuffer = '';
        logMessage('Sent all stop commands', 'response');
        
    } catch (error) {
        logMessage('Failed to send stop command: ' + error.message, 'error');
        console.error('Send stop command error:', error);
    }
}

// Send tare command to the sensor
async function sendTareCommand() {
    if (!isConnected || !writer) {
        logMessage('Not connected to serial port', 'error');
        return;
    }
    
    try {
        // First, stop the stream
        logMessage('Stopping stream before tare...', 'response');
        await sendStopCommand();
        
        // Wait a moment for the stop command to take effect
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Send the TARE command
        const tareCommands = ['TARE\n'];
        
        for (let i = 0; i < tareCommands.length; i++) {
            const command = tareCommands[i];
            await writer.write(new TextEncoder().encode(command));
            logMessage(`Sent tare command ${i + 1}: "${command.replace('\n', '\\n').replace('\r', '\\r')}"`, 'command');
            
            // Wait a bit between commands
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        logMessage('Tare command sent successfully', 'response');
        
    } catch (error) {
        logMessage('Failed to send tare command: ' + error.message, 'error');
        console.error('Send tare command error:', error);
    }
}

// Send SWC command to get Weight per Count value
async function sendSWCCommand() {
    if (!isConnected || !writer) {
        logMessage('Not connected to serial port', 'error');
        return;
    }
    
    try {
        // First, stop the stream
        logMessage('Stopping stream before SWC command...', 'response');
        await sendStopCommand();
        
        // Wait a moment for the stop command to take effect
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Send the SWC command - try multiple formats
        const swcCommands = ['SWC\r\n'];
        
        for (let i = 0; i < swcCommands.length; i++) {
            const command = swcCommands[i];
            await writer.write(new TextEncoder().encode(command));
            logMessage(`Sent SWC command ${i + 1}: "${command.replace('\n', '\\n').replace('\r', '\\r')}"`, 'command');
            
            // Wait longer for response
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        waitingForSWCResponse = true;
        logMessage('SWC command sent successfully. Waiting for Weight/Count response...', 'response');
        
        // Set a timeout to check if we got a response
        setTimeout(() => {
            if (!isWeightPerCountSet && waitingForSWCResponse) {
                waitingForSWCResponse = false;
                logMessage('No response received from SWC command. The sensor may not support this command or may be in the wrong mode.', 'error');
                logMessage('Try using the manual Weight/Count input instead.', 'response');
            }
        }, 3000); // Wait 3 seconds for response
        
    } catch (error) {
        logMessage('Failed to send SWC command: ' + error.message, 'error');
        console.error('Send SWC command error:', error);
    }
}

// Set manual weight per count value
function setManualWeightPerCount() {
    const value = parseFloat(manualWeightPerCount.value);
    if (!isNaN(value) && value > 0) {
        weightPerCount = value;
        isWeightPerCountSet = true;
        waitingForSWCResponse = false; // Clear waiting flag
        logMessage(`Manual Weight per Count set to: ${weightPerCount}`, 'response');
        updateLoadDisplay();
        manualWeightPerCount.value = '';
    } else {
        logMessage('Please enter a valid positive number for Weight/Count', 'error');
    }
}

// Parse SWC response to extract Weight per Count value
function parseSWCResponse(data) {
    try {
        logMessage('Attempting to parse SWC response: ' + data, 'response');
        
        // Look for various numeric formats in the response
        const patterns = [
            /-?\d+\.?\d*[eE][+-]?\d+/g,        // Scientific notation (e.g., 2.56E-4, 1.23e-3)
            /-?\d+\.\d+[eE][+-]?\d+/g,         // Decimal with scientific notation
            /-?\d+[eE][+-]?\d+/g,              // Scientific notation without decimal
            /weight[:\s]*([0-9.e+-]+)/i,       // "Weight: 0.001" format
            /count[:\s]*([0-9.e+-]+)/i,        // "Count: 1000" format
            /ratio[:\s]*([0-9.e+-]+)/i,        // "Ratio: 0.001" format
            /-?\d+\.?\d*/g                     // Regular decimal numbers (fallback)
        ];
        
        for (let pattern of patterns) {
            const matches = data.match(pattern);
            if (matches && matches.length > 0) {
                for (let match of matches) {
                    logMessage(`Found match: "${match}" with pattern: ${pattern}`, 'response');
                    
                    // Extract the numeric part if it's in a labeled format
                    const numericMatch = match.match(/([0-9.e+-]+)/);
                    const valueToParse = numericMatch ? numericMatch[1] : match;
                    const value = parseFloat(valueToParse);
                    
                    logMessage(`Parsed value: ${value} from "${valueToParse}"`, 'response');
                    
                    if (!isNaN(value) && value !== 0) {
                        // Weight/Count is usually a small positive number
                        if (value > 0 && value < 10) {
                            weightPerCount = value;
                            isWeightPerCountSet = true;
                            waitingForSWCResponse = false; // Clear waiting flag
                            logMessage(`Weight per Count set to: ${weightPerCount} (from pattern: ${pattern})`, 'response');
                            updateLoadDisplay();
                            return;
                        }
                    }
                }
            }
        }
        
        // If no numeric value found, log the raw response for debugging
        logMessage('SWC response received but could not parse Weight/Count value. Raw data: ' + data, 'response');
        logMessage('Please check the sensor documentation for the correct SWC response format.', 'error');
        
    } catch (error) {
        logMessage('Error parsing SWC response: ' + error.message, 'error');
        console.error('Parse SWC response error:', error);
    }
}

// Update load display with converted values
function updateLoadDisplay() {
    if (isWeightPerCountSet && weightPerCount !== null) {
        // Update the display label to show load units
        const displayLabel = document.querySelector('.display-label');
        if (displayLabel) {
            displayLabel.textContent = 'Load Values (calibrated units)';
        }
        
        // Show the weight per count status
        weightPerCountValue.textContent = weightPerCount.toString();
        weightPerCountStatus.style.display = 'block';
        
        logMessage('Load conversion enabled. Raw counts will be converted to load values.', 'response');
    }
}

// Convert counts to load values
function convertCountsToLoad(counts) {
    if (isWeightPerCountSet && weightPerCount !== null && counts !== null) {
        const loadValue = counts * weightPerCount;
        return loadValue.toFixed(3); // Display with 3 decimal places
    }
    return counts;
}

// Initialize the graph
function initGraph() {
    if (loadGraph) {
        graphCanvas = loadGraph;
        graphCtx = graphCanvas.getContext('2d');
        
        // Set canvas size
        graphCanvas.width = graphCanvas.offsetWidth;
        graphCanvas.height = graphCanvas.offsetHeight;
        
        // Draw initial grid
        drawGraphGrid();
    }
}

// Draw graph grid
function drawGraphGrid() {
    if (!graphCtx) return;
    
    const width = graphCanvas.width;
    const height = graphCanvas.height;
    
    // Clear canvas
    graphCtx.clearRect(0, 0, width, height);
    
    // Draw background
    graphCtx.fillStyle = '#f8f9fa';
    graphCtx.fillRect(0, 0, width, height);
    
    // Draw grid lines
    graphCtx.strokeStyle = '#e9ecef';
    graphCtx.lineWidth = 1;
    
    // Vertical grid lines
    for (let i = 0; i <= 10; i++) {
        const x = (width / 10) * i;
        graphCtx.beginPath();
        graphCtx.moveTo(x, 0);
        graphCtx.lineTo(x, height);
        graphCtx.stroke();
    }
    
    // Horizontal grid lines
    for (let i = 0; i <= 5; i++) {
        const y = (height / 5) * i;
        graphCtx.beginPath();
        graphCtx.moveTo(0, y);
        graphCtx.lineTo(width, y);
        graphCtx.stroke();
    }
}

// Add data point to graph
function addGraphPoint(loadValue) {
    const now = Date.now();
    const floatValue = parseFloat(loadValue);
    
    // Validate the value to prevent extreme outliers
    if (isNaN(floatValue) || !isFinite(floatValue)) {
        console.log('Skipping invalid value:', loadValue);
        return;
    }
    
    // Check for extreme outliers (values that are too different from recent data)
    if (graphData.length > 0) {
        const recentAvg = graphData.slice(-5).reduce((a, b) => a + b, 0) / Math.min(graphData.length, 5);
        const diff = Math.abs(floatValue - recentAvg);
        const threshold = recentAvg * 0.5; // 50% threshold
        
        if (diff > threshold && diff > 0.1) { // Also check absolute difference
            console.log('Skipping outlier value:', floatValue, 'diff:', diff, 'threshold:', threshold);
            return;
        }
    }
    
    // Add new data point
    graphData.push(floatValue);
    graphTimestamps.push(now);
    
    // Limit the number of points
    if (graphData.length > maxGraphPoints) {
        graphData.shift();
        graphTimestamps.shift();
    }
    
    // Update graph if enough time has passed
    if (now - lastGraphUpdate > graphUpdateInterval) {
        drawGraph();
        lastGraphUpdate = now;
    }
}

// Draw the graph
function drawGraph() {
    if (!graphCtx || graphData.length < 2) return;
    
    const width = graphCanvas.width;
    const height = graphCanvas.height;
    
    // Draw grid
    drawGraphGrid();
    
    // Find min and max values for scaling
    const minValue = Math.min(...graphData);
    const maxValue = Math.max(...graphData);
    const valueRange = maxValue - minValue;
    
    // Add some padding to the range
    const padding = valueRange * 0.1;
    const scaledMin = minValue - padding;
    const scaledMax = maxValue + padding;
    const scaledRange = scaledMax - scaledMin;
    
    // Draw the line
    graphCtx.strokeStyle = '#007bff';
    graphCtx.lineWidth = 2;
    graphCtx.beginPath();
    
    for (let i = 0; i < graphData.length; i++) {
        const x = (width / (maxGraphPoints - 1)) * i;
        const y = height - ((graphData[i] - scaledMin) / scaledRange) * height;
        
        if (i === 0) {
            graphCtx.moveTo(x, y);
        } else {
            graphCtx.lineTo(x, y);
        }
    }
    
    graphCtx.stroke();
    
    // Draw data points
    graphCtx.fillStyle = '#007bff';
    for (let i = 0; i < graphData.length; i++) {
        const x = (width / (maxGraphPoints - 1)) * i;
        const y = height - ((graphData[i] - scaledMin) / scaledRange) * height;
        
        graphCtx.beginPath();
        graphCtx.arc(x, y, 3, 0, 2 * Math.PI);
        graphCtx.fill();
    }
    
    // Draw labels
    drawGraphLabels(scaledMin, scaledMax);
}

// Draw graph labels
function drawGraphLabels(minValue, maxValue) {
    if (!graphCtx) return;
    
    const width = graphCanvas.width;
    const height = graphCanvas.height;
    
    graphCtx.fillStyle = '#6c757d';
    graphCtx.font = '12px Arial';
    graphCtx.textAlign = 'right';
    
    // Y-axis labels
    for (let i = 0; i <= 5; i++) {
        const y = (height / 5) * i;
        const value = maxValue - (maxValue - minValue) * (i / 5);
        graphCtx.fillText(value.toFixed(2), width - 10, y + 4);
    }
    
    // X-axis label
    graphCtx.textAlign = 'center';
    graphCtx.fillText('Time (recent data points)', width / 2, height - 5);
}

// Clear the graph
function clearGraph() {
    graphData = [];
    graphTimestamps = [];
    drawGraphGrid();
    if (maxPointsElement) {
        maxPointsElement.textContent = maxGraphPoints;
    }
}

// Initialize the cumulative graph
function initCumulativeGraph() {
    if (cumulativeGraph) {
        cumulativeCanvas = cumulativeGraph;
        cumulativeCtx = cumulativeCanvas.getContext('2d');
        
        // Set canvas size
        cumulativeCanvas.width = cumulativeCanvas.offsetWidth;
        cumulativeCanvas.height = cumulativeCanvas.offsetHeight;
        
        // Draw initial grid
        drawCumulativeGrid();
    }
}

// Draw cumulative graph grid
function drawCumulativeGrid() {
    if (!cumulativeCtx) return;
    
    const width = cumulativeCanvas.width;
    const height = cumulativeCanvas.height;
    
    // Clear canvas
    cumulativeCtx.clearRect(0, 0, width, height);
    
    // Draw background
    cumulativeCtx.fillStyle = '#f8f9fa';
    cumulativeCtx.fillRect(0, 0, width, height);
    
    // Draw grid lines
    cumulativeCtx.strokeStyle = '#e9ecef';
    cumulativeCtx.lineWidth = 1;
    
    // Vertical grid lines
    for (let i = 0; i <= 10; i++) {
        const x = (width / 10) * i;
        cumulativeCtx.beginPath();
        cumulativeCtx.moveTo(x, 0);
        cumulativeCtx.lineTo(x, height);
        cumulativeCtx.stroke();
    }
    
    // Horizontal grid lines
    for (let i = 0; i <= 8; i++) {
        const y = (height / 8) * i;
        cumulativeCtx.beginPath();
        cumulativeCtx.moveTo(0, y);
        cumulativeCtx.lineTo(width, y);
        cumulativeCtx.stroke();
    }
}

// Add data point to cumulative graph
function addCumulativePoint(loadValue) {
    const now = Date.now();
    const floatValue = parseFloat(loadValue);
    
    // Validate the value to prevent extreme outliers
    if (isNaN(floatValue) || !isFinite(floatValue)) {
        console.log('Skipping invalid cumulative value:', loadValue);
        return;
    }
    
    // Check for extreme outliers (values that are too different from recent data)
    if (cumulativeData.length > 0) {
        const recentAvg = cumulativeData.slice(-5).reduce((a, b) => a + b, 0) / Math.min(cumulativeData.length, 5);
        const diff = Math.abs(floatValue - recentAvg);
        const threshold = recentAvg * 0.5; // 50% threshold
        
        if (diff > threshold && diff > 0.1) { // Also check absolute difference
            console.log('Skipping outlier cumulative value:', floatValue, 'diff:', diff, 'threshold:', threshold);
            return;
        }
    }
    
    // Add to cumulative data (unlimited)
    cumulativeData.push(floatValue);
    cumulativeTimestamps.push(now);
    
    // Update display
    if (cumulativePointsElement) {
        cumulativePointsElement.textContent = cumulativeData.length;
    }
    
    // Update graph if enough time has passed
    if (now - lastCumulativeUpdate > cumulativeUpdateInterval) {
        drawCumulativeChart();
        lastCumulativeUpdate = now;
    }
}

// Draw cumulative chart
function drawCumulativeChart() {
    if (!cumulativeCtx || cumulativeData.length < 2) return;
    
    drawCumulativeGrid();
    
    const width = cumulativeCanvas.width;
    const height = cumulativeCanvas.height;
    const padding = 40;
    const chartWidth = width - (padding * 2);
    const chartHeight = height - (padding * 2);
    
    // Calculate min/max for scaling using ALL data
    const minValue = Math.min(...cumulativeData);
    const maxValue = Math.max(...cumulativeData);
    const valueRange = maxValue - minValue || 1;
    
    // Draw cumulative chart (ALL data points)
    cumulativeCtx.strokeStyle = '#007bff';
    cumulativeCtx.lineWidth = 2;
    cumulativeCtx.beginPath();
    
    cumulativeData.forEach((value, index) => {
        const x = padding + (index / (cumulativeData.length - 1)) * chartWidth;
        const y = height - padding - ((value - minValue) / valueRange) * chartHeight;
        
        if (index === 0) {
            cumulativeCtx.moveTo(x, y);
        } else {
            cumulativeCtx.lineTo(x, y);
        }
    });
    
    cumulativeCtx.stroke();
    
    // Draw Y-axis labels
    cumulativeCtx.fillStyle = '#333';
    cumulativeCtx.font = '12px Arial';
    cumulativeCtx.textAlign = 'right';
    
    for (let i = 0; i <= 8; i++) {
        const y = padding + (i / 8) * chartHeight;
        const value = maxValue - (i / 8) * valueRange;
        cumulativeCtx.fillText(value.toFixed(2), padding - 5, y + 4);
    }
    
    // Draw X-axis label
    cumulativeCtx.textAlign = 'center';
    cumulativeCtx.fillText('All Data Points', width / 2, height - 10);
    
    // Draw statistics
    cumulativeCtx.textAlign = 'left';
    cumulativeCtx.font = '14px Arial';
    cumulativeCtx.fillStyle = '#007bff';
    cumulativeCtx.fillText(`Total Points: ${cumulativeData.length}`, 10, 20);
    cumulativeCtx.fillText(`Current: ${cumulativeData[cumulativeData.length - 1].toFixed(3)}`, 10, 40);
    cumulativeCtx.fillText(`Min: ${minValue.toFixed(3)}`, 10, 60);
    cumulativeCtx.fillText(`Max: ${maxValue.toFixed(3)}`, 10, 80);
    cumulativeCtx.fillText(`Avg: ${(cumulativeData.reduce((a, b) => a + b, 0) / cumulativeData.length).toFixed(3)}`, 10, 100);
}

// Clear cumulative graph
function clearCumulativeGraph() {
    cumulativeData = [];
    cumulativeTimestamps = [];
    drawCumulativeGrid();
    if (cumulativePointsElement) {
        cumulativePointsElement.textContent = '0';
    }
}

// Update speed counter
function updateSpeedCounter() {
    const now = Date.now();
    const timeDiff = (now - lastSpeedUpdate) / 1000; // Convert to seconds
    
    if (timeDiff > 0) {
        const speed = Math.round(readingCount / timeDiff);
        readingsPerSecondElement.textContent = speed;
        
        // Reset counters
        readingCount = 0;
        lastSpeedUpdate = now;
    }
}

// Handle incoming serial data
function handleSerialData(data) {
    if (!data) return;
    
    // Log raw data for debugging
    console.log('Raw data received:', data);
    
    // Clean the data (remove any control characters except newlines)
    const cleanData = data.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    if (cleanData.trim()) {
        logMessage('Received: ' + cleanData.trim(), 'response');
        
        // Check if this is a response to SWC command (Weight per Count)
        // Look for various possible SWC response formats
        if (!isWeightPerCountSet && (
            cleanData.includes('Weight/Count') || 
            cleanData.includes('SWC') ||
            cleanData.includes('Weight per Count') ||
            /[0-9]+\.[0-9]+/.test(cleanData) || // Look for decimal numbers
            /[0-9]+e-[0-9]+/i.test(cleanData)   // Look for scientific notation
        )) {
            parseSWCResponse(cleanData);
        }
        
        // Count individual hex values for speed tracking (filter out single digits)
        const hexMatches = cleanData.match(/-?[0-9A-Fa-f]+/g);
        if (hexMatches) {
            // Only count hex values that are 3 or more characters (likely actual sensor readings)
            const validReadings = hexMatches.filter(hex => hex.replace('-', '').length >= 3);
            readingCount += validReadings.length;
        }
        
        // Try to parse the sensor reading for hex display
        const reading = parseSensorReading(cleanData);
        if (reading !== null && reading !== '---') {
            sensorDisplay.textContent = reading;
        }
        
        // Convert to ASCII and display - process each character individually
        const asciiReading = convertRawDataToAscii(cleanData);
        if (asciiReading !== null) {
            asciiDisplay.textContent = asciiReading;
        }
    } else {
        // Log even empty data for debugging
        logMessage('Received empty/control data', 'response');
    }
}

// Parse sensor reading from the received data
function parseSensorReading(data) {
    // Remove whitespace and newlines
    const cleanData = data.trim();
    
    // First, try to find hex values and convert the most recent one
    const hexMatches = cleanData.match(/-?[0-9A-Fa-f]+/g);
    if (hexMatches && hexMatches.length > 0) {
        // Find the last valid hex value (3+ characters)
        for (let i = hexMatches.length - 1; i >= 0; i--) {
            const hex = hexMatches[i];
            const cleanHex = hex.replace('-', '');
            
            if (cleanHex.length >= 3) {
                // Convert hex to decimal
                let decimal = parseInt(cleanHex, 16);
                
                // Handle negative values (16-bit signed integer)
                if (hex.startsWith('-') || decimal > 32767) {
                    decimal = decimal - 65536; // Convert to signed 16-bit
                }
                
                return decimal.toFixed(2); // Display with 2 decimal places
            }
        }
    }
    
    // Fallback: Look for numeric values in the response
    const numberMatch = cleanData.match(/-?\d+\.?\d*/);
    if (numberMatch) {
        const value = parseFloat(numberMatch[0]);
        if (!isNaN(value)) {
            return value.toFixed(2); // Display with 2 decimal places
        }
    }
    
    // If no valid value found, return the raw data (truncated if too long)
    if (cleanData.length > 20) {
        return cleanData.substring(0, 20) + '...';
    }
    
    return cleanData;
}

// Convert hex values to ASCII
function convertHexToAscii(data) {
    try {
        // Extract hex values from the data (looking for patterns like -00089B, 00087D, etc.)
        const hexMatches = data.match(/-?[0-9A-Fa-f]+/g);
        
        if (!hexMatches || hexMatches.length === 0) {
            return null;
        }
        
        let asciiString = '';
        let hasPrintableChars = false;
        
        for (let hex of hexMatches) {
            // Remove the minus sign if present
            const cleanHex = hex.replace('-', '');
            
            // Convert hex to decimal
            const decimal = parseInt(cleanHex, 16);
            
            // Convert to ASCII character (only if it's a printable character)
            if (decimal >= 32 && decimal <= 126) {
                asciiString += String.fromCharCode(decimal);
                hasPrintableChars = true;
            } else if (decimal === 10) {
                // Handle newline
                asciiString += '\\n';
                hasPrintableChars = true;
            } else if (decimal === 13) {
                // Handle carriage return
                asciiString += '\\r';
                hasPrintableChars = true;
            } else if (decimal === 9) {
                // Handle tab
                asciiString += '\\t';
                hasPrintableChars = true;
            } else {
                // For non-printable characters, show as hex
                asciiString += `[${cleanHex}]`;
            }
        }
        
        return hasPrintableChars ? asciiString : 'No printable ASCII';
        
    } catch (error) {
        console.error('Error converting hex to ASCII:', error);
        return 'Error';
    }
}

// Convert hex sensor data to readable values
function convertRawDataToAscii(data) {
    try {
        // Add new data to buffer
        hexBuffer += data;
        
        // Extract complete hex values from the buffer
        const hexMatches = hexBuffer.match(/-?[0-9A-Fa-f]+/g);
        
        if (hexMatches && hexMatches.length > 0) {
            let sensorValues = [];
            
            // Process only the most recent valid hex values (last 3-5 values)
            const recentMatches = hexMatches.slice(-5); // Take only last 5 matches
            
            for (let hex of recentMatches) {
                // Remove the minus sign if present
                const cleanHex = hex.replace('-', '');
                
                // Skip single-digit hex values (likely control characters)
                if (cleanHex.length < 3) {
                    console.log(`Skipping short hex value: ${hex}`);
                    continue;
                }
                
                // Convert hex to decimal
                let decimal = parseInt(cleanHex, 16);
                
                // Handle negative values (16-bit signed integer)
                if (hex.startsWith('-') || decimal > 32767) {
                    decimal = decimal - 65536; // Convert to signed 16-bit
                }
                
                // Add to sensor values array
                sensorValues.push(decimal);
                console.log(`Hex: ${hex} -> Decimal: ${decimal}`);
            }
            
            // Clear the buffer after processing to prevent accumulation
            hexBuffer = '';
            
            // Display the sensor values
            if (sensorValues.length > 0) {
                // Use the most recent value, but apply some smoothing
                const latestValue = sensorValues[sensorValues.length - 1];
                
                // Simple moving average to reduce spikes (use last 3 values if available)
                let smoothedValue = latestValue;
                if (sensorValues.length >= 3) {
                    const recentValues = sensorValues.slice(-3);
                    smoothedValue = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
                }
                
                const loadValue = convertCountsToLoad(smoothedValue);
                
                // Add data point to graphs if weight per count is set
                if (isWeightPerCountSet && weightPerCount !== null) {
                    addGraphPoint(loadValue);
                    addCumulativePoint(loadValue);
                }
                
                return loadValue.toString();
            }
            
            return 'No sensor data';
        }
        
        // If no hex values found, try to process as raw character data
        let asciiString = '';
        let hasPrintableChars = false;
        
        // Process each character in the data
        for (let i = 0; i < data.length; i++) {
            const charCode = data.charCodeAt(i);
            
            // Convert to ASCII character (only if it's a printable character)
            if (charCode >= 32 && charCode <= 126) {
                asciiString += String.fromCharCode(charCode);
                hasPrintableChars = true;
            } else if (charCode === 10) {
                // Handle newline
                asciiString += '\\n';
                hasPrintableChars = true;
            } else if (charCode === 13) {
                // Handle carriage return
                asciiString += '\\r';
                hasPrintableChars = true;
            } else if (charCode === 9) {
                // Handle tab
                asciiString += '\\t';
                hasPrintableChars = true;
            } else {
                // For non-printable characters, show as hex
                asciiString += `[${charCode.toString(16).toUpperCase().padStart(2, '0')}]`;
            }
        }
        
        // Clear buffer if no hex values were found
        hexBuffer = '';
        
        return hasPrintableChars ? asciiString : 'No printable ASCII';
        
    } catch (error) {
        console.error('Error converting raw data to ASCII:', error);
        // Clear buffer on error
        hexBuffer = '';
        return 'Error';
    }
}

// Alternative ASCII conversion method for raw hex string
function convertRawHexToAscii(hexString) {
    try {
        // Remove all non-hex characters and spaces
        const cleanHex = hexString.replace(/[^0-9A-Fa-f]/g, '');
        
        if (cleanHex.length === 0) {
            return null;
        }
        
        let asciiString = '';
        
        // Process hex string in pairs
        for (let i = 0; i < cleanHex.length; i += 2) {
            const hexPair = cleanHex.substr(i, 2);
            const decimal = parseInt(hexPair, 16);
            
            // Convert to ASCII character (only if it's a printable character)
            if (decimal >= 32 && decimal <= 126) {
                asciiString += String.fromCharCode(decimal);
            } else if (decimal === 10) {
                asciiString += '\\n';
            } else if (decimal === 13) {
                asciiString += '\\r';
            } else {
                asciiString += `[${hexPair}]`;
            }
        }
        
        return asciiString || 'No printable ASCII';
        
    } catch (error) {
        console.error('Error converting raw hex to ASCII:', error);
        return 'Error';
    }
}

// Update connection status UI
function updateConnectionStatus() {
    if (isConnected) {
        connectionStatus.textContent = 'Connected';
        connectionStatus.className = 'connection-status connected';
        connectBtn.style.display = 'none';
        disconnectBtn.style.display = 'inline-block';
        sendBtn.style.display = 'inline-block';
        stopBtn.style.display = 'inline-block';
        tareBtn.style.display = 'inline-block';
        swcBtn.style.display = 'inline-block';
        manualWeightPerCount.style.display = 'inline-block';
        setManualWeightBtn.style.display = 'inline-block';
    } else {
        connectionStatus.textContent = 'Disconnected';
        connectionStatus.className = 'connection-status disconnected';
        connectBtn.style.display = 'inline-block';
        disconnectBtn.style.display = 'none';
        sendBtn.style.display = 'none';
        stopBtn.style.display = 'none';
        tareBtn.style.display = 'none';
        swcBtn.style.display = 'none';
        manualWeightPerCount.style.display = 'none';
        setManualWeightBtn.style.display = 'none';
    }
}

// Add message to log
function logMessage(message, type = 'timestamp') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    
    let className = 'timestamp';
    if (type === 'command') className = 'command';
    else if (type === 'response') className = 'response';
    else if (type === 'error') className = 'error';
    
    logEntry.innerHTML = `<span class="timestamp">[${timestamp}]</span> <span class="${className}">${message}</span>`;
    
    logContainer.appendChild(logEntry);
    
    // Auto-scroll to bottom
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // Limit log entries to prevent memory issues
    while (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

// Handle page unload
window.addEventListener('beforeunload', function() {
    if (isConnected) {
        disconnectSerial();
    }
});

    // Initialize the application
    document.addEventListener('DOMContentLoaded', function() {
        // Check if Web Serial API is supported
        if (!navigator.serial) {
            logMessage('Web Serial API not supported. Please use Chrome or Edge browser.', 'error');
            connectBtn.disabled = true;
            connectBtn.textContent = 'Not Supported';
        }
        
        // Initialize the graph
        initGraph();
        initCumulativeGraph(); // Initialize cumulative graph
        
        // Handle window resize
        window.addEventListener('resize', function() {
            if (graphCanvas) {
                graphCanvas.width = graphCanvas.offsetWidth;
                graphCanvas.height = graphCanvas.offsetHeight;
                drawGraph();
            }
            if (cumulativeCanvas) { // Also resize cumulative graph
                cumulativeCanvas.width = cumulativeCanvas.offsetWidth;
                cumulativeCanvas.height = cumulativeCanvas.offsetHeight;
                drawCumulativeChart();
            }
        });
        
        // Add keyboard shortcuts
        document.addEventListener('keydown', function(event) {
            if (event.key === 'h' || event.key === 'H') {
                if (isConnected) {
                    sendCommandH();
                }
            }
            if (event.key === 's' || event.key === 'S') {
                if (isConnected) {
                    sendStopCommand();
                }
            }
            if (event.key === 't' || event.key === 'T') {
                if (isConnected) {
                    sendTareCommand();
                }
            }
            if (event.key === 'w' || event.key === 'W') {
                if (isConnected) {
                    sendSWCCommand();
                }
            }
            if (event.key === 'm' || event.key === 'M') {
                if (isConnected) {
                    manualWeightPerCount.focus();
                }
            }
        });
        
        logMessage('Application ready. Press H key or click "Send Command H" to request sensor reading. Press S key or click "Stop" to send stop command. Press T key or click "Tare" to tare the sensor. Press W key or click "Get Weight/Count" to get the Weight/Count value for load conversion. Press M key to focus manual Weight/Count input.', 'response');
    });
