# NTFS Timestomping Detection - Complete API Reference

## Overview

This document provides a comprehensive guide to all APIs, data flow, storage structure, and usage patterns for the NTFS Timestomping Detection application.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         NTFS Forensic System                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │   Frontend   │───▶│   Backend    │───▶│  Extraction Scripts      │  │
│  │  (React/Vite)│    │  (FastAPI)   │    │  (Python ctypes)         │  │
│  │  Port: 5173  │    │  Port: 5000  │    │                          │  │
│  └──────────────┘    └──────────────┘    └──────────────────────────┘  │
│         │                   │                        │                  │
│         │                   ▼                        ▼                  │
│         │           ┌──────────────┐         ┌─────────────┐           │
│         │           │    Routes    │         │  exports/   │           │
│         │           ├──────────────┤         │  (Storage)  │           │
│         │           │ • drives     │         └─────────────┘           │
│         │           │ • extract    │                                   │
│         │           │ • analysis   │                                   │
│         │           │ • upload     │                                   │
│         │           │ • disk       │                                   │
│         └──────────▶└──────────────┘                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Server Configuration

| Component | URL | Description |
|-----------|-----|-------------|
| Backend API | `http://localhost:5000` | FastAPI server |
| Frontend Dev | `http://localhost:5173` | Vite dev server |
| Static Exports | `http://localhost:5000/exports/` | Exported files |

---

## Storage Structure

### Export Directory Layout

```
exports/
├── MFT/
│   └── {DRIVE}/
│       └── MFT_{DRIVE}_{TIMESTAMP}.bin
├── LogFile/
│   └── {DRIVE}/
│       └── $LogFile_{DRIVE}_{TIMESTAMP}.bin
├── UsnJrnl/
│   └── {DRIVE}/
│       └── $UsnJrnl_{DRIVE}_{TIMESTAMP}.bin
└── {EXTRACTION_ID}/           # Combined extraction folder
    ├── MFT_{DRIVE}_{TIMESTAMP}.bin
    ├── LogFile_{DRIVE}_{TIMESTAMP}.bin
    ├── UsnJrnl_J_{DRIVE}_{TIMESTAMP}.bin
    └── *.csv                  # Converted CSV files
```

### Extraction ID Format
```
{DRIVE}_{YYYYMMDD}_{HHMMSS}
Example: C_20260301_143022
```

### File Naming Convention

| File Type | Pattern | Example |
|-----------|---------|---------|
| MFT Binary | `MFT_{DRIVE}_{TIMESTAMP}.bin` | `MFT_C_20260301_143022.bin` |
| LogFile Binary | `$LogFile_{DRIVE}_{TIMESTAMP}.bin` | `$LogFile_C_20260301_143022.bin` |
| UsnJrnl Binary | `$UsnJrnl_{DRIVE}_{TIMESTAMP}.bin` | `$UsnJrnl_C_20260301_143022.bin` |
| MFT CSV | `MFT_{EXTRACTION_ID}.csv` | `MFT_C_20260301_143022.csv` |
| LogFile CSV | `LogFile_{EXTRACTION_ID}.csv` | `LogFile_C_20260301_143022.csv` |
| UsnJrnl CSV | `UsnJrnl_{EXTRACTION_ID}.csv` | `UsnJrnl_C_20260301_143022.csv` |

---

## API Endpoints Reference

### 1. Health & Status

#### `GET /`
Root endpoint - Health check

**Response:**
```json
{
  "status": "ok",
  "message": "NTFS Timestomping Detection API"
}
```

#### `GET /health`
Server health status

**Response:**
```json
{
  "status": "healthy"
}
```

---

### 2. Drive Management

#### `GET /drives/`
List all NTFS drives on the system (using psutil)

**Response:**
```json
{
  "drives": [
    {
      "drive": "C:\\",
      "mountpoint": "C:\\",
      "fstype": "NTFS",
      "total_gb": 500.00,
      "free_gb": 250.00
    }
  ]
}
```

#### `GET /extract/drives`
List available drives for extraction

**Response:**
```json
{
  "available_drives": [
    {
      "letter": "C",
      "path": "C:\\",
      "total_gb": 500.00,
      "free_gb": 250.00
    }
  ],
  "count": 1
}
```

---

### 3. NTFS Artifact Extraction

> **NOTE:** Requires Administrator privileges

#### `POST /extract/extract-mft`
Extract Master File Table ($MFT) from drive

**Request:**
```json
{
  "drive": "C"
}
```

