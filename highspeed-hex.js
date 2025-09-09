// High-Speed Hex Data Acquisition Module for LoadVue Pro Cloud
// Based on the UHS-1k implementation

// Global variables for high-speed serial communication
let highspeedPort = null;
let highspeedReader = null;
let highspeedWriter = null;
let highspeedIsConnected = false;
let highspeedHexBuffer = ''; // Buffer for accumulating hex data
let highspeedAsciiBuffer = ''; // Buffer for ASCII conversion
let highspeedExpectMVV = false; // Flag to indicate we're expecting an mV/V response
let highspeedExpectSWC = false; // Flag to indicate we're expecting a SWC response
let highspeedExpectSPS = false; // Flag to indicate we're expecting an SPS response

// Speed tracking variables
let highspeedReadingCount = 0;
let highspeedLastSpeedUpdate = Date.now();
let highspeedSpeedUpdateInterval = null;

// Buffered processing (queue + scheduled processor)
let highspeedSampleQueue = [];
let highspeedProcessorTimer = null;
let highspeedProcessorIntervalMs = 40; // ~25 Hz UI updates
let highspeedEMA = null;
const highspeedEMAAlpha = 0.25; // EMA smoothing factor
let highspeedTareOffsetCounts = 0; // software tare in raw counts

// mV/V display variables
let highspeedCurrentMVV = null; // Stores the current mV/V value
let highspeedIsMVVSet = false; // Flag to track if mV/V has been retrieved

// SWC (Show Weight per Count) variables
let highspeedCurrentSWC = null; // Weight per Count in calibrated units
let highspeedIsSWCSet = false; // Whether SWC was retrieved

// Helper: parse a number (supports scientific notation like 2.619E-4)
function highspeedParseNumber(text) {
    if (!text) return NaN;
    const match = String(text).match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    return match ? parseFloat(match[0]) : NaN;
}

// Graph variables
let highspeedGraphData = []; // Array to store load values for graphing
let highspeedGraphTimestamps = []; // Array to store timestamps
let highspeedMaxGraphPoints = 100; // Maximum number of points to display
let highspeedGraphCanvas = null;
let highspeedGraphCtx = null;
let highspeedLastGraphUpdate = 0;
let highspeedGraphUpdateInterval = 100; // Update graph every 100ms for high speed

// Chart.js variables for high-speed plot
let highspeedChart = null; // Global chart instance for high-speed data
let highspeedChartData = []; // Array to hold the data points
let highspeedChartLabels = []; // Array to hold the labels (timestamps)
let highspeedChartMode = 'recent'; // Track the current chart mode (recent or cumulative)

// Cumulative data variables
let highspeedCumulativeData = []; // Array to store all load values (unlimited)
let highspeedCumulativeTimestamps = []; // Array to store all timestamps
let highspeedCumulativeCanvas = null;
let highspeedCumulativeCtx = null;
let highspeedLastCumulativeUpdate = 0;
let highspeedCumulativeUpdateInterval = 100; // Update cumulative chart every 100ms

// Helper to start reading from the high-speed reader
async function startHighspeedReadLoop() {
    while (highspeedIsConnected) {
        try {
            const { done, value } = await highspeedReader.read();
            if (done) break;
            let hexChunk = '';
            for (let byte of value) {
                hexChunk += byte.toString(16).padStart(2, '0');
            }
            highspeedHandleSerialData(hexChunk);
        } catch (e) {
            console.error('High-speed read loop error:', e);
            break;
        }
    }
}

// Send command "H" to the sensor to start high-speed reading
async function highspeedSendCommandH() {
    // Require the shared serial connection (do not swap readers)
    if (!window.writer || !window.globalReader) {
        highspeedLogMessage('Serial connection not available. Please connect first.', 'error');
        return;
    }
    // Use the shared reader/writer managed by the rest of the app
    highspeedReader = window.globalReader;
    highspeedWriter = window.writer;
    highspeedIsConnected = true;
    highspeedUpdateConnectionStatus();
    // Start reading loop for high-speed data
    startHighspeedReadLoop();
    // Start buffered processor
    highspeedStartProcessor();
    // Send H command
    try {
        // Use string writes to the shared TextEncoderStream writer
        await highspeedWriter.write('H\r');
        highspeedLogMessage('Sent high-speed start command (H)', 'command');
        // Start readings/sec counter updates if not already running
        if (!highspeedSpeedUpdateInterval) {
            highspeedReadingCount = 0;
            highspeedLastSpeedUpdate = Date.now();
            highspeedSpeedUpdateInterval = setInterval(highspeedUpdateSpeedCounter, 1000);
        }
    } catch (error) {
        highspeedLogMessage('Failed to send start command: ' + error.message, 'error');
    }
}

