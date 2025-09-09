console.log = function() {}
var port, textEncoder, writableStreamClosed, writer, historyIndex = -1;
const lineHistory = [];
const sensorData = [];
const timestamps = [];
let readingInterval = null;  // To manage the live reading update interval
let peakValue = -0.00;  // Initialize peak value
let lowValue = 0.00;  // Initialize low value

let currentUnit = "lb";  // Default unit
let currentResolution = 2;  // Default resolution (x.xx)
const conversionFactors = {
    lb: { lb: 1, kg: 0.453592, g: 453.592, N: 4.44822, "N-m": 1.35582, "LBF-FT": 1, mm: 25.4, in: 1 },
    kg: { lb: 2.20462, kg: 1, g: 1000, N: 9.81, "N-m": 9.81, "LBF-FT": 7.233, mm: 1000, in: 39.3701 },
    g: { lb: 0.00220462, kg: 0.001, g: 1, N: 0.00981, "N-m": 0.00981, "LBF-FT": 0.007233, mm: 1, in: 0.0393701 },
    N: { lb: 0.22480, kg: 0.10197, g: 101.972, N: 1, "N-m": 1, "LBF-FT": 0.737562, mm: 1000, in: 39.3701 },
    "N-m": { lb: 0.737562, kg: 0.10197, g: 101.972, N: 1, "N-m": 1, "LBF-FT": 0.737562, mm: 1000, in: 39.3701 },
    "LBF-FT": { lb: 1, kg: 0.138255, g: 138.255, N: 1.35582, "N-m": 1.35582, "LBF-FT": 1, mm: 1355.82, in: 53.3787 },
    mm: { lb: 0.0393701, kg: 0.001, g: 1, N: 0.001, "N-m": 0.001, "LBF-FT": 0.000737562, mm: 1, in: 0.0393701 },
    in: { lb: 1, kg: 0.0254, g: 25.4, N: 0.0254, "N-m": 0.0254, "LBF-FT": 0.018733, mm: 25.4, in: 1 }
};  // Conversion factors

// Displacement sensor scaling factor - raw values are in micrometers, need to divide by 1000 for mm
const displacementScalingFactor = 0.001; // 1/1000 to convert μm to mm

// Global reader for consistent stream management
var globalReader;

// Chart variables
var chart; // Global chart instance
var chartData = []; // Array to hold the data points
var chartLabels = []; // Array to hold the labels (timestamps)
var chartMode = 'cumulative'; // Track the current chart mode

async function connectSerial() {
    
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: parseInt(document.getElementById("baud").value) });
        
        let settings = {};
        if (localStorage.dtrOn == "true") settings.dataTerminalReady = true;
        if (localStorage.rtsOn == "true") settings.requestToSend = true;
        if (Object.keys(settings).length > 0) await port.setSignals(settings);

        textEncoder = new TextEncoderStream();
        writableStreamClosed = textEncoder.readable.pipeTo(port.writable);
        writer = textEncoder.writable.getWriter();

        // Create a global reader for managing the stream
        if (!globalReader) {
            globalReader = port.readable.getReader();
        }

        // Fetch and display sensor capacity after connecting
        const capacityValue = await fetchSensorCapacity();
        document.getElementById("sensorCapacity").value = capacityValue;

        // Fetch and display sensor ID after connecting
        const sensorID = await fetchSensorID();
        document.getElementById("sensorID").value = sensorID;

        // Fetch and display sensor units after connecting
        const sensorUnits = await fetchSensorUnits();
        document.getElementById("sensorUnits").value = sensorUnits;
        if (sensorUnits) {
            _currentUnit = sensorUnits.trim().toLowerCase();
            const unitsMapping = {
            'lb': 'lb',
            'kg': 'kg',
            'g': 'g',
            'n': 'N',
            'n-m': 'N-m',
            'nm': 'N-m',
            'newton-meter': 'N-m',
            'newton meter': 'N-m',
            'lbf-ft': 'LBF-FT',
            'lbft': 'LBF-FT',
            'pound-foot': 'LBF-FT',
            'pound foot': 'LBF-FT',
            'mm': 'mm',
            'millimeter': 'mm',
            'millimeters': 'mm',
            'in': 'in',
            'inch': 'in',
            'inches': 'in'
        };
        currentUnit = unitsMapping[_currentUnit] || _currentUnit;
        document.getElementById("unitSelect").value = currentUnit;
        }

    document.getElementById("connect").style.display = "none";
    document.getElementById("disconnect").style.display = "block";
    document.getElementById("stop").style.display = "none";
    document.getElementById("read").style.display = "block";
    document.getElementById("tare").style.display = "block";
    } catch (e){
    document.getElementById("connect").style.display = "block";
    document.getElementById("disconnect").style.display = "none";
    document.getElementById("stop").style.display = "none";
    document.getElementById("read").style.display = "none";
    document.getElementById("tare").style.display = "none";
        alert("Serial Connection Failed: " + e);
    }
}

