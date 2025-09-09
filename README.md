# LoadVUE Pro Cloud - Single Channel Display

A comprehensive web-based serial terminal application for real-time sensor data acquisition and monitoring, designed specifically for Loadstar Sensors. This application provides both standard and high-speed data acquisition capabilities with advanced visualization and analysis features.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [System Requirements](#system-requirements)
- [Installation](#installation)
- [Usage Guide](#usage-guide)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Technical Details](#technical-details)
- [Support](#support)

## Overview

LoadVUE Pro Cloud is a browser-based application that enables real-time communication with Loadstar Sensors through the Web Serial API. It provides two main operating modes:

1. **Standard Reading Mode**: Traditional sensor data acquisition with configurable averaging and unit conversion
2. **High-Speed Hex Mode**: High-frequency data acquisition at approximately 1200Hz for real-time monitoring and analysis

The application features a modern, responsive interface with real-time plotting, data logging, and comprehensive sensor management capabilities.

## Features

### Core Functionality

- **Serial Communication**: Direct connection to Loadstar Sensors via Web Serial API
- **Real-time Data Display**: Live sensor readings with configurable resolution and units
- **Dual Operating Modes**: Standard and high-speed data acquisition
- **Unit Conversion**: Support for multiple measurement units (lb, kg, g, N, N-m, LBF-FT, mm, in)
- **Data Visualization**: Interactive charts with Chart.js integration
- **Data Logging**: Comprehensive data logging with CSV export functionality
- **Peak/Low Tracking**: Automatic tracking of maximum and minimum values
- **Tare Functionality**: Hardware and software tare capabilities

### Standard Reading Mode Features

- **Configurable Averaging**: 1, 10, 50, or 100 sample averaging
- **Resolution Control**: x, x.x, or x.xx decimal precision
- **Force vs Time Plotting**: Real-time graph with cumulative and strip chart modes
- **Data Table**: Scrollable table with timestamp, reading, peak, and low values
- **CSV Export**: Save logged data to CSV files with sensor metadata

### High-Speed Hex Mode Features

- **High-Frequency Acquisition**: ~1200Hz data sampling rate
- **Raw Sensor Counts**: Direct display of sensor raw values
- **Load Value Calculation**: Real-time conversion using mV/V and SWC calibration
- **Buffered Processing**: Queue-based processing with EMA smoothing
- **Speed Monitoring**: Real-time readings per second counter
- **ASCII Display**: Raw data conversion and display
- **Calibration Management**: mV/V and SWC (Weight per Count) retrieval and display

### User Interface Features

- **Tabbed Interface**: Clean separation between standard and high-speed modes
- **Responsive Design**: Adapts to different screen sizes
- **Real-time Status**: Connection status and sensor information display
- **Interactive Controls**: Intuitive button layout with clear labeling
- **Dark Theme**: Professional black background with high contrast text

## System Requirements

### Browser Compatibility
- **Chrome**: Version 89+ (recommended)
- **Edge**: Version 89+
- **Opera**: Version 76+
- **Other browsers**: Limited or no Web Serial API support

### Hardware Requirements
- **USB Serial Port**: For sensor connection
- **Loadstar Sensor**: Compatible with Loadstar sensor protocols
- **Minimum RAM**: 4GB recommended
- **Display**: 1024x768 minimum resolution

### Software Requirements
- **Operating System**: Windows 10+, macOS 10.15+, or Linux
- **Web Browser**: Modern browser with Web Serial API support
- **No additional software**: Runs entirely in the browser

## Installation

### Method 1: Direct File Access
1. Download all project files to a local directory
2. Open `index.html` in a compatible web browser
3. The application will load automatically

### Method 2: Local Web Server (Recommended)
1. Download all project files to a local directory
2. Start a local web server in the project directory:
   ```bash
   # Using Python 3
   python -m http.server 8000
   
   # Using Node.js (if you have http-server installed)
   npx http-server
   
   # Using PHP
   php -S localhost:8000
   ```
3. Open `http://localhost:8000` in your browser

### Method 3: Web Hosting
1. Upload all files to a web server
2. Access the application via the web server URL

## Usage Guide

### Initial Setup

1. **Connect Sensor**:
   - Click "Connect Serial Port" button
   - Select your sensor from the device list
   - The application will automatically detect sensor properties

2. **Configure Settings**:
   - Set baud rate (9600 or 230400)
   - Verify sensor ID, capacity, and units are displayed
   - Adjust resolution and units as needed

### Standard Reading Mode

1. **Start Reading**:
   - Click "Read" button to begin data acquisition
   - Live readings will appear in the main display
   - Peak and low values will be tracked automatically

2. **Configure Averaging**:
   - Select averaging level (1, 10, 50, or 100 samples)
   - Higher averaging provides smoother readings but slower response

3. **View Data**:
   - **Cumulative Graph**: Shows all data points since start
   - **Strip Chart**: Shows only recent data points
   - **Data Table**: Scrollable list of all readings with timestamps

4. **Export Data**:
   - Click "Save Data" to download CSV file
   - File includes sensor metadata and all logged readings

### High-Speed Hex Mode

1. **Prepare for High-Speed Reading**:
   - Switch to "High-Speed Hex" tab
   - Click "Grab mV/V" to retrieve sensor calibration
   - Click "Grab SWC" to retrieve weight per count value
   - Verify calibration values are correct

2. **Start High-Speed Acquisition**:
   - Click "Start Reading (H)" to begin high-speed data stream
   - Monitor readings per second counter
   - View raw sensor counts and calculated load values

3. **Monitor Performance**:
   - Check readings per second display
   - Monitor ASCII display for data quality
   - Use real-time graph for trend analysis

4. **Tare Sensor**:
   - Click "Tare (T)" to zero the sensor
   - Software tare captures current reading as offset

### Unit Conversion

The application supports conversion between multiple units:
- **Force Units**: lb, kg, g, N
- **Torque Units**: N-m, LBF-FT
- **Length Units**: mm, in

To change units:
1. Select desired unit from the dropdown
2. All existing data will be converted automatically
3. New readings will be displayed in the selected unit

### Tare Operations

**Standard Mode Tare**:
- Hardware tare for UHS-1k sensors
- Software tare for other sensor types

**High-Speed Mode Tare**:
- Software tare using current reading as offset
- Maintains tare offset throughout session

## API Reference

### Serial Communication Commands

| Command | Description | Response |
|---------|-------------|----------|
| `slc\r` | Get sensor capacity | Capacity value |
| `ss1\r` | Get sensor ID | Sensor identifier |
| `unit\r` | Get sensor units | Unit string |
| `o0w1\r` | Get sensor reading | Weight value |
| `W\r` | UHS-1k weight command | Weight value |
| `ct0\r` | Hardware tare | Tare confirmation |
| `H\r` | Start high-speed reading | Begin hex data stream |
| `S\r` | Stop high-speed reading | Stop data stream |
| `mvolt\r` | Get mV/V calibration | Calibration value |
| `SWC\r` | Get weight per count | SWC value |

### JavaScript Functions

#### Connection Management
```javascript
connectSerial()           // Establish serial connection
disconnectSerial()        // Close serial connection
```

#### Data Acquisition
```javascript
showReading()             // Start standard reading mode
stopReading()             // Stop reading mode
tare()                    // Perform tare operation
```

#### High-Speed Functions
```javascript
highspeedSendCommandH()   // Start high-speed reading
highspeedSendStopCommand() // Stop high-speed reading
highspeedSendTareCommand() // High-speed tare
highspeedRefreshMVV()     // Get mV/V calibration
highspeedRefreshSWC()     // Get SWC calibration
```

#### Data Management
```javascript
saveData()                // Export data to CSV
showCumulativeGraph()     // Show all data points
showRecentGraph()         // Show recent data points
```

#### Configuration
```javascript
updateUnits()             // Change display units
updateResolution()        // Change decimal precision
averageReading()          // Set averaging level
```

## Configuration

### Baud Rate Settings
- **9600**: Standard rate for most sensors
- **230400**: High-speed rate for UHS-1k sensors

### Resolution Options
- **x**: Whole numbers only
- **x.x**: One decimal place
- **x.xx**: Two decimal places (default)

### Averaging Options
- **1**: No averaging (fastest response)
- **10**: Light averaging
- **50**: Moderate averaging
- **100**: Heavy averaging (smoothest readings)

### High-Speed Settings
- **Max Graph Points**: 10-1000 points (default: 100)
- **Update Interval**: 50-1000ms (default: 100ms)

## Troubleshooting

### Connection Issues

**Problem**: Cannot connect to sensor
- **Solution**: Ensure sensor is connected and powered
- **Check**: Browser supports Web Serial API
- **Verify**: Correct COM port selection

**Problem**: Connection drops frequently
- **Solution**: Check USB cable and port stability
- **Try**: Different USB port or cable
- **Verify**: Sensor power supply is stable

### Data Issues

**Problem**: No readings displayed
- **Solution**: Verify sensor is properly calibrated
- **Check**: Baud rate matches sensor configuration
- **Try**: Restart application and reconnect

**Problem**: Erratic readings
- **Solution**: Check for electrical interference
- **Try**: Different averaging settings
- **Verify**: Sensor mounting and load application

### High-Speed Mode Issues

**Problem**: Low readings per second
- **Solution**: Check USB connection quality
- **Try**: Different USB port
- **Verify**: Sensor supports high-speed mode

**Problem**: Calibration values not updating
- **Solution**: Ensure sensor is in correct mode
- **Try**: Manual refresh of mV/V and SWC
- **Check**: Sensor communication protocol

### Browser Issues

**Problem**: Web Serial API not available
- **Solution**: Use Chrome, Edge, or Opera browser
- **Check**: Browser version is 89 or higher
- **Try**: Enable experimental features if needed

**Problem**: Application won't load
- **Solution**: Check browser console for errors
- **Try**: Clear browser cache
- **Verify**: All files are present and accessible

## Technical Details

### Architecture

The application consists of three main components:

1. **index.html**: Main user interface and layout
2. **script.js**: Core application logic and standard mode functionality
3. **highspeed-hex.js**: High-speed data acquisition module

### Data Flow

1. **Serial Communication**: Web Serial API handles device communication
2. **Data Processing**: Raw sensor data is parsed and converted
3. **Display Updates**: Real-time UI updates with processed data
4. **Storage**: Data is logged in memory and can be exported

### Performance Considerations

- **Standard Mode**: 5-10 Hz update rate
- **High-Speed Mode**: ~1200 Hz data acquisition with 25 Hz UI updates
- **Memory Management**: Automatic cleanup of old data points
- **Chart Optimization**: Decimation and efficient rendering

### Security

- **Local Operation**: No data transmitted to external servers
- **Browser Security**: Web Serial API provides secure device access
- **Data Privacy**: All data remains on local machine

## Support

### Documentation
- This README provides comprehensive usage information
- Code comments explain implementation details
- Browser console provides debugging information

### Common Solutions
- Check browser compatibility requirements
- Verify sensor connection and power
- Review troubleshooting section for specific issues

### Contact Information
For technical support or questions about Loadstar Sensors:
- **Website**: [Loadstar Sensors](https://www.loadstarsensors.com)
- **Support**: Contact Loadstar Sensors technical support
- **Documentation**: Refer to sensor-specific documentation

---

**Loadstar Sensors Copyright 2025 All Rights Reserved.**

*This application is designed for use with Loadstar Sensors and provides professional-grade data acquisition capabilities for industrial and research applications.*