// Send command "S" to stop high-speed reading
async function highspeedSendStopCommand() {
    const writerRef = highspeedWriter || window.writer;
    if (!writerRef) {
        highspeedLogMessage('Serial connection not available', 'error');
        return;
    }
    try {
        await writerRef.write('S\r');
        highspeedLogMessage('Sent high-speed stop command (S)', 'command');
        // Do not cancel/release the shared reader. Just mark disconnected
        highspeedReader = window.globalReader || null;
        highspeedIsConnected = false;
        highspeedUpdateConnectionStatus();
        // Stop readings/sec counter updates
        if (highspeedSpeedUpdateInterval) {
            clearInterval(highspeedSpeedUpdateInterval);
            highspeedSpeedUpdateInterval = null;
        }
        // Stop buffered processor
        highspeedStopProcessor();
    } catch (error) {
        highspeedLogMessage('Failed to send stop command: ' + error.message, 'error');
    }
}

// Send tare command to the sensor
async function highspeedSendTareCommand() {
    try {
        // Software tare: capture current processed counts as zero offset
        // Prefer EMA if available; otherwise, use recent queue median
        let tareCounts = highspeedEMA;
        if (!isFinite(tareCounts)) {
            if (highspeedSampleQueue.length > 0) {
                tareCounts = highspeedMedian(highspeedSampleQueue);
            }
        }
        if (!isFinite(tareCounts)) {
            highspeedLogMessage('No data available for tare. Start streaming first.', 'error');
            return;
        }
        highspeedTareOffsetCounts = Number(tareCounts);
        highspeedLogMessage(`Software tare set. Offset (counts): ${Math.round(highspeedTareOffsetCounts)}`, 'response');
    } catch (error) {
        highspeedLogMessage('Failed to set software tare: ' + (error?.message || error), 'error');
        console.error('High-speed software tare error:', error);
    }
}

// Refresh current mV/V value from sensor
async function highspeedRefreshMVV() {
    // If high-speed mode is active, use the dedicated writer and let the high-speed
    // read loop capture the response via highspeedExpectMVV.
    if (highspeedIsConnected && highspeedWriter) {
        await highspeedWriter.write('mvolt\r');
        highspeedLogMessage('Sent mvolt command', 'command');
        highspeedExpectMVV = true;
        return;
    }

    // Fallback: if the shared serial connection is available, use it directly so
    // mV/V can be refreshed even before starting high-speed mode.
    if (window.writer && window.globalReader) {
        try {
            const decoder = new TextDecoder();
            // Write the command using the shared writer
            await window.writer.write('mvolt\r');
            // Read until newline or short timeout
            let result = '';
            const start = Date.now();
            while (Date.now() - start < 1000) {
                const { value, done } = await window.globalReader.read();
                if (done) break;
                result += decoder.decode(value);
                if (result.includes('\n')) break;
            }
            const response = result.trim();

            if (response) {
                const mvvElement = document.getElementById('highspeed-currentMVV');
                if (mvvElement) mvvElement.textContent = response;
                highspeedLogMessage(`Current mV/V: ${response}`, 'response');
            } else {
                highspeedLogMessage('mV/V response empty', 'error');
            }
        } catch (err) {
            highspeedLogMessage('Failed to refresh mV/V: ' + (err && err.message ? err : err), 'error');
        }
        return;
    }

    highspeedLogMessage('Serial connection not available', 'error');
}