async function disconnectSerial() {
    if (port) {
        try {
            document.getElementById("disconnect").textContent ='disconnecting please wait...';
            document.getElementById("disconnect").disabled = true;
            if (writer) {
                await writer.close();
                await writableStreamClosed;
            }
            if (globalReader) {
                await globalReader.cancel();
                globalReader.releaseLock();
                globalReader = null;
            }
            await port.close();
            alert("Serial Connection Closed Successfully");
            window.location.reload();
        } catch (e) {
            alert("Failed to close serial connection: " + e);
        } finally {
            port = null;
            writer = null;
            textEncoder = null;
            document.getElementById("disconnect").textContent ='Disconnect';
            document.getElementById("disconnect").disabled = false;
            document.getElementById("connect").style.display = "block";
            document.getElementById("disconnect").style.display = "none";
            document.getElementById("stop").style.display = "none";
            document.getElementById("read").style.display = "none";
            document.getElementById("tare").style.display = "none";
            clearInterval(readingInterval);  // Stop live reading updates
            document.getElementById("sensorID").value = "";
            document.getElementById("sensorCapacity").value = "";
            document.getElementById("sensorUnits").value = "";
        }
    } else {
        alert("No serial connection to close");
    }
}

async function fetchSensorCapacity() {
    const command = 'slc\r';  // Command to request sensor capacity
    try {
        let result = '';
        console.log('Sending capacity request command:', command);

        // Send the capacity command to the sensor
        await writer.write(command);
        console.log('Command sent successfully.');

        const decoder = new TextDecoder();
        console.log('Reading capacity from sensor...');
        
        while (true) {
            const { value, done } = await globalReader.read();
            if (done) {
                console.log('No more data to read.');
                break;
            }

            // Append the received value to the result
            result += decoder.decode(value);
            console.log('Received chunk:', value);
            console.log('Decoded chunk:', decoder.decode(value));
            
            // Break early if we expect the capacity to end with a specific character
            if (result.includes('\n')) {
                console.log('End of data detected.');
                break;
            }
        }

        console.log('Final received capacity:', result);
        return result.trim();
    } catch (error) {
        console.error('Error reading capacity:', error);
        return "Error retrieving capacity";
    }
}

async function fetchSensorID() {
    const command = 'ss1\r';  // Command to request sensor ID
    try {
        console.log('Sending ID request command:', command);

        // Send the ID command to the sensor
        await writer.write(command);
        console.log('Command sent successfully.');

        const decoder = new TextDecoder();
        let result = '';
        console.log('Reading ID from sensor...');
        
        while (true) {
            const { value, done } = await globalReader.read();
            if (done) {
                console.log('No more data to read.');
                break;
            }

            // Append the received value to the result
            result += decoder.decode(value);
            // console.log('Received chunk:', value);
            // console.log('Decoded chunk:', decoder.decode(value));
            
            // Break early if we expect the ID to end with a specific character
            if (result.includes('\n')) {
                console.log('End of data detected.');
                break;
            }
        }

        // console.log('Final received ID:', result);
        return result.trim();
    } catch (error) {
        console.error('Error reading ID:', error);
        return "Error retrieving ID";
    }
}

