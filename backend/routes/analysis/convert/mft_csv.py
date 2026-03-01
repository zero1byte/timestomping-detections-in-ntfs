import os
import sys
from typing import Optional, Tuple
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Add backend/routes to path for importing mft_to_csv
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from mft_to_csv import export_mft_to_csv, COLUMNS as MFT_COLUMNS

router = APIRouter()

# Path to exports directory in project root
# Goes from backend/routes/analysis/convert/ up to root, then into exports/
EXPORTS_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "exports"
)


class ConvertRequest(BaseModel):
    extraction_id: str
    output_format: str = "csv"  # Default to CSV


def parse_extraction_id(extraction_id: str) -> Tuple[str, str]:
    """
    Parse extraction_id to get drive letter and timestamp
    Format: {DRIVE}_{YYYYMMDD}_{HHMMSS} e.g., C_20260301_143022
    
    Returns: (drive_letter, timestamp)
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
    
    Args:
        extraction_id: Extraction ID (e.g., "C_20260301_143022")
        artifact_type: Type folder name (e.g., "MFT", "LogFile", "UsnJrnl")
        prefix: File prefix to search for (e.g., "MFT_", "$LogFile_", "$UsnJrnl_")
    
    Returns: (file_path, output_dir) or None if not found
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
    
    # Try direct path pattern for any MFT file in the new structure
    if os.path.isdir(new_structure_path):
        for filename in os.listdir(new_structure_path):
            if filename.startswith(prefix):
                return os.path.join(new_structure_path, filename), new_structure_path
    
    return None


@router.post("/mft/convert")
def convert_mft_to_csv(request: ConvertRequest):
    """
    Convert extracted MFT binary file to CSV format
    Uses comprehensive parser from mft_to_csv.py with 95+ fields including:
    - Standard Information timestamps (SI_*)
    - Multiple File Name attributes (FN1_*, FN2_*, FN3_*)
    - Data attribute info (DATA_*)
    - Object ID info (OID_*)
    - Reparse points, EA info, and more
    """
    # Find MFT file using the helper function
    result = find_artifact_file(request.extraction_id, "MFT", "MFT_")
    
    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"MFT file not found for extraction '{request.extraction_id}'. "
                   f"Looked in exports/MFT/{request.extraction_id.split('_')[0]}/ and exports/{request.extraction_id}/"
        )
    
    mft_file, output_dir = result
    
    try:
        # Create output CSV file path
        csv_output = os.path.join(
            output_dir,
            f"MFT_{request.extraction_id}.csv"
        )
        
        input_size = os.path.getsize(mft_file)
        
        # Use comprehensive export function from mft_to_csv.py
        # This parses all MFT attributes including SI, FN, DATA, OID, etc.
        records_parsed = export_mft_to_csv(mft_file, csv_output)
        
        csv_size = os.path.getsize(csv_output)
        
        return {
            "success": True,
            "status": "conversion_complete",
            "artifact": "MFT",
            "data": {
                "input_file": mft_file,
                "output_file": csv_output,
                "input_size_mb": round(input_size / (1024 * 1024), 2),
                "output_size_mb": round(csv_size / (1024 * 1024), 2),
                "records_parsed": records_parsed,
                "columns": len(MFT_COLUMNS),
                "column_categories": [
                    "Record Info (record_number, signature, flags, etc.)",
                    "Standard Information (SI_*) - 4 timestamps",
                    "File Name 1 (FN1_*) - Name and 4 timestamps",
                    "File Name 2 (FN2_*) - DOS name if present",
                    "File Name 3 (FN3_*) - Additional name",
                    "Data Attribute (DATA_*)",
                    "Object ID (OID_*)",
                    "Reparse Point, EA Info"
                ]
            }
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to convert MFT: {str(e)}"
        )
