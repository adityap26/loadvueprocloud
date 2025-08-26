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

// DOM elements
const connectionStatus = document.getElementById('connectionStatus');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const sensorDisplay = document.getElementById('sensorDisplay');
const asciiDisplay = document.getElementById('asciiDisplay');
const logContainer = document.querySelector('.log');
const readingsPerSecondElement = document.getElementById('readingsPerSecond');

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
            
            for (let hex of hexMatches) {
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
                
                // Keep only the last 10 values to prevent memory buildup
                if (sensorValues.length > 10) {
                    sensorValues = sensorValues.slice(-10);
                }
            }
            
            // Keep only the last part of the buffer that might be incomplete
            const lastMatch = hexMatches[hexMatches.length - 1];
            const lastMatchIndex = hexBuffer.lastIndexOf(lastMatch);
            if (lastMatchIndex + lastMatch.length < hexBuffer.length) {
                hexBuffer = hexBuffer.substring(lastMatchIndex + lastMatch.length);
            } else {
                hexBuffer = '';
            }
            
            // Display the sensor values
            if (sensorValues.length > 0) {
                // Show only the most recent single value
                const latestValue = sensorValues[sensorValues.length - 1];
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
        
        return hasPrintableChars ? asciiString : 'No printable ASCII';
        
    } catch (error) {
        console.error('Error converting raw data to ASCII:', error);
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
    } else {
        connectionStatus.textContent = 'Disconnected';
        connectionStatus.className = 'connection-status disconnected';
        connectBtn.style.display = 'inline-block';
        disconnectBtn.style.display = 'none';
        sendBtn.style.display = 'none';
        stopBtn.style.display = 'none';
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
    });
    
    logMessage('Application ready. Press H key or click "Send Command H" to request sensor reading. Press S key or click "Stop" to send stop command.', 'response');
});