async function tareCmd() {
    const command = 'ct0\r';
    try {
        await writer.write(command);
        console.log('Command:%s sent successfully.',command);
        const decoder = new TextDecoder();
        let result = '';
        while (true) {
            const { value, done } = await globalReader.read();
            if (done) {
                console.log('No more data to read for Tare.');
                break;
            }

            // Append the received value to the result
            result += decoder.decode(value);
            console.log('Tare Received chunk:', value);
            console.log('Tare Decoded chunk:', decoder.decode(value));
            
            // Break early if we expect the units to end with a specific character
            if (result.includes('\n')) {
                console.log('End of data detected.');
                break;
            }
        }
    } catch (error) {
        console.error('error in tare command:%O', error)
    }
}

async function fetchSensorUnits() {
    const command = 'unit\r';  // Command to request sensor units, assuming 'unit' is the command for units
    try {
        console.log('Sending units request command:', command);

        // Send the units command to the sensor
        await writer.write(command);
        console.log('Command sent successfully.');

        const decoder = new TextDecoder();
        let result = '';
        console.log('Reading units from sensor...');
        
        while (true) {
            const { value, done } = await globalReader.read();
            if (done) {
                console.log('No more data to read.');
                break;
            }

            // Append the received value to the result
            result += decoder.decode(value);
            console.log('Received chunk:', value);
            console.log('Decoded chunk:', decoder.decode(value));
            
            // Break early if we expect the units to end with a specific character
            if (result.includes('\n')) {
                console.log('End of data detected.');
                break;
            }
        }

        console.log('Final received units:', result);
        return result.trim();
    } catch (error) {
        console.error('Error reading units:', error);
        return "Error retrieving units";
    }
}

// Enhanced sensor data fetching with device unit detection
async function fetchDeviceWeightAndUnit() {
    // Check if this is a UHS-1k sensor and use W command
    if (isUHS1kSensor()) {
        return await fetchUHS1kWeightAndUnit();
    }
    
    const command = 'o0w1\r';  // Command to request sensor data
    try {
        console.log('Sending data request command:', command);

        // Send the data command to the sensor
        await writer.write(command);
        console.log('Command sent successfully.');

        const decoder = new TextDecoder();
        let result = '';
        console.log('Reading data from sensor...');
        
        while (true) {
            const { value, done } = await globalReader.read();
            if (done) {
                console.log('No more data to read.');
                break;
            }

            // Append the received value to the result
            result += decoder.decode(value);
            console.log('Received chunk:', value);
            console.log('Decoded chunk:', decoder.decode(value));
            
            // Break early if we expect the data to end with a specific character
            if (result.includes('\n')) {
                console.log('End of data detected.');
                break;
            }
        }

        console.log('Final received data:', result);
        let weight = parseFloat(result.trim());
        const deviceUnit = document.getElementById("sensorUnits").value || currentUnit;
        
        // Apply displacement scaling factor if the sensor unit is mm or in
        const canonicalDeviceUnit = canonicalUnit(deviceUnit);
        if (canonicalDeviceUnit === 'mm' || canonicalDeviceUnit === 'in') {
            weight = weight * displacementScalingFactor;
        }
        
        return { weight, deviceUnit };
    } catch (error) {
        console.error('Error reading data:', error);
        return { weight: NaN, deviceUnit: currentUnit };
    }
}