// Refresh current SWC (Show Weight per Count) value from sensor
async function highspeedRefreshSWC() {
    // If high-speed mode is active, use the dedicated writer and let the high-speed
    // read loop capture the response via highspeedExpectSWC.
    if (highspeedIsConnected && highspeedWriter) {
        await highspeedWriter.write('SWC\r');
        highspeedLogMessage('Sent SWC command', 'command');
        // Small latency to allow device to prepare response while streaming
        await new Promise(resolve => setTimeout(resolve, 200));
        highspeedExpectSWC = true;
        return;
    }

    // Fallback: use shared connection if available
    if (window.writer && window.globalReader) {
        try {
            const decoder = new TextDecoder();
            await window.writer.write('SWC\r');
            // Allow device time to compute/emit SWC
            await new Promise(resolve => setTimeout(resolve, 200));
            let result = '';
            const start = Date.now();
            while (Date.now() - start < 1500) {
                const { value, done } = await window.globalReader.read();
                if (done) break;
                result += decoder.decode(value);
                if (result.includes('\n')) break;
            }
            const response = result.trim();

            if (response) {
                const swc = highspeedParseNumber(response);
                if (!isNaN(swc) && isFinite(swc)) {
                    highspeedCurrentSWC = swc;
                    highspeedIsSWCSet = true;
                    const el = document.getElementById('highspeed-currentSWC');
                    if (el) el.textContent = swc.toExponential(6);
                    highspeedLogMessage(`Current SWC (Weight/Count): ${swc}`, 'response');
                } else {
                    highspeedLogMessage('SWC response invalid', 'error');
                }
            } else {
                highspeedLogMessage('SWC response empty', 'error');
            }
        } catch (err) {
            highspeedLogMessage('Failed to refresh SWC: ' + (err && err.message ? err : err), 'error');
        }
        return;
    }

    highspeedLogMessage('Serial connection not available', 'error');
}

// Convert counts to load values (using mV/V calibration)
function highspeedConvertCountsToLoad(counts) {
    // Apply software tare (counts offset)
    const netCounts = Number(counts) - (Number(highspeedTareOffsetCounts) || 0);
    let loadValue;
    
    // Preferred: use SWC (Weight per Count) if available
    if (typeof highspeedCurrentSWC === 'number' && isFinite(highspeedCurrentSWC)) {
        loadValue = netCounts * highspeedCurrentSWC;
    }
    // Fallback: apply legacy linear calibration if available
    else if (typeof window._weightPerRaw === 'number' && typeof window._weightOffset === 'number') {
        loadValue = window._weightPerRaw * netCounts + window._weightOffset;
    }
    // No scaling factor - use counts directly
    else {
        console.warn('Calibration not available (SWC/linear). Using raw counts');
        loadValue = netCounts;
    }
    
    // Apply displacement scaling factor if the current unit is mm or in
    if (typeof currentUnit !== 'undefined' && (currentUnit === 'mm' || currentUnit === 'in')) {
        loadValue = loadValue * 0.001; // Convert from micrometers to millimeters
    }
    
    return loadValue;
}