**Response:**
```json
{
  "success": true,
  "file_type": "$MFT",
  "drive": "C:",
  "output_file": "/path/to/exports/MFT/C/MFT_C_20260301_143022.bin",
  "bytes_extracted": 524288000,
  "timestamp": "20260301_143022"
}
```

#### `POST /extract/extract-logfile`
Extract NTFS Transaction Log ($LogFile)

**Request:**
```json
{
  "drive": "C"
}
```

**Response:**
```json
{
  "success": true,
  "file_type": "$LogFile",
  "drive": "C:",
  "output_file": "/path/to/exports/LogFile/C/$LogFile_C_20260301_143022.bin",
  "bytes_extracted": 4194304,
  "timestamp": "20260301_143022"
}
```

#### `POST /extract/extract-usnjrnl`
Extract USN Journal ($UsnJrnl)

**Request:**
```json
{
  "drive": "C"
}
```

**Response:**
```json
{
  "success": true,
  "file_type": "$UsnJrnl",
  "drive": "C:",
  "output_file": "/path/to/exports/UsnJrnl/C/$UsnJrnl_C_20260301_143022.bin",
  "bytes_extracted": 33554432,
  "timestamp": "20260301_143022"
}
```

#### `POST /extract/extract-all`
Extract all NTFS forensic artifacts at once

**Request:**
```json
{
  "drive": "C"
}
```

**Response:**
```json
{
  "success": true,
  "drive": "C:",
  "timestamp": "20260301_143022",
  "extraction_id": "C_20260301_143022",
  "extractions": {
    "$MFT": {
      "success": true,
      "output_file": "/path/to/exports/MFT/C/MFT_C_20260301_143022.bin",
      "bytes_extracted": 524288000,
      "error": null
    },
    "$LogFile": {
      "success": true,
      "output_file": "/path/to/exports/LogFile/C/$LogFile_C_20260301_143022.bin",
      "bytes_extracted": 4194304,
      "error": null
    },
    "$UsnJrnl": {
      "success": true,
      "output_file": "/path/to/exports/UsnJrnl/C/$UsnJrnl_C_20260301_143022.bin",
      "bytes_extracted": 33554432,
      "error": null
    }
  },
  "export_base_directory": "/path/to/exports"
}
```

#### `GET /extract/status`
Get list of all extracted files and their status

**Response:**
```json
{
  "status": "ok",
  "export_directory": "/path/to/exports",
  "total_files": 5,
  "files": [
    {
      "filename": "MFT_C_20260301_143022.bin",
      "path": "MFT/C/MFT_C_20260301_143022.bin",
      "size_mb": 500.00,
      "size_bytes": 524288000,
      "modified": "2026-03-01T14:30:22"
    }
  ]
}
```

---

### 4. Analysis & Export Management

#### `GET /analysis/exports`
List all extraction directories and their contents

**Response:**
```json
{
  "success": true,
  "status": "exports_listed",
  "total_extractions": 3,
  "data": [
    {
      "id": "C_20260301_143022",
      "drive": "C:",
      "timestamp": "C_20260301_143022",
      "files": {
        "mft": {
          "filename": "MFT_C_20260301_143022.bin",
          "size_bytes": 524288000,
          "size_mb": 500.00,
          "path": "/full/path/to/file",
          "modified": "2026-03-01T14:30:22"
        },
        "logfile": null,
        "usn_journal": null,
        "usn_status": null
      },
      "created": "2026-03-01T14:30:22"
    }
  ]
}
```

#### `GET /analysis/exports/{extraction_id}`
Get detailed information about a specific extraction

**Parameters:**
- `extraction_id` (path): The extraction directory name (e.g., "C_20260301_143022")

**Response:**
```json
{
  "success": true,
  "status": "extraction_details_retrieved",
  "data": {
    "id": "C_20260301_143022",
    "drive": "C:",
    "path": "/full/path/to/extraction",
    "created": "2026-03-01T14:30:22",
    "files": [
      {
        "filename": "MFT_C_20260301_143022.bin",
        "type": "MFT",
        "size_bytes": 524288000,
        "size_mb": 500.00,
        "path": "/full/path/to/file",
        "created": "2026-03-01T14:30:22",
        "modified": "2026-03-01T14:30:22"
      }
    ]
  }
}
```

#### `GET /analysis/list_files?drive={drive}`
List all files on a drive (filesystem enumeration)

**Parameters:**
- `drive` (query): Drive letter (e.g., "C")

**Response:**
```json
[
  {
    "name": "filename.txt",
    "path": "C:\\path\\to\\filename.txt",
    "size": 1024,
    "created": "2026-03-01T14:30:22",
    "modified": "2026-03-01T14:30:22"
  }
]
```

---

### 5. Binary to CSV Conversion

