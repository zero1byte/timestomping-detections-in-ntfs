# NTFS Forensic Extraction API Routes

## Overview
This document describes the API routes for extracting forensic artifacts from NTFS partitions.

## Base URL
```
http://localhost:5000
```

## Routes

### 1. Extract $MFT (Master File Table)
**Endpoint:** `POST /extract/extract-mft`

**Request Body:**
```json
{
  "drive": "C"
}
```

**Parameters:**
- `drive` (string): Drive letter (C, D, E, etc.) - with or without colon

**Response:**
```json
{
  "success": true,
  "file_type": "$MFT",
  "drive": "C:",
  "output_file": "/path/to/exports/$MFT/C/MFT_C_20260228_120000.bin",
  "bytes_extracted": 524288000,
  "timestamp": "20260228_120000"
}
```

### 2. Extract $LogFile (NTFS Transaction Log)
**Endpoint:** `POST /extract/extract-logfile`

**Request Body:**
```json
{
  "drive": "C"
}
```

**Parameters:**
- `drive` (string): Drive letter (C, D, E, etc.) - with or without colon

**Response:**
```json
{
  "success": true,
  "file_type": "$LogFile",
  "drive": "C:",
  "output_file": "/path/to/exports/$LogFile/C/$LogFile_C_20260228_120000.bin",
  "bytes_extracted": 4194304,
  "timestamp": "20260228_120000"
}
```

### 3. Extract $UsnJrnl (USN Journal)
**Endpoint:** `POST /extract/extract-usnjrnl`

**Request Body:**
```json
{
  "drive": "C"
}
```

**Parameters:**
- `drive` (string): Drive letter (C, D, E, etc.) - with or without colon

**Response:**
```json
{
  "success": true,
  "file_type": "$UsnJrnl",
  "drive": "C:",
  "output_file": "/path/to/exports/$UsnJrnl/C/$UsnJrnl_C_20260228_120000.bin",
  "bytes_extracted": 33554432,
  "timestamp": "20260228_120000"
}
```

### 4. Extract All Artifacts
**Endpoint:** `POST /extract/extract-all`

**Request Body:**
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
  "timestamp": "20260228_120000",
  "extractions": {
    "$MFT": {
      "success": true,
      "output_file": "/path/to/exports/$MFT/C/MFT_C_20260228_120000.bin",
      "bytes_extracted": 524288000,
      "error": null
    },
    "$LogFile": {
      "success": true,
      "output_file": "/path/to/exports/$LogFile/C/$LogFile_C_20260228_120000.bin",
      "bytes_extracted": 4194304,
      "error": null
    },
    "$UsnJrnl": {
      "success": true,
      "output_file": "/path/to/exports/$UsnJrnl/C/$UsnJrnl_C_20260228_120000.bin",
      "bytes_extracted": 33554432,
      "error": null
    }
  },
  "export_base_directory": "/path/to/exports"
}
```

### 5. Get Extraction Status
**Endpoint:** `GET /extract/status`

**Response:**
```json
{
  "status": "ok",
  "export_directory": "/path/to/exports",
  "total_files": 5,
  "files": [
    {
      "filename": "MFT_C_20260228_120000.bin",
      "path": "$MFT/C/MFT_C_20260228_120000.bin",
      "size_mb": 500.0,
      "size_bytes": 524288000,
      "modified": "2026-02-28T12:00:00"
    },
    {
      "filename": "$LogFile_C_20260228_120000.bin",
      "path": "$LogFile/C/$LogFile_C_20260228_120000.bin",
      "size_mb": 4.0,
      "size_bytes": 4194304,
      "modified": "2026-02-28T12:00:00"
    }
  ]
}
```

### 6. List Available Drives
**Endpoint:** `GET /extract/drives`

**Response:**
```json
{
  "available_drives": [
    {
      "letter": "C",
      "path": "C:\\",
      "total_gb": 1000.0,
      "free_gb": 500.0
    },
    {
      "letter": "D",
      "path": "D:\\",
      "total_gb": 2000.0,
      "free_gb": 1500.0
    }
  ],
  "count": 2
}
```

## Directory Structure

Files are organized in the following directory structure:

```
exports/
├── MFT/
│   ├── C/
│   │   ├── MFT_C_20260228_120000.bin
│   │   └── MFT_C_20260228_121000.bin
│   └── D/
│       └── MFT_D_20260228_120000.bin
├── $LogFile/
│   └── C/
│       └── $LogFile_C_20260228_120000.bin
└── $UsnJrnl/
    └── C/
        └── $UsnJrnl_C_20260228_120000.bin
```

## Usage Examples

### Using cURL

Extract $MFT from C: drive:
```bash
curl -X POST "http://localhost:5000/extract/extract-mft" \
  -H "Content-Type: application/json" \
  -d '{"drive": "C"}'
```

Extract all artifacts from D: drive:
```bash
curl -X POST "http://localhost:5000/extract/extract-all" \
  -H "Content-Type: application/json" \
  -d '{"drive": "D"}'
```

Get extraction status:
```bash
curl "http://localhost:5000/extract/status"
```

### Using Python Requests

```python
import requests

# Extract $MFT
response = requests.post(
    "http://localhost:5000/extract/extract-mft",
    json={"drive": "C"}
)
print(response.json())

# Extract all
response = requests.post(
    "http://localhost:5000/extract/extract-all",
    json={"drive": "C"}
)
print(response.json())
```

### Using Postman

1. Create a new POST request to `http://localhost:5000/extract/extract-mft`
2. Set Body to raw JSON:
   ```json
   {
     "drive": "C"
   }
   ```
3. Send the request

## Requirements

- **Administrator Privileges**: The server must be run as Administrator to extract from live partitions
- **Python 3.7+**: Required to run the extraction scripts
- **FastAPI**: Web framework
- **Windows OS**: Only works on Windows NTFS systems

## Running the Server

**As Administrator:**

```bash
cd backend
python main.py
```

Or with uvicorn:

```bash
uvicorn main:app --host 127.0.0.1 --port 5000 --reload
```

## Error Handling

Common error responses:

### 403 - Permission Denied
```json
{
  "detail": "Permission denied: Cannot open drive C:. Run as Administrator. (Error: 5)"
}
```

**Solution:** Run the server as Administrator

### 500 - Extraction Failed
```json
{
  "detail": "Failed to extract MFT: Could not extract data"
}
```

**Solution:** Ensure the drive is NTFS formatted and accessible

## Notes

- Each extraction creates timestamped files to avoid overwriting previous extractions
- Files are organized by artifact type and drive letter for easy management
- The `/extract/status` endpoint provides a complete inventory of all extracted artifacts
- All routes require the server to run with Administrator privileges