// Format load for display with up to 3 decimal places
function highspeedFormatLoad(value) {
    const num = Number(value);
    if (!isFinite(num)) return '---';
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

// Update speed counter
function highspeedUpdateSpeedCounter() {
    const now = Date.now();
    const timeDiff = (now - highspeedLastSpeedUpdate) / 1000; // Convert to seconds
    
    if (timeDiff > 0) {
        const speed = Math.round(highspeedReadingCount / timeDiff);
        const speedElement = document.getElementById('highspeed-readingsPerSecond');
        if (speedElement) {
            speedElement.textContent = speed;
        }
        
        // Reset counters
        highspeedReadingCount = 0;
        highspeedLastSpeedUpdate = now;
    }
}

// ===== Buffered processing helpers =====
function highspeedEnqueueCounts(counts) {
    const value = Number(counts);
    if (!isFinite(value)) return;
    highspeedSampleQueue.push(value);
    // Prevent unbounded growth
    if (highspeedSampleQueue.length > 5000) {
        highspeedSampleQueue.splice(0, highspeedSampleQueue.length - 5000);
    }
    // Track throughput based on enqueued samples
    highspeedReadingCount += 1;
}

function highspeedStartProcessor() {
    if (highspeedProcessorTimer) return;
    highspeedProcessorTimer = setInterval(highspeedProcessQueue, highspeedProcessorIntervalMs);
}

function highspeedStopProcessor() {
    if (highspeedProcessorTimer) {
        clearInterval(highspeedProcessorTimer);
        highspeedProcessorTimer = null;
    }
    highspeedSampleQueue.length = 0;
    highspeedEMA = null;
}

function highspeedMedian(values) {
    if (!values || values.length === 0) return NaN;
    const arr = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 === 1 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function highspeedProcessQueue() {
    if (highspeedSampleQueue.length === 0) return;
    // Drain current batch
    const batch = highspeedSampleQueue.splice(0, highspeedSampleQueue.length);
    const medianCounts = highspeedMedian(batch);
    if (!isFinite(medianCounts)) return;

    // EMA smoothing on top of median-batched counts
    highspeedEMA = (highspeedEMA == null)
        ? medianCounts
        : (highspeedEMAAlpha * medianCounts + (1 - highspeedEMAAlpha) * highspeedEMA);

    // Update displays from processed value
    const rawForDisplay = Math.round(highspeedEMA);
    const loadValue = highspeedConvertCountsToLoad(highspeedEMA);
    const loadDisplayText = `${highspeedFormatLoad(loadValue)} ${currentUnit}`;

    const sensorEl = document.getElementById('highspeed-sensorDisplay');
    if (sensorEl) sensorEl.textContent = rawForDisplay.toString();
    const loadEl = document.getElementById('highspeed-loadDisplay');
    if (loadEl) loadEl.textContent = loadDisplayText;

    // Plot processed value only
    highspeedAddGraphPoint(loadValue);
    highspeedAddCumulativePoint(loadValue);
    
    // Update the Chart.js plot
    updateHighspeedChart(loadValue);
}

// Handle incoming serial data
function highspeedHandleSerialData(data) {
    if (!data) return;
    // If data is a hex string (hex digits only), convert to ASCII
    const hexOnly = data.trim().replace(/\s+/g, '');
    if (/^[0-9A-Fa-f]+$/.test(hexOnly) && hexOnly.length % 2 === 0) {
        let decoded = '';
        for (let i = 0; i < hexOnly.length; i += 2) {
            decoded += String.fromCharCode(parseInt(hexOnly.substr(i, 2), 16));
        }
        data = decoded;
    }
    
    // Check for mV/V response
    if (highspeedExpectMVV) {
        const response = data.trim();
        if (response) {
            const mvvElement = document.getElementById('highspeed-currentMVV');
            if (mvvElement) mvvElement.textContent = response;
            highspeedLogMessage(`Current mV/V: ${response}`, 'response');
            highspeedExpectMVV = false;
            return; // Don't process as sensor data
        }
    }
    
    // Check for SWC response
    if (highspeedExpectSWC) {
        const response = data.trim();
        if (response) {
            const swc = highspeedParseNumber(response);
            if (!isNaN(swc) && isFinite(swc)) {
                highspeedCurrentSWC = swc;
                highspeedIsSWCSet = true;
                const el = document.getElementById('highspeed-currentSWC');
                if (el) el.textContent = swc.toExponential(6);
                highspeedLogMessage(`Current SWC (Weight/Count): ${swc}`, 'response');
            } else {
                highspeedLogMessage('SWC response invalid', 'error');
            }
            highspeedExpectSWC = false;
            return; // Don't process as sensor data
        }
    }
    
    // Log raw data for debugging
    console.log('High-speed raw data received:', data);
    
    // Clean the data (remove any control characters except newlines)
    const cleanData = data.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    if (cleanData.trim()) {
        const trimmedData = cleanData.trim();
        highspeedLogMessage('Received: ' + trimmedData, 'response');
        
        // Count individual hex values for speed tracking (filter out single digits)
        const hexMatches = cleanData.match(/-?[0-9A-Fa-f]+/g);
        if (hexMatches) {
            // Only count hex values that are 3 or more characters (likely actual sensor readings)
            const validReadings = hexMatches.filter(hex => hex.replace('-', '').length >= 3);
            highspeedReadingCount += validReadings.length;
        }
        
        // Parse latest counts and enqueue for buffered processing (no immediate UI updates)
        const reading = highspeedParseSensorReading(cleanData);
        if (reading !== null && reading !== '---') {
            const rawCount = parseFloat(reading);
            if (!isNaN(rawCount)) highspeedEnqueueCounts(rawCount);
        }
        
        // Convert to ASCII and display - process each character individually
        const asciiReading = highspeedConvertRawDataToAscii(cleanData);
        if (asciiReading !== null) {
            const asciiElement = document.getElementById('highspeed-asciiDisplay');
            if (asciiElement) {
                asciiElement.textContent = asciiReading;
            }
        }
    } else {
        // Log even empty data for debugging
        highspeedLogMessage('Received empty/control data', 'response');
    }
}

// Parse sensor reading from the received data
function highspeedParseSensorReading(data) {
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

// Convert hex sensor data to readable values
function highspeedConvertRawDataToAscii(data) {
    try {
        // Add new data to buffer
        highspeedHexBuffer += data;
        
        // Extract complete hex values from the buffer
        const hexMatches = highspeedHexBuffer.match(/-?[0-9A-Fa-f]+/g);
        
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
            highspeedHexBuffer = '';
            
            // Display the sensor values
            if (sensorValues.length > 0) {
                const latestValue = sensorValues[sensorValues.length - 1];
                // Enqueue counts for the buffered processor; UI updates handled there
                highspeedEnqueueCounts(latestValue);
                return latestValue.toString();
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
        highspeedHexBuffer = '';
        
        return hasPrintableChars ? asciiString : 'No printable ASCII';
        
    } catch (error) {
        console.error('Error converting raw data to ASCII:', error);
        // Clear buffer on error
        highspeedHexBuffer = '';
        return 'Error';
    }
}

// Always show high-speed control buttons and hide connect controls
function highspeedUpdateConnectionStatus() {
    // Hide connect/disconnect controls (guard if missing in DOM)
    const connectBtn = document.getElementById('highspeed-connectBtn');
    const disconnectBtn = document.getElementById('highspeed-disconnectBtn');
    if (connectBtn && connectBtn.style) connectBtn.style.display = 'none';
    if (disconnectBtn && disconnectBtn.style) disconnectBtn.style.display = 'none';
    // Always show Start, Stop, and Tare buttons (guard element existence)
    const startBtn = document.getElementById('highspeed-sendBtn');
    const stopBtn = document.getElementById('highspeed-stopBtn');
    const tareBtn = document.getElementById('highspeed-tareBtn');
    if (startBtn && startBtn.style) startBtn.style.display = 'inline-block';
    if (stopBtn && stopBtn.style) stopBtn.style.display = 'inline-block';
    if (tareBtn && tareBtn.style) tareBtn.style.display = 'inline-block';
    // Optionally update status text
    const statusEl = document.getElementById('highspeed-connectionStatus');
    if (statusEl) statusEl.textContent = highspeedIsConnected ? 'Connected' : 'Disconnected';
}

// Add message to log
function highspeedLogMessage(message, type = 'timestamp') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    
    let className = 'timestamp';
    if (type === 'command') className = 'command';
    else if (type === 'response') className = 'response';
    else if (type === 'error') className = 'error';
    
    logEntry.innerHTML = `<span class="timestamp">[${timestamp}]</span> <span class="${className}">${message}</span>`;
    
    const logContainer = document.getElementById('highspeed-logContainer');
    if (logContainer) {
        logContainer.appendChild(logEntry);
        
        // Auto-scroll to bottom
        logContainer.scrollTop = logContainer.scrollHeight;
        
        // Limit log entries to prevent memory issues
        while (logContainer.children.length > 100) {
            logContainer.removeChild(logContainer.firstChild);
        }
    }
}

// Initialize the high-speed hex module
document.addEventListener('DOMContentLoaded', function() {
    // Check if Web Serial API is supported
    if (!navigator.serial) {
        highspeedLogMessage('Web Serial API not supported. Please use Chrome or Edge browser.', 'error');
        const connectBtn = document.getElementById('highspeed-connectBtn');
        if (connectBtn) {
            connectBtn.disabled = true;
            connectBtn.textContent = 'Not Supported';
        }
    }
    
    // Don't initialize chart here - it will be initialized when the tab is first shown
    // initializeHighspeedChart();
    
    // Try to initialize chart when canvas becomes visible
    tryInitializeChartWhenVisible();
    
    highspeedLogMessage('High-Speed Hex module ready. Press H key or click "Start Reading" to request sensor reading. Press S key or click "Stop" to send stop command. Press T key or click "Tare" to tare the sensor.', 'response');
    
    // Initial mV/V and SWC refresh
    setTimeout(() => {
        highspeedRefreshMVV();
        highspeedRefreshSWC();
    }, 1000);
    
    // Handle window resize
    window.addEventListener('resize', function() {
        resizeHighspeedChart();
    });
});

// Handle page unload
window.addEventListener('beforeunload', function() {
    if (highspeedIsConnected) {
        // No explicit disconnect needed here as highspeedSendStopCommand handles it
    }
});

// Add data point to graph
function highspeedAddGraphPoint(loadValue) {
    const now = Date.now();
    const floatValue = parseFloat(loadValue);
    
    // Validate the value to prevent extreme outliers
    if (isNaN(floatValue) || !isFinite(floatValue)) {
        console.log('Skipping invalid value:', loadValue);
        return;
    }
    
    // Add new data point
    highspeedGraphData.push(floatValue);
    highspeedGraphTimestamps.push(now);
    
    // Limit the number of points
    if (highspeedGraphData.length > highspeedMaxGraphPoints) {
        highspeedGraphData.shift();
        highspeedGraphTimestamps.shift();
    }
}

// Add data point to cumulative graph
function highspeedAddCumulativePoint(loadValue) {
    const now = Date.now();
    const floatValue = parseFloat(loadValue);
    
    // Validate the value before plotting
    if (isNaN(floatValue) || !isFinite(floatValue)) {
        console.log('Skipping invalid cumulative value:', loadValue);
        return;
    }
    
    // Add to cumulative data (unlimited)
    highspeedCumulativeData.push(floatValue);
    highspeedCumulativeTimestamps.push(now);
}

// Clear the graph
function highspeedClearGraph() {
    highspeedGraphData = [];
    highspeedGraphTimestamps = [];
    highspeedChartData = [];
    highspeedChartLabels = [];
    if (highspeedChart) {
        highspeedChart.data.labels = [];
        highspeedChart.data.datasets[0].data = [];
        highspeedChart.update({animation: false});
    }
    document.getElementById('highspeed-maxPoints').textContent = highspeedMaxGraphPoints;
}

// Clear cumulative graph
function highspeedClearCumulativeGraph() {
    highspeedCumulativeData = [];
    highspeedCumulativeTimestamps = [];
    highspeedChartData = [];
    highspeedChartLabels = [];
    if (highspeedChart) {
        highspeedChart.data.labels = [];
        highspeedChart.data.datasets[0].data = [];
        highspeedChart.update({animation: false});
    }
}

// Initialize Chart.js chart for high-speed data
function initializeHighspeedChart() {
    console.log('initializeHighspeedChart called');
    
    // Check if chart is already initialized
    if (highspeedChart !== null) {
        console.log('Chart already initialized, returning');
        return;
    }
    
    var canvas = document.getElementById('highspeed-dataChart');
    if (!canvas) {
        console.error('Canvas element highspeed-dataChart not found');
        return;
    }
    
    // Check if Chart.js is available
    if (typeof Chart === 'undefined') {
        console.error('Chart.js library not loaded');
        return;
    }
    
    console.log('Canvas found, creating chart...');
    var ctx = canvas.getContext('2d');
    highspeedChart = new Chart(ctx, {
        type: 'line', // Line chart
        data: {
            labels: highspeedChartLabels,
            datasets: [{
                label: 'High-Speed Sensor Reading',
                backgroundColor: 'rgba(0, 0, 0, 0)', // Transparent background for the line
                borderColor: 'rgba(255, 99, 132, 1)', // Red color to match standard chart
                data: highspeedChartData,
                fill: false,
                tension: 0 // Disable bezier curves for better performance
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                xAxes: [{
                    gridLines: {
                        color: 'rgba(255, 255, 255, 0.1)' // Lighter grid lines for better visibility
                    },
                    ticks: {
                        color: 'white' // White text for x-axis labels
                    },
                    type: 'time',
                    time: {
                        unit: 'second',
                        displayFormats: {
                            second: 'h:mm:ss a'
                        }
                    }
                }],
                yAxes: [{
                    gridLines: {
                        color: 'rgba(255, 255, 255, 0.1)' // Lighter grid lines for better visibility
                    },
                    ticks: {
                        color: 'white' // White text for y-axis labels
                    }
                }]
            },
            elements: {
                line: {
                    tension: 0 // Disable bezier curves for better performance
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: 'white' // White text for legend
                    }
                },
                decimation: {
                    enabled: true,
                    algorithm: 'min-max', // Choose the decimation algorithm
                    samples: 1000 // Number of samples to keep for high-speed data
                }
            }
        }
    });
    
    console.log('Chart initialized successfully!');
}

// Function to resize highspeed chart when container size changes
function resizeHighspeedChart() {
    if (highspeedChart) {
        highspeedChart.resize();
    }
}

// Alternative initialization method using Intersection Observer
function tryInitializeChartWhenVisible() {
    const canvas = document.getElementById('highspeed-dataChart');
    if (!canvas) return;
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && highspeedChart === null) {
                console.log('Canvas is visible, initializing chart...');
                initializeHighspeedChart();
                observer.disconnect(); // Stop observing once initialized
            }
        });
    });
    
    observer.observe(canvas);
}

