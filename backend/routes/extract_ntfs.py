#!/usr/bin/env python3
"""
NTFS Forensic Extraction Routes
Extract $MFT, $LogFile, and $UsnJrnl from live NTFS partitions
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import sys
import os
from datetime import datetime
from pathlib import Path

# Add parent directories to path to import extract modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

try:
    from extract_mft import extract_mft
    from extract_logfile import extract_logfile
    from extract_usnjrnl import extract_usnjrnl
except ImportError as e:
    raise RuntimeError(f"Failed to import extraction modules: {str(e)}")

import re

router = APIRouter()

# Base export directory
BASE_EXPORT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "exports")

# Security: Valid drive letter pattern
DRIVE_PATTERN = re.compile(r'^[A-Za-z]$')


class DriveRequest(BaseModel):
    drive: str  # e.g., "C", "C:", "D", etc.


class ExtractionResponse(BaseModel):
    success: bool
    file_type: str
    drive: str
    output_file: str
    bytes_extracted: int
    timestamp: str
    extraction_id: str


def normalize_drive(drive_letter: str) -> str:
    """Normalize and validate drive letter input"""
    normalized = drive_letter.rstrip(":").upper()
    if not DRIVE_PATTERN.match(normalized):
        raise ValueError(f"Invalid drive letter: {drive_letter}. Must be a single letter A-Z.")
    return normalized


def create_export_dir(file_type: str, drive_letter: str) -> str:
    """Create and return export directory path"""
    drive = normalize_drive(drive_letter)
    export_dir = os.path.join(BASE_EXPORT_DIR, file_type.replace("$", ""), drive)
    os.makedirs(export_dir, exist_ok=True)
    return export_dir


@router.post("/extract-mft")
def extract_mft_endpoint(request: DriveRequest):
    """
    Extract $MFT from specified NTFS drive
    
    Example: POST /disk/extract-mft
    {
        "drive": "C"
    }
    """
    try:
        drive_letter = normalize_drive(request.drive)
        
        # Create output directory
        export_dir = create_export_dir("$MFT", drive_letter)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = os.path.join(export_dir, f"MFT_{drive_letter}_{timestamp}.bin")
        
        # Extract MFT
        result = extract_mft(drive_letter, output_path)
        
        if not result.get("success"):
            raise HTTPException(
                status_code=500,
                detail=f"Failed to extract MFT: {result.get('error', 'Unknown error')}"
            )
        
        extraction_id = f"{drive_letter}_{timestamp}"
        
        return ExtractionResponse(
            success=True,
            file_type="$MFT",
            drive=f"{drive_letter}:",
            output_file=output_path,
            bytes_extracted=result.get("bytes_extracted", 0),
            timestamp=timestamp,
            extraction_id=extraction_id
        )
        
    except PermissionError as e:
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied: {str(e)}. Run server as Administrator."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/extract-logfile")
def extract_logfile_endpoint(request: DriveRequest):
    """
    Extract $LogFile from specified NTFS drive
    
    Example: POST /disk/extract-logfile
    {
        "drive": "C"
    }
    """
    try:
        drive_letter = normalize_drive(request.drive)
        
        # Create output directory
        export_dir = create_export_dir("$LogFile", drive_letter)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = os.path.join(export_dir, f"$LogFile_{drive_letter}_{timestamp}.bin")
        
        # Extract $LogFile
        result = extract_logfile(drive_letter, output_path)
        
        if not result.get("success"):
            raise HTTPException(
                status_code=500,
                detail=f"Failed to extract $LogFile: {result.get('error', 'Unknown error')}"
            )
        
        extraction_id = f"{drive_letter}_{timestamp}"
        
        return ExtractionResponse(
            success=True,
            file_type="$LogFile",
            drive=f"{drive_letter}:",
            output_file=output_path,
            bytes_extracted=result.get("bytes_extracted", 0),
            timestamp=timestamp,
            extraction_id=extraction_id
        )
        
    except PermissionError as e:
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied: {str(e)}. Run server as Administrator."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/extract-usnjrnl")
def extract_usnjrnl_endpoint(request: DriveRequest):
    """
    Extract $UsnJrnl from specified NTFS drive
    
    Example: POST /disk/extract-usnjrnl
    {
        "drive": "C"
    }
    """
    try:
        drive_letter = normalize_drive(request.drive)
        
        # Create output directory
        export_dir = create_export_dir("$UsnJrnl", drive_letter)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = os.path.join(export_dir, f"$UsnJrnl_{drive_letter}_{timestamp}.bin")
        
        # Extract $UsnJrnl
        result = extract_usnjrnl(drive_letter, output_path)
        
        if not result.get("success"):
            raise HTTPException(
                status_code=500,
                detail=f"Failed to extract $UsnJrnl: {result.get('error', 'Unknown error')}"
            )
        
        extraction_id = f"{drive_letter}_{timestamp}"
        
        return ExtractionResponse(
            success=True,
            file_type="$UsnJrnl",
            drive=f"{drive_letter}:",
            output_file=output_path,
            bytes_extracted=result.get("bytes_extracted", 0),
            timestamp=timestamp,
            extraction_id=extraction_id
        )
        
    except PermissionError as e:
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied: {str(e)}. Run server as Administrator."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/extract-all")
def extract_all_endpoint(request: DriveRequest):
    """
    Extract all NTFS forensic artifacts ($MFT, $LogFile, $UsnJrnl) from specified drive
    
    Example: POST /disk/extract-all
    {
        "drive": "C"
    }
    """
    try:
        drive_letter = normalize_drive(request.drive)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        results = {}
        
        # Extract $MFT
        try:
            export_dir = create_export_dir("$MFT", drive_letter)
            mft_output = os.path.join(export_dir, f"MFT_{drive_letter}_{timestamp}.bin")
            mft_result = extract_mft(drive_letter, mft_output)
            results["$MFT"] = {
                "success": mft_result.get("success", False),
                "output_file": mft_output,
                "bytes_extracted": mft_result.get("bytes_extracted", 0),
                "error": mft_result.get("error")
            }
        except Exception as e:
            results["$MFT"] = {"success": False, "error": str(e)}
        
        # Extract $LogFile
        try:
            export_dir = create_export_dir("$LogFile", drive_letter)
            logfile_output = os.path.join(export_dir, f"$LogFile_{drive_letter}_{timestamp}.bin")
            logfile_result = extract_logfile(drive_letter, logfile_output)
            results["$LogFile"] = {
                "success": logfile_result.get("success", False),
                "output_file": logfile_output,
                "bytes_extracted": logfile_result.get("bytes_extracted", 0),
                "error": logfile_result.get("error")
            }
        except Exception as e:
            results["$LogFile"] = {"success": False, "error": str(e)}
        
        # Extract $UsnJrnl
        try:
            export_dir = create_export_dir("$UsnJrnl", drive_letter)
            usnjrnl_output = os.path.join(export_dir, f"$UsnJrnl_{drive_letter}_{timestamp}.bin")
            usnjrnl_result = extract_usnjrnl(drive_letter, usnjrnl_output)
            results["$UsnJrnl"] = {
                "success": usnjrnl_result.get("success", False),
                "output_file": usnjrnl_output,
                "bytes_extracted": usnjrnl_result.get("bytes_extracted", 0),
                "error": usnjrnl_result.get("error")
            }
        except Exception as e:
            results["$UsnJrnl"] = {"success": False, "error": str(e)}
        
        # Check if at least one extraction succeeded
        successful = any(r.get("success", False) for r in results.values())
        
        if not successful:
            raise HTTPException(
                status_code=500,
                detail=f"All extractions failed: {results}"
            )
        
        # Create extraction_id for unified reference
        extraction_id = f"{drive_letter}_{timestamp}"
        
        return {
            "success": True,
            "drive": f"{drive_letter}:",
            "timestamp": timestamp,
            "extraction_id": extraction_id,
            "extractions": results,
            "export_base_directory": BASE_EXPORT_DIR
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
def extraction_status():
    """
    Get list of all extracted files and their locations
    """
    try:
        if not os.path.exists(BASE_EXPORT_DIR):
            return {
                "status": "No extractions yet",
                "export_directory": BASE_EXPORT_DIR,
                "files": []
            }
        
        files = []
        for root, dirs, filenames in os.walk(BASE_EXPORT_DIR):
            for filename in filenames:
                filepath = os.path.join(root, filename)
                relative_path = os.path.relpath(filepath, BASE_EXPORT_DIR)
                file_size = os.path.getsize(filepath)
                modified_time = datetime.fromtimestamp(os.path.getmtime(filepath)).isoformat()
                
                files.append({
                    "filename": filename,
                    "path": relative_path,
                    "size_mb": round(file_size / (1024 * 1024), 2),
                    "size_bytes": file_size,
                    "modified": modified_time
                })
        
        return {
            "status": "ok",
            "export_directory": BASE_EXPORT_DIR,
            "total_files": len(files),
            "files": files
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/drives")
def list_available_drives():
    """
    List available NTFS drives on the system
    """
    try:
        import ctypes
        
        drives = []
        for drive_letter in "CDEFGHIJKLMNOPQRSTUVWXYZ":
            drive_path = f"{drive_letter}:\\"
            if os.path.exists(drive_path):
                try:
                    # Try to get drive info
                    total, used, free = 0, 0, 0
                    try:
                        import shutil
                        total, used, free = shutil.disk_usage(drive_path)
                    except:
                        pass
                    
                    drives.append({
                        "letter": drive_letter,
                        "path": drive_path,
                        "total_gb": round(total / (1024**3), 2) if total else 0,
                        "free_gb": round(free / (1024**3), 2) if free else 0
                    })
                except:
                    drives.append({"letter": drive_letter, "path": drive_path})
        
        return {
            "available_drives": drives,
            "count": len(drives)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