// UHS-1k specific weight fetching using W command
async function fetchUHS1kWeightAndUnit() {
    const command = 'W\r';  // W command for UHS-1k sensor
    try {
        console.log('Sending UHS-1k W command:', command);

        // Send the W command to the sensor
        await writer.write(command);
        console.log('W command sent successfully.');

        const decoder = new TextDecoder();
        let result = '';
        console.log('Reading UHS-1k data from sensor...');
        
        // Add timeout protection for UHS-1k readings
        const startTime = Date.now();
        const timeout = 1000; // 1 second timeout
        
        while (true) {
            // Check for timeout
            if (Date.now() - startTime > timeout) {
                console.warn('UHS-1k reading timeout after', timeout, 'ms');
                break;
            }
            
            const { value, done } = await globalReader.read();
            if (done) {
                console.log('No more data to read.');
                break;
            }

            // Append the received value to the result
            result += decoder.decode(value);
            console.log('UHS-1k received chunk:', value);
            console.log('UHS-1k decoded chunk:', decoder.decode(value));
            
            // Break early if we expect the data to end with a specific character
            if (result.includes('\n')) {
                console.log('End of UHS-1k data detected.');
                break;
            }
        }

        console.log('Final UHS-1k received data:', result);
        let weight = parseFloat(result.trim());
        const deviceUnit = document.getElementById("sensorUnits").value || currentUnit;
        
        // Apply displacement scaling factor if the sensor unit is mm or in
        const canonicalDeviceUnit = canonicalUnit(deviceUnit);
        if (canonicalDeviceUnit === 'mm' || canonicalDeviceUnit === 'in') {
            weight = weight * displacementScalingFactor;
        }
        
        // Validate the weight reading
        if (isNaN(weight)) {
            console.warn('UHS-1k returned invalid weight:', result);
            return { weight: NaN, deviceUnit };
        }
        
        return { weight, deviceUnit };
    } catch (error) {
        console.error('Error reading UHS-1k data:', error);
        return { weight: NaN, deviceUnit: currentUnit };
    }
}

// Legacy function for backward compatibility
async function fetchSensorData() {
    const { weight } = await fetchDeviceWeightAndUnit();
    return weight.toFixed(2);
}

async function showCapacityNew() {
    const capacityValue = await fetchSensorCapacity();
    document.getElementById("outputCapacity").textContent = `Capacity: ${capacityValue}`;
}

function stopReading() {
    isStart = false;
        if (readingInterval) {
            clearInterval(readingInterval);  // Clear any existing interval
        }
        // disable the stop button and enable read and tare buttons
        document.getElementById("stop").style.display = "none";
        document.getElementById("read").style.display = "block";
        // document.getElementById("tare").style.display = "block";
    }

// Reading and Display Module - Enhanced from UHS-1k
let isStart = false;
let avgCount = 1;
var _currentUnit = currentUnit;
let convertedData = 0;
let displayValue = '';

// Continuous streaming helper state
let weightStreamAbortController = null; // Abort controller to break the reader loop on stop
let tareOffset = 0; // Software tare offset

// Helper: canonicalize unit strings coming from sensor
function canonicalUnit(u){
    if(!u) return u;
    const s = u.trim().toLowerCase();
    if(s.includes('lb')) return 'lb';
    if(s.includes('kg')) return 'kg';
    if(s === 'g' || s.includes('gram')) return 'g';
    if(s.startsWith('n') && !s.includes('m')) return 'N'; // Newtons (but not N-m)
    if(s.includes('n-m') || s.includes('nm') || s.includes('newton') || s.includes('newton-meter')) return 'N-m';
    if(s.includes('lbf-ft') || s.includes('lbft') || s.includes('pound') || s.includes('pound-foot')) return 'LBF-FT';
    if(s === 'mm' || s.includes('millimeter') || s.includes('millimeters')) return 'mm';
    if(s === 'in' || s.includes('inch') || s.includes('inches')) return 'in';
    if(s.includes('mlb')) return 'mlb'; // Millipounds
    return s; // fallback
}

// Helper: check if current sensor is UHS-1k
function isUHS1kSensor() {
    const sensorID = document.getElementById("sensorID").value;
    return sensorID && (sensorID.includes("TEST1K") || sensorID.includes("UHS-1k") || sensorID.includes("UHS1k"));
}