// Function to show the cumulative graph (all data)
function showHighspeedCumulativeGraph() {
    if (highspeedChart === null) {
        console.warn('Chart not initialized yet');
        return;
    }
    highspeedChartMode = 'cumulative';
    highspeedChart.data.labels = highspeedChartLabels;
    highspeedChart.data.datasets[0].data = highspeedChartData;
    highspeedChart.update({animation: false});
}

// Function to show only the most recent values
function showHighspeedRecentGraph() {
    if (highspeedChart === null) {
        console.warn('Chart not initialized yet');
        return;
    }
    
    highspeedChartMode = 'recent';
    var recentLabels = highspeedChartLabels.slice(-highspeedMaxGraphPoints);  // Get the last N labels
    var recentData = highspeedChartData.slice(-highspeedMaxGraphPoints);  // Get the last N data points
    highspeedChart.data.labels = recentLabels;
    highspeedChart.data.datasets[0].data = recentData;
    highspeedChart.update({animation: false});
}

// Update the high-speed chart with new data
function updateHighspeedChart(loadValue) {
    const now = new Date().toLocaleTimeString();
    const floatValue = parseFloat(loadValue);
    
    // Validate the value to prevent extreme outliers
    if (isNaN(floatValue) || !isFinite(floatValue)) {
        console.log('Skipping invalid chart value:', loadValue);
        return;
    }
    
    // Add new data point
    highspeedChartData.push(floatValue);
    highspeedChartLabels.push(now);
    
    // Limit the number of points based on mode
    if (highspeedChartMode === 'recent') {
        if (highspeedChartData.length > highspeedMaxGraphPoints) {
            highspeedChartData.shift();
            highspeedChartLabels.shift();
        }
    }
    
    // Only update chart if it's initialized
    if (highspeedChart === null) {
        return;
    }
    
    // Update chart based on current mode
    if (highspeedChartMode === 'cumulative') {
        showHighspeedCumulativeGraph();
    } else {
        showHighspeedRecentGraph();
    }
}

// Export functions to global scope for HTML onclick handlers
window.highspeedSendCommandH = highspeedSendCommandH;
window.highspeedSendStopCommand = highspeedSendStopCommand;
window.highspeedSendTareCommand = highspeedSendTareCommand;
window.initializeHighspeedChart = initializeHighspeedChart;
window.tryInitializeChartWhenVisible = tryInitializeChartWhenVisible;
window.highspeedRefreshMVV = highspeedRefreshMVV;
window.highspeedRefreshSWC = highspeedRefreshSWC;
window.highspeedClearGraph = highspeedClearGraph;
window.highspeedClearCumulativeGraph = highspeedClearCumulativeGraph;
window.showHighspeedCumulativeGraph = showHighspeedCumulativeGraph;
window.showHighspeedRecentGraph = showHighspeedRecentGraph;
window.resizeHighspeedChart = resizeHighspeedChart;
