import os
import re
import sys
from typing import Optional, Tuple
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, validator

# Add backend/routes to path for importing log_usn_to_csv
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from log_usn_to_csv import export_usn_j, export_usn_max, USNJ_COLUMNS, USNMAX_COLUMNS

router = APIRouter()

# Path to exports directory in project root
# Goes from backend/routes/analysis/convert/ up to root, then into exports/
EXPORTS_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "exports"
)

# Security: Validate extraction_id format to prevent path traversal
EXTRACTION_ID_PATTERN = re.compile(r'^[A-Za-z]_\d{8}_\d{6}$')


class ConvertRequest(BaseModel):
    extraction_id: str
    output_format: str = "csv"

    @validator('extraction_id')
    def validate_extraction_id(cls, v):
        if not EXTRACTION_ID_PATTERN.match(v):
            raise ValueError('Invalid extraction_id format. Expected: {DRIVE}_{YYYYMMDD}_{HHMMSS}')
        return v


def parse_extraction_id(extraction_id: str) -> Tuple[str, str]:
    """
    Parse extraction_id to get drive letter and timestamp
    Format: {DRIVE}_{YYYYMMDD}_{HHMMSS} e.g., C_20260301_143022
    """
    parts = extraction_id.split('_')
    if len(parts) >= 3:
        drive = parts[0].upper()
        timestamp = f"{parts[1]}_{parts[2]}"
        return drive, timestamp
    return extraction_id, ""


def find_artifact_file(extraction_id: str, artifact_type: str, prefix: str) -> Optional[Tuple[str, str]]:
    """
    Find artifact file in the exports directory structure.
    Supports both new structure (exports/{Type}/{Drive}/) and old structure (exports/{extraction_id}/)
    """
    drive, timestamp = parse_extraction_id(extraction_id)
    
    # Try new structure first: exports/{Type}/{Drive}/
    new_structure_path = os.path.join(EXPORTS_DIR, artifact_type, drive)
    if os.path.isdir(new_structure_path):
        for filename in os.listdir(new_structure_path):
            if filename.startswith(prefix) and timestamp in filename:
                return os.path.join(new_structure_path, filename), new_structure_path
    
    # Try old structure: exports/{extraction_id}/
    old_structure_path = os.path.join(EXPORTS_DIR, extraction_id)
    if os.path.isdir(old_structure_path):
        for filename in os.listdir(old_structure_path):
            if filename.startswith(prefix):
                return os.path.join(old_structure_path, filename), old_structure_path
    
    # Try direct path for any file with the prefix in new structure
    if os.path.isdir(new_structure_path):
        for filename in os.listdir(new_structure_path):
            if filename.startswith(prefix):
                return os.path.join(new_structure_path, filename), new_structure_path
    
    return None


@router.post("/usnjrnl/convert")
def convert_usnjrnl_to_csv(request: ConvertRequest):
    """
    Convert extracted $UsnJrnl:$J binary to CSV format
    Uses comprehensive parser from log_usn_to_csv.py:
    - USN_RECORD_V2 and V3 support
    - Full reason code decoding
    - File reference and parent reference parsing
    - 64MB chunk processing for large journals
    """
    # Find USN Journal file using the helper function
    result = find_artifact_file(request.extraction_id, "UsnJrnl", "$UsnJrnl_")
    
    if not result:
        # Also try UsnJrnl_J_ prefix
        result = find_artifact_file(request.extraction_id, "UsnJrnl", "UsnJrnl_J_")
    
    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"USN Journal file not found for extraction '{request.extraction_id}'. "
                   f"Looked in exports/UsnJrnl/{request.extraction_id.split('_')[0]}/ and exports/{request.extraction_id}/"
        )
    
    usnjrnl_path, output_dir = result
    
    try:
        # Create output CSV file path
        csv_output = os.path.join(
            output_dir,
            f"UsnJrnl_{request.extraction_id}.csv"
        )
        
        input_size = os.path.getsize(usnjrnl_path)
        
        # Use comprehensive export function from log_usn_to_csv.py
        # This handles USN_RECORD_V2/V3, large file chunking, reason codes
        records_parsed = export_usn_j(usnjrnl_path, csv_output)
        
        csv_size = os.path.getsize(csv_output)
        
        return {
            "success": True,
            "status": "conversion_complete",
            "artifact": "USN_Journal",
            "data": {
                "input_file": usnjrnl_path,
                "output_file": csv_output,
                "input_size_mb": round(input_size / (1024 * 1024), 2),
                "output_size_mb": round(csv_size / (1024 * 1024), 2),
                "records_parsed": records_parsed,
                "columns": len(USNJ_COLUMNS),
                "column_info": [
                    "usn - Update Sequence Number",
                    "timestamp - File modification time",
                    "reason - Change reason bitmap",
                    "reason_str - Human-readable reason",
                    "file_ref_num, parent_ref_num - MFT references",
                    "filename - File/directory name",
                    "file_attrs - File attributes bitmap",
                    "source_info, security_id"
                ]
            }
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to convert USN Journal: {str(e)}"
        )