async function showReading() {
    // If we are already polling, do nothing
    if (isStart) return;

    console.log('[Reading] showReading called. Starting polling loop.');

    // Update UI state
    document.getElementById("stop").style.display = "block";
    document.getElementById("read").style.display = "none";

    isStart = true;

    // Check if this is a UHS-1k sensor for optimized polling
    const isUHS1k = isUHS1kSensor();
    
    // Averaging helpers
    let sum = 0, counter = 0;
    let inFetch = false; // Prevent overlapping fetches

    // Poll sensor at different rates based on sensor type
    // UHS-1k sensors work better with faster polling due to W command
    const pollInterval = isUHS1k ? 100 : 200; // 10 Hz for UHS-1k, 5 Hz for others
    
    console.log(`Starting polling loop for ${isUHS1k ? 'UHS-1k' : 'standard'} sensor at ${1000/pollInterval} Hz`);

    readingInterval = setInterval(async () => {
        if (!isStart) return;
        if (inFetch) return;
        inFetch = true;
        try {
            const { weight, deviceUnit } = await fetchDeviceWeightAndUnit();
            if (isNaN(weight)) {
                console.log('Received NaN weight, skipping...');
                return; // Skip invalid readings
            }

            // Use weight directly without scale factor
            let value = weight;
            
            const fromUnit = canonicalUnit(deviceUnit) || currentUnit;
            const toUnit = _currentUnit;
            if (conversionFactors[fromUnit] && conversionFactors[fromUnit][toUnit]) {
                value = value * conversionFactors[fromUnit][toUnit];
            }

            // Apply software tare offset
            value = value - tareOffset;

            // Live display
            document.getElementById("outputReading").textContent = `${value.toFixed(currentResolution)} ${toUnit}`;

            // Accumulate for averaging
            sum += value;
            counter++;

            if (counter >= avgCount) {
                const avg = sum / avgCount;
                sum = 0;
                counter = 0;

                const now = new Date().toLocaleTimeString();
                const avgStr = avg.toFixed(currentResolution);

                // Use numeric average for chart data
                chartData.push(avg);
                chartLabels.push(now);
                addToTable(now, avgStr);

                if (chartMode === 'cumulative') {
                    showCumulativeGraph();
                } else if (chartMode === 'recent') {
                    showRecentGraph();
                }

                if (avg > peakValue || !isFinite(peakValue)) {
                    peakValue = avg;
                    document.getElementById("peak-value").textContent = peakValue.toFixed(currentResolution);
                }
                if (avg < lowValue || !isFinite(lowValue)) {
                    lowValue = avg;
                    document.getElementById("low-value").textContent = lowValue.toFixed(currentResolution);
                }
            }
        } catch (err) {
            console.error('Error in polling loop:', err);
        } finally {
            inFetch = false;
        }
    }, pollInterval);
}

async function tare() {
    stopReading();
    if(chartData.length) {
        clearTable();
        chartLabels = [];
        chartData = [];
        showCumulativeGraph();
    }
    
    // Check if this is a UHS-1k sensor
    const isUHS1k = isUHS1kSensor();
    
    if (isUHS1k) {
        // For UHS-1k, use hardware tare command
        try {
            await tareCmd();
            console.log('UHS-1k hardware tare completed');
        } catch (error) {
            console.error('UHS-1k hardware tare failed:', error);
        }
    } else {
        // For other sensors, use software tare
        // Get the current reading as tare offset
        const { weight, deviceUnit } = await fetchDeviceWeightAndUnit();
        const fromUnit = canonicalUnit(deviceUnit) || currentUnit;
        const toUnit = _currentUnit;
        let value = weight; // Use weight directly without scaling
        if (conversionFactors[fromUnit] && conversionFactors[fromUnit][toUnit]) {
            value = value * conversionFactors[fromUnit][toUnit];
        }
        tareOffset = value;
    }
    
    // Reset current reading to zero
    document.getElementById("outputReading").textContent = `0.00 ${_currentUnit}`;

    // Reset peak and low values to N/A
    peakValue = Number.NEGATIVE_INFINITY;
    lowValue = Number.POSITIVE_INFINITY;
    document.getElementById("peak-value").textContent = `N/A`;
    document.getElementById("low-value").textContent = `N/A`;
}

var _currentUnit = currentUnit;