#### `POST /analysis/mft/convert`
Convert extracted MFT binary to CSV format

**Request:**
```json
{
  "extraction_id": "C_20260301_143022",
  "output_format": "csv"
}
```

**Response:**
```json
{
  "success": true,
  "status": "conversion_complete",
  "artifact": "MFT",
  "data": {
    "input_file": "/path/to/MFT.bin",
    "output_file": "/path/to/MFT.csv",
    "input_size_mb": 500.00,
    "output_size_mb": 50.00,
    "records_parsed": 500000,
    "records_in_use": 450000,
    "directories": 50000
  }
}
```

#### `POST /analysis/logfile/convert`
Convert extracted $LogFile binary to CSV format

**Request:**
```json
{
  "extraction_id": "C_20260301_143022",
  "output_format": "csv"
}
```

**Response:**
```json
{
  "success": true,
  "status": "conversion_complete",
  "artifact": "LogFile",
  "data": {
    "input_file": "/path/to/LogFile.bin",
    "output_file": "/path/to/LogFile.csv",
    "input_size_mb": 4.00,
    "output_size_mb": 1.00,
    "chunks_analyzed": 1024,
    "chunks_with_data": 800
  }
}
```

#### `POST /analysis/usnjrnl/convert`
Convert extracted $UsnJrnl binary to CSV format

**Request:**
```json
{
  "extraction_id": "C_20260301_143022",
  "output_format": "csv"
}
```

**Response:**
```json
{
  "success": true,
  "status": "conversion_complete",
  "artifact": "UsnJrnl",
  "data": {
    "input_file": "/path/to/UsnJrnl.bin",
    "output_file": "/path/to/UsnJrnl.csv",
    "input_size_mb": 32.00,
    "output_size_mb": 10.00,
    "total_records": 100000
  }
}
```

---

### 6. Disk Operations (Low-Level)

#### `GET /disk/`
Get disk module status

**Response:**
```json
{
  "status": "ok",
  "admin_required": true,
  "is_admin": true
}
```

#### `GET /disk/test-admin`
Test administrator privileges

**Response:**
```json
{
  "is_admin": true,
  "message": "Running with administrator privileges"
}
```

#### `GET /disk/exe/status`
Check if extract_mft.exe is available

**Response:**
```json
{
  "exe_available": true,
  "exe_path": "/path/to/extract_mft.exe",
  "admin_privileges": true,
  "message": "extract_mft.exe is ready to use"
}
```

#### `GET /disk/exe/list`
List drives using extract_mft.exe

**Response:**
```json
{
  "success": true,
  "data": {
    "drives": [
      {
        "letter": "C",
        "type": "NTFS"
      }
    ]
  }
}
```

#### `POST /disk/exe/extract`
Extract artifacts using extract_mft.exe

**Request:**
```json
{
  "drive": "C"
}
```

**Response:**
```json
{
  "success": true,
  "extraction": {
    "drive": "C:",
    "artifacts": {
      "MFT": {
        "status": "success",
        "path": "/path/to/MFT.bin",
        "size_bytes": 524288000
      }
    }
  }
}
```

---

### 7. Analysis (Placeholder)

#### `POST /analyze/live/{drive}`
Analyze a live NTFS drive for timestomping

**Parameters:**
- `drive` (path): Drive letter (e.g., "C")

**Response:**
```json
{
  "message": "Analysis started for drive C",
  "status": "pending"
}
```

#### `POST /analyze/image?filename={filename}`
Analyze an uploaded disk image

**Parameters:**
- `filename` (query): Name of the uploaded image file

**Response:**
```json
{
  "message": "Analysis started for image sample.dd",
  "status": "pending"
}
```

---

### 8. File Upload

#### `POST /upload/`
Upload NTFS disk image for analysis

**Request:** `multipart/form-data`
- `file`: The disk image file (.dd, .raw, .img, .e01)

**Response:**
```json
{
  "message": "File uploaded successfully",
  "filename": "sample.dd",
  "size": 1073741824
}
```

---

### 9. Static File Serving

#### `GET /exports/{path}`
Serve extracted files for download

**Example URLs:**
```
GET /exports/MFT/C/MFT_C_20260301_143022.bin
GET /exports/LogFile/C/$LogFile_C_20260301_143022.bin
GET /exports/C_20260301_143022/MFT_C_20260301_143022.csv
```

---

## Data Flow Diagrams

### Extraction Flow

