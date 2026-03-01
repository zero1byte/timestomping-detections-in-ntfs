import os
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException
from datetime import datetime
import re

router = APIRouter()

# Path to exports directory in project root
# Goes from backend/routes/analysis/files/ up to root, then into exports/
EXPORTS_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "exports"
)


def parse_filename_for_extraction_id(filename: str) -> str:
    """
    Extract extraction_id from filename patterns:
    - MFT_C_20260301_143022.bin -> C_20260301_143022
    - $LogFile_C_20260301_143022.bin -> C_20260301_143022
    - $UsnJrnl_C_20260301_143022.bin -> C_20260301_143022
    """
    # Pattern: PREFIX_DRIVE_DATE_TIME.ext
    pattern = r'(?:\$?MFT|\$?LogFile|\$?UsnJrnl)_([A-Z])_(\d{8}_\d{6})\.'
    match = re.search(pattern, filename, re.IGNORECASE)
    if match:
        return f"{match.group(1).upper()}_{match.group(2)}"
    return ""


def scan_new_structure() -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Scan the new directory structure: exports/{Type}/{Drive}/
    Returns tuple: (extractions list, csv_files list)
    """
    extractions = {}  # Group by extraction_id
    csv_files = []  # Separate list of all CSV files
    
    artifact_types = {
        "MFT": ("mft", "MFT_"),
        "LogFile": ("logfile", "$LogFile_"),
        "UsnJrnl": ("usn_journal", "$UsnJrnl_")
    }
    
    for artifact_type, (file_key, prefix) in artifact_types.items():
        type_path = os.path.join(EXPORTS_DIR, artifact_type)
        if not os.path.isdir(type_path):
            continue
            
        for drive_folder in os.listdir(type_path):
            drive_path = os.path.join(type_path, drive_folder)
            if not os.path.isdir(drive_path):
                continue
                
            for filename in os.listdir(drive_path):
                filepath = os.path.join(drive_path, filename)
                if not os.path.isfile(filepath):
                    continue
                
                extraction_id = parse_filename_for_extraction_id(filename)
                if not extraction_id:
                    continue
                
                if extraction_id not in extractions:
                    extractions[extraction_id] = {
                        "id": extraction_id,
                        "drive": f"{extraction_id.split('_')[0]}:",
                        "timestamp": extraction_id,
                        "files": {
                            "mft": None,
                            "logfile": None,
                            "usn_journal": None,
                            "usn_status": None,
                            "mft_csv": None,
                            "logfile_csv": None,
                            "usn_csv": None
                        },
                        "created": datetime.fromtimestamp(
                            os.path.getctime(filepath)
                        ).isoformat()
                    }
                
                file_size = os.path.getsize(filepath)
                file_info = {
                    "filename": filename,
                    "size_bytes": file_size,
                    "size_mb": round(file_size / (1024 * 1024), 2),
                    "path": filepath,
                    "relative_path": f"{artifact_type}/{drive_folder}/{filename}",
                    "modified": datetime.fromtimestamp(
                        os.path.getmtime(filepath)
                    ).isoformat()
                }
                
                # Match file type - distinguish between bin and csv
                if filename.endswith(".csv"):
                    # CSV files
                    if filename.startswith("MFT_"):
                        extractions[extraction_id]["files"]["mft_csv"] = file_info
                    elif filename.startswith(("LogFile_", "$LogFile_")):
                        extractions[extraction_id]["files"]["logfile_csv"] = file_info
                    elif filename.startswith(("UsnJrnl_", "$UsnJrnl_")):
                        extractions[extraction_id]["files"]["usn_csv"] = file_info
                    # Add to csv_files list
                    csv_files.append({
                        **file_info,
                        "extraction_id": extraction_id,
                        "artifact_type": artifact_type,
                        "drive": f"{extraction_id.split('_')[0]}:"
                    })
                elif filename.endswith(".bin"):
                    # Binary files
                    if filename.startswith("MFT_"):
                        extractions[extraction_id]["files"]["mft"] = file_info
                    elif filename.startswith(("$LogFile_", "LogFile_")):
                        extractions[extraction_id]["files"]["logfile"] = file_info
                    elif filename.startswith(("$UsnJrnl_", "UsnJrnl_J_")):
                        extractions[extraction_id]["files"]["usn_journal"] = file_info
    
    return list(extractions.values()), csv_files


@router.get("/exports")
def list_exports():
    """
    List all extraction directories and their contents from exports
    
    Returns structured information about extracted artifacts.
    Supports both new structure (exports/{Type}/{Drive}/) and old structure (exports/{extraction_id}/)
    """
    if not os.path.exists(EXPORTS_DIR):
        raise HTTPException(
            status_code=404,
            detail="exports directory not found"
        )
    
    try:
        # Use the new structure scanner
        extractions, csv_files = scan_new_structure()
        
        # Also scan for old-style directories (direct extraction_id folders)
        for subdir in os.listdir(EXPORTS_DIR):
            subdir_path = os.path.join(EXPORTS_DIR, subdir)
            
            # Skip if not a directory or if it's one of the type directories
            if not os.path.isdir(subdir_path):
                continue
            if subdir in ["MFT", "LogFile", "UsnJrnl"]:
                continue
            
            # Check if this extraction_id is already found
            if any(e["id"] == subdir for e in extractions):
                continue
            
            # Parse directory name (format: E_20260228_233122)
            parts = subdir.split('_')
            drive_letter = parts[0] if parts else "Unknown"
            
            extraction_info = {
                "id": subdir,
                "drive": f"{drive_letter}:",
                "timestamp": subdir,
                "files": {
                    "mft": None,
                    "logfile": None,
                    "usn_journal": None,
                    "usn_status": None
                },
                "created": datetime.fromtimestamp(
                    os.path.getctime(subdir_path)
                ).isoformat()
            }
            
            # List files in this extraction directory
            try:
                for filename in os.listdir(subdir_path):
                    filepath = os.path.join(subdir_path, filename)
                    
                    if not os.path.isfile(filepath):
                        continue
                    
                    file_size = os.path.getsize(filepath)
                    file_info = {
                        "filename": filename,
                        "size_bytes": file_size,
                        "size_mb": round(file_size / (1024 * 1024), 2),
                        "path": filepath,
                        "relative_path": f"{subdir}/{filename}",
                        "modified": datetime.fromtimestamp(
                            os.path.getmtime(filepath)
                        ).isoformat()
                    }
                    
                    # Categorize files
                    if filename.startswith("MFT_"):
                        extraction_info["files"]["mft"] = file_info
                    elif filename.startswith(("LogFile_", "$LogFile_")):
                        extraction_info["files"]["logfile"] = file_info
                    elif filename.startswith(("UsnJrnl_J_", "$UsnJrnl_")):
                        extraction_info["files"]["usn_journal"] = file_info
                    elif filename.startswith("UsnJrnl_status_"):
                        extraction_info["files"]["usn_status"] = file_info
            
            except Exception as e:
                extraction_info["error"] = f"Failed to list files: {str(e)}"
            
            extractions.append(extraction_info)
        
        # Sort by creation time (newest first)
        extractions.sort(key=lambda x: x["created"], reverse=True)
        csv_files.sort(key=lambda x: x["modified"], reverse=True)
        
        return {
            "success": True,
            "status": "exports_listed",
            "total_extractions": len(extractions),
            "total_csv_files": len(csv_files),
            "data": extractions,
            "csv_files": csv_files
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list exports: {str(e)}"
        )


@router.get("/exports/{extraction_id}")
def get_extraction_details(extraction_id: str):
    """
    Get detailed information about a specific extraction
    
    Args:
        extraction_id: The extraction directory name (e.g., "E_20260228_233122")
    """
    extraction_path = os.path.join(EXPORTS_DIR, extraction_id)
    
    if not os.path.isdir(extraction_path):
        raise HTTPException(
            status_code=404,
            detail=f"Extraction '{extraction_id}' not found"
        )
    
    try:
        # Parse directory name
        parts = extraction_id.split('_')
        drive_letter = parts[0] if parts else "Unknown"
        
        extraction_info = {
            "id": extraction_id,
            "drive": f"{drive_letter}:",
            "path": extraction_path,
            "created": datetime.fromtimestamp(
                os.path.getctime(extraction_path)
            ).isoformat(),
            "files": []
        }
        
        # List all files with detailed info
        for filename in os.listdir(extraction_path):
            filepath = os.path.join(extraction_path, filename)
            
            if not os.path.isfile(filepath):
                continue
            
            file_size = os.path.getsize(filepath)
            extraction_info["files"].append({
                "filename": filename,
                "type": _classify_file(filename),
                "size_bytes": file_size,
                "size_mb": round(file_size / (1024 * 1024), 2),
                "path": filepath,
                "created": datetime.fromtimestamp(
                    os.path.getctime(filepath)
                ).isoformat(),
                "modified": datetime.fromtimestamp(
                    os.path.getmtime(filepath)
                ).isoformat()
            })
        
        return {
            "success": True,
            "status": "extraction_details_retrieved",
            "data": extraction_info
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get extraction details: {str(e)}"
        )


def _classify_file(filename: str) -> str:
    """Classify file type based on filename"""
    if filename.startswith("MFT_"):
        return "MFT"
    elif filename.startswith("LogFile_"):
        return "LogFile"
    elif filename.startswith("UsnJrnl_J_"):
        return "USN_Journal"
    elif filename.startswith("UsnJrnl_status_"):
        return "USN_Status"
    else:
        return "Unknown"