function updateUnits() {
    const prevUnit = _currentUnit;
    const newUnit = document.getElementById("unitSelect").value;
    if(newUnit != _currentUnit) {
        if(confirm("Unit changes in mid of reading, may clear all prev readings. do you want to clear all prev data?")) {
            stopReading();
        }
        // Convert all chartData values to new unit
        if (conversionFactors[prevUnit] && conversionFactors[prevUnit][newUnit]) {
            const factor = conversionFactors[prevUnit][newUnit];
            for (let i = 0; i < chartData.length; i++) {
                chartData[i] = (parseFloat(chartData[i]) * factor).toFixed(currentResolution);
            }
            // Convert peak and low values
            if (isFinite(peakValue)) {
                peakValue = parseFloat(peakValue) * factor;
            }
            if (isFinite(lowValue)) {
                lowValue = parseFloat(lowValue) * factor;
            }
        }
        // Update main display if a value is shown
        const outputElem = document.getElementById("outputReading");
        if (outputElem && outputElem.textContent && outputElem.textContent.trim() !== "") {
            const match = outputElem.textContent.match(/([-+]?\d*\.?\d+)/);
            if (match && conversionFactors[prevUnit] && conversionFactors[prevUnit][newUnit]) {
                const value = parseFloat(match[1]);
                const converted = (value * conversionFactors[prevUnit][newUnit]).toFixed(currentResolution);
                outputElem.textContent = `${converted} ${newUnit}`;
            } else {
                outputElem.textContent = `0.00 ${newUnit}`;
            }
        }
        // Update peak and low display
        document.getElementById("peak-value").textContent = isFinite(peakValue) ? peakValue.toFixed(currentResolution) : "N/A";
        document.getElementById("low-value").textContent = isFinite(lowValue) ? lowValue.toFixed(currentResolution) : "N/A";
        // Update table rows
        const tableRows = document.querySelectorAll("#data-table tbody tr");
        for (let row of tableRows) {
            // Reading is in 2nd cell, peak in 3rd, low in 4th
            let readingCell = row.children[1];
            let peakCell = row.children[2];
            let lowCell = row.children[3];
            if (readingCell && conversionFactors[prevUnit] && conversionFactors[prevUnit][newUnit]) {
                let val = parseFloat(readingCell.textContent);
                if (!isNaN(val)) readingCell.textContent = (val * conversionFactors[prevUnit][newUnit]).toFixed(currentResolution);
            }
            if (peakCell && conversionFactors[prevUnit] && conversionFactors[prevUnit][newUnit]) {
                let val = parseFloat(peakCell.textContent);
                if (!isNaN(val)) peakCell.textContent = (val * conversionFactors[prevUnit][newUnit]).toFixed(currentResolution);
            }
            if (lowCell && conversionFactors[prevUnit] && conversionFactors[prevUnit][newUnit]) {
                let val = parseFloat(lowCell.textContent);
                if (!isNaN(val)) lowCell.textContent = (val * conversionFactors[prevUnit][newUnit]).toFixed(currentResolution);
            }
        }
        // Re-render chart
        if (typeof showCumulativeGraph === 'function') showCumulativeGraph();
    }
    _currentUnit = newUnit;
    currentUnit = _currentUnit; // Update the global currentUnit variable
    removeTableHead();
    createTableHead();
    const tableBody = document.querySelector('#data-table tbody'); // Select the table body
    const table = tableBody.parentElement; // Get the table element
    table.insertBefore(createTableHead(), tableBody); // Insert the table head before the table body
    console.log('Units changed to:', currentUnit);
}

function averageReading() {
    /*
    if(isStart)
    {
        alert("Average changes in mid of reading is not allowed. Please stop reading, change average and start again");
        
        return false;
    } 
        */
        avgCount = parseInt(document.getElementById("averageReading").value);
}

function updateResolution() {
    if(isStart)
    {
        alert("Resolution changes in mid of reading is not allowed. Please stop reading, change resolution and start again");
        document.getElementById("resolutionSelect").value = currentResolution;
        return false;
    }
    currentResolution = parseInt(document.getElementById("resolutionSelect").value);
    console.log('Resolution changed to:', currentResolution);
    return true;
}