```
User Request                 Backend                     Disk/Extraction
    │                           │                              │
    │  POST /extract/extract-mft│                              │
    │──────────────────────────▶│                              │
    │                           │  extract_mft(drive, path)    │
    │                           │─────────────────────────────▶│
    │                           │                              │
    │                           │      Open drive handle       │
    │                           │◀─────────────────────────────│
    │                           │      Read boot sector        │
    │                           │◀─────────────────────────────│
    │                           │      Parse NTFS header       │
    │                           │◀─────────────────────────────│
    │                           │      Seek to MFT offset      │
    │                           │◀─────────────────────────────│
    │                           │      Read MFT records        │
    │                           │◀─────────────────────────────│
    │                           │      Write to .bin file      │
    │                           │◀─────────────────────────────│
    │    Response (success)     │                              │
    │◀──────────────────────────│                              │
```

### Conversion Flow

```
User Request                 Backend                     File System
    │                           │                              │
    │  POST /analysis/mft/convert                              │
    │──────────────────────────▶│                              │
    │                           │    Find MFT binary file      │
    │                           │─────────────────────────────▶│
    │                           │◀─────────────────────────────│
    │                           │    Parse MFT records         │
    │                           │─────────────────────────────▶│
    │                           │◀─────────────────────────────│
    │                           │    Write CSV file            │
    │                           │─────────────────────────────▶│
    │                           │◀─────────────────────────────│
    │    Response (csv info)    │                              │
    │◀──────────────────────────│                              │
```

### Complete Workflow

```
1. List Drives          GET  /extract/drives
                             │
                             ▼
2. Select Drive         User selects C:
                             │
                             ▼
3. Extract Artifacts    POST /extract/extract-all
                        Body: {"drive": "C"}
                             │
                             ▼
4. Get Extraction ID    Response contains extraction_id
                        (e.g., "C_20260301_143022")
                             │
                             ▼
5. Convert to CSV       POST /analysis/mft/convert
                        Body: {"extraction_id": "C_20260301_143022"}
                             │
                             ▼
6. Download Results     GET  /exports/{path_to_csv}
                             │
                             ▼
7. Analyze Timestamps   Frontend performs comparison
                        (SI vs FN timestamps, MFT vs USN)
```

---

## Error Handling

### Error Response Format

```json
{
  "detail": "Error message describing what went wrong"
}
```

### Common HTTP Status Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 200 | Success | Request completed successfully |
| 400 | Bad Request | Invalid input parameters |
| 403 | Forbidden | Missing administrator privileges |
| 404 | Not Found | Extraction not found, drive not found |
| 500 | Server Error | Extraction failed, conversion failed |

### Permission Errors

When running without administrator privileges:
```json
{
  "detail": "Permission denied: Cannot open drive C:. Run server as Administrator."
}
```

---

## Quick Start Guide

### 1. Start the Server (as Administrator)

```powershell
# Navigate to project root
cd timestomping-detections-in-ntfs

# Start backend server
python -m uvicorn backend.main:app --host 127.0.0.1 --port 5000 --reload

# Or use the batch file
run_server_admin.bat
```

### 2. Start Frontend Development Server

```powershell
cd app
npm install
npm run dev
```

### 3. Test API Endpoints

```powershell
# Test health
curl http://localhost:5000/health

# List drives
curl http://localhost:5000/extract/drives

# Extract MFT (requires admin)
curl -X POST http://localhost:5000/extract/extract-mft -H "Content-Type: application/json" -d "{\"drive\": \"C\"}"
```

### 4. Use the Test Script

```powershell
python test_api.py
```

---

## Troubleshooting

### Issue: "Permission denied" errors
**Solution:** Run the server as Administrator

### Issue: "Drive not found" 
**Solution:** Ensure the drive letter is valid and accessible

### Issue: "Extraction not found"
**Solution:** Check that the extraction_id matches an existing folder in exports/

### Issue: Frontend cannot connect
**Solution:** Check that:
1. Backend is running on port 5000
2. CORS is enabled (it is by default)
3. Check browser console for errors

---

## Technical Notes

### MFT Record Structure
- Standard record size: 1024 bytes
- Contains file attributes (timestamps, names, data locations)
- $STANDARD_INFORMATION has manipulable timestamps
- $FILE_NAME has more reliable timestamps

### Timestomping Detection
Timestomping is detected by comparing:
1. $STANDARD_INFORMATION timestamps vs $FILE_NAME timestamps
2. MFT timestamps vs USN Journal entries
3. Looking for anomalous patterns (future dates, timestamps before file creation)

### USN Journal
- Contains chronological record of file changes
- More difficult to tamper with than MFT
- Provides corroborating evidence for file timeline

### $LogFile
- Contains transaction journal entries
- Useful for recovery and forensic analysis
- May contain evidence of timestamp modifications