// Generic helper that converts a numeric value from one unit to another and applies
// the current resolution.  If either unit is missing from the lookup table we
// simply return the original value so we never crash the UI.
function convertUnits(value, from = currentUnit, to = _currentUnit) {
    // Bail out early if we do not have both conversion factors
    if (!conversionFactors[from] || !conversionFactors[from][to]) {
        console.warn(`No conversion factor from ${from} to ${to}. Returning raw value.`);
        return Number(value).toFixed(currentResolution);
    }

    const converted = value * conversionFactors[from][to];
    return Number(converted).toFixed(currentResolution);
}

function clearTable() {
  const tableBody = document.querySelector('#data-table tbody'); // Select the table body
  // Using a while loop (more explicit)
  while (tableBody.firstChild) {
    tableBody.removeChild(tableBody.firstChild); 
  }
}

// Function to add a row to the table
function addToTable(time, reading) {
    const tableBody = document.querySelector("#data-table tbody");
    const newRow = document.createElement("tr");

    const timeCell = document.createElement("td");
    timeCell.textContent = time;
    timeCell.style.backgroundColor = "#000000"; // Set background color to black
    timeCell.style.color = "#ffffff"; // Set text color to white
    newRow.appendChild(timeCell);

    const readingCell = document.createElement("td");
    readingCell.textContent = reading;
    readingCell.style.backgroundColor = "#000000"; // Set background color to black
    readingCell.style.color = "#ffffff"; // Set text color to white
    newRow.appendChild(readingCell);


const peakCell = document.createElement("td");
peakCell.textContent = `${peakValue}`; // Display the current peak value
peakCell.style.backgroundColor = "#000000"; // Set background color to black
peakCell.style.color = "#ffffff"; // Set text color to white
newRow.appendChild(peakCell);

const lowCell = document.createElement("td");
lowCell.textContent = `${lowValue}`; // Display the current low value
lowCell.style.backgroundColor = "#000000"; // Set background color to black
lowCell.style.color = "#ffffff"; // Set text color to white
newRow.appendChild(lowCell);

    tableBody.prepend(newRow);
}

function saveData() {
// Gather necessary information
const sensorID = document.getElementById("sensorID").value;
const sensorCapacity = document.getElementById("sensorCapacity").value;
const sensorUnits = document.getElementById("sensorUnits").value;
const testDate = new Date().toLocaleDateString();  // Format the date as needed

// CSV file content
let csvContent = `Data Log\n`;
csvContent += `ID: ${sensorID}\n`;
csvContent += `Capacity: ${sensorCapacity}\n`;
csvContent += `Units: ${sensorUnits}\n`;
csvContent += `Test Date: ${testDate}\n\n`;

// Add table headers
csvContent += `Time,Reading,Peak,Low\n`;

// Loop through the table and add the data to the CSV
const tableRows = document.querySelectorAll("#data-table tbody tr");
tableRows.forEach(row => {
    const cells = row.querySelectorAll("td");
    const rowData = Array.from(cells).map(cell => cell.textContent).join(",");
    csvContent += `${rowData}\n`;
});

// Create a Blob with the CSV content
const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

// Prompt the user to name the file
const fileName = prompt("Enter a name for the CSV file:", "data_log");

// Create a link to download the file
if (fileName) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${fileName}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
}

// Initialize Chart.js chart
function initializeChart() {
    var ctx = document.getElementById('dataChart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line', // Line chart
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Sensor Reading',
                backgroundColor: 'rgba(0, 0, 0, 0)', // Transparent background for the line
                borderColor: 'rgba(255, 99, 132, 1)',
                data: chartData,
                fill: false,
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
                    }
                }]
            },
            elements: {
                line: {
                    tension: 0 // Disable bezier curves for better performance
                }
            },
            plugins: {
                decimation: {
                    enabled: true,
                    algorithm: 'min-max', // Choose the decimation algorithm
                    samples: 5000 // Number of samples to keep
                }
            }
        }
    });
}

// Function to show the cumulative graph (default mode)
function showCumulativeGraph() {
    chartMode = 'cumulative';
    chart.data.labels = chartLabels;
    chart.data.datasets[0].data = chartData;
    chart.update();
}

// Function to show only the most recent 5 values
function showRecentGraph() {
    chartMode = 'recent';
    var recentLabels = chartLabels.slice(-10);  // Get the last 5 labels
    var recentData = chartData.slice(-10);  // Get the last 5 data points
    chart.data.labels = recentLabels;
    chart.data.datasets[0].data = recentData;
    chart.update();
}

function removeTableHead() {
const table = document.querySelector('#data-table');
const tableHead = table.querySelector('thead');
if (tableHead) {
  table.removeChild(tableHead);
}
}

function createTableHead() {
const tableHead = document.createElement("thead");
const headerRow = document.createElement("tr");
const headers = ["Time", "Reading"+` (${_currentUnit})`, "Peak"+` (${_currentUnit})`, "Low"+` (${_currentUnit})`];
headers.forEach(headerText => {
  const headerCell = document.createElement("th");
  headerCell.textContent = headerText; // Set the header text
  headerCell.style.fontWeight = "normal"; // Set normal font weight
  headerRow.appendChild(headerCell);
});

tableHead.appendChild(headerRow);
return tableHead;
}

// Tab switching functionality
function switchTab(tabName) {
    // Hide all tab contents
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => {
        content.style.display = 'none';
    });
    
    // Remove active class from all tab buttons
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(button => {
        button.classList.remove('active-tab');
    });
    
    // Show selected tab content
    const selectedTab = document.getElementById(tabName + '-tab');
    if (selectedTab) {
        selectedTab.style.display = 'block';
        
        // Initialize highspeed chart when highspeed tab is shown
        if (tabName === 'highspeed' && typeof initializeHighspeedChart === 'function') {
            console.log('Initializing highspeed chart...');
            // Use setTimeout to ensure the tab is fully visible before initializing chart
            setTimeout(() => {
                console.log('Calling initializeHighspeedChart...');
                initializeHighspeedChart();
            }, 100);
        }
        
        // Resize chart when switching to standard tab
        if (tabName === 'standard') {
            setTimeout(() => {
                resizeChart();
            }, 100);
        }
        
        // Resize highspeed chart when switching to highspeed tab
        if (tabName === 'highspeed' && typeof resizeHighspeedChart === 'function') {
            setTimeout(() => {
                resizeHighspeedChart();
            }, 100);
        }
    }
    
    // Add active class to selected tab button
    const selectedButton = document.querySelector(`[data-tab="${tabName}"]`);
    if (selectedButton) {
        selectedButton.classList.add('active-tab');
    }
    
    // Update button visibility based on tab
    if (tabName === 'standard') {
        // Show standard reading buttons when connected
        if (window.port) {
            document.getElementById("tare").style.display = "block";
            document.getElementById("read").style.display = "block";
        }
    } else if (tabName === 'highspeed') {
        // Show high-speed buttons when connected
        if (window.port) {
            document.getElementById("highspeed-sendBtn").style.display = "inline-block";
            document.getElementById("highspeed-stopBtn").style.display = "inline-block";
            document.getElementById("highspeed-tareBtn").style.display = "inline-block";
        }
    }
}

// Function to resize chart when container size changes
function resizeChart() {
    if (chart) {
        chart.resize();
    }
}

// Call initializeChart() on document ready
document.addEventListener('DOMContentLoaded', function() {
    initializeChart();
    createTableHead();
    const tableBody = document.querySelector('#data-table tbody'); // Select the table body
    const table = tableBody.parentElement; // Get the table element
    table.insertBefore(createTableHead(), tableBody); // Insert the table head before the table body
    document.getElementById("graphtype").textContent = chartMode === 'cumulative'? 'Cumulative': 'Strip Chart';
    
    // Initialize with standard tab active
    switchTab('standard');
    
    // Add resize event listener
    window.addEventListener('resize', resizeChart);
});
