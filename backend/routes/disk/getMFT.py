import json
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import struct
import os
import ctypes
import subprocess
import shutil
from datetime import datetime

router = APIRouter()

# Output directory for MFT files
MFT_OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "mft_exports")

# Path to the extract_mft.exe executable
EXTRACT_MFT_EXE = os.path.join(os.path.dirname(__file__), "..", "..", "..", "low-level-c", "extract_mft.exe")


class MFTRequest(BaseModel):
    drive: str  # e.g., "C:" or "C"


class NTFSBootSector:
    """Parse NTFS boot sector to get MFT location"""
    
    def __init__(self, data: bytes):
        # NTFS boot sector structure
        self.bytes_per_sector = struct.unpack_from("<H", data, 0x0B)[0]
        self.sectors_per_cluster = struct.unpack_from("<B", data, 0x0D)[0]
        self.total_sectors = struct.unpack_from("<Q", data, 0x28)[0]
        self.mft_cluster = struct.unpack_from("<Q", data, 0x30)[0]
        self.mft_mirror_cluster = struct.unpack_from("<Q", data, 0x38)[0]
        self.clusters_per_mft_record = struct.unpack_from("<b", data, 0x40)[0]
        
        # Calculate bytes per cluster
        self.bytes_per_cluster = self.bytes_per_sector * self.sectors_per_cluster
        
        # Calculate MFT record size
        if self.clusters_per_mft_record < 0:
            self.mft_record_size = 2 ** abs(self.clusters_per_mft_record)
        else:
            self.mft_record_size = self.clusters_per_mft_record * self.bytes_per_cluster
        
        # MFT offset in bytes
        self.mft_offset = self.mft_cluster * self.bytes_per_cluster


def is_admin():
    """Check if running with administrator privileges"""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False


def exe_exists():
    """Check if extract_mft.exe exists"""
    return os.path.isfile(EXTRACT_MFT_EXE)


def run_extract_mft_exe(args: list) -> tuple:
    """
    Run extract_mft.exe with given arguments
    
    Returns:
        (success: bool, output: str, error: str)
    """
    if not exe_exists():
        return False, "", f"extract_mft.exe not found at {EXTRACT_MFT_EXE}"
    
    try:
        result = subprocess.run(
            [EXTRACT_MFT_EXE] + args,
            capture_output=True,
            text=True,
            timeout=600  # 10 minutes timeout for large extractions
        )
        return result.returncode == 0, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return False, "", "Extraction timeout (exceeded 10 minutes)"
    except Exception as e:
        return False, "", str(e)


def parse_exe_output(output: str) -> Dict[str, Any]:
    """
    Parse JSON output from extract_mft.exe
    
    Returns structured data organized by type
    """
    parsed = {
        "type": None,
        "raw_output": output,
        "lines": [],
        "errors": [],
        "warnings": [],
        "drive_list": [],
        "extraction_results": {},
        "volume_info": None,
        "usn_journal_status": None,
        "summary": None
    }
    
    for line in output.strip().split('\n'):
        if not line.strip():
            continue
        
        try:
            data = json.loads(line)
            parsed["lines"].append(data)
            
            msg_type = data.get("type")
            
            if msg_type == "error":
                parsed["errors"].append({
                    "message": data.get("message"),
                    "error_code": data.get("error_code"),
                    "system_error": data.get("system_error")
                })
            elif msg_type == "drive_list":
                parsed["drive_list"] = data.get("drives", [])
            elif msg_type == "volume_info":
                parsed["volume_info"] = {
                    "drive": data.get("drive"),
                    "bytes_per_sector": data.get("bytes_per_sector"),
                    "bytes_per_cluster": data.get("bytes_per_cluster"),
                    "mft_offset": data.get("mft_offset"),
                    "mft_record_size": data.get("mft_record_size")
                }
            elif msg_type == "extraction_complete":
                artifact = data.get("artifact")
                parsed["extraction_results"][artifact] = {
                    "bytes": data.get("bytes"),
                    "path": data.get("path"),
                    "status": data.get("status")
                }
            elif msg_type == "usn_journal_status":
                parsed["usn_journal_status"] = {
                    "drive": data.get("drive"),
                    "active": data.get("active"),
                    "journal_id": data.get("journal_id"),
                    "next_usn": data.get("next_usn"),
                    "reason": data.get("reason")
                }
            elif msg_type == "extraction_summary":
                parsed["summary"] = {
                    "drive": data.get("drive"),
                    "output_dir": data.get("output_dir"),
                    "results": data.get("results")
                }
        except json.JSONDecodeError:
            pass
    
    return parsed


def _get_actual_mft_size(data, mft_record_size, bytes_per_sector):
    """
    Parse MFT record 0 ($MFT's own record) to get the real MFT file size
    from its $DATA attribute.
    """
    record = bytearray(data[:mft_record_size])

    if record[0:4] != b'FILE':
        return None

    # Apply fixup array
    fixup_offset = struct.unpack_from("<H", record, 0x04)[0]
    fixup_count = struct.unpack_from("<H", record, 0x06)[0]

    if fixup_count >= 2 and fixup_offset + fixup_count * 2 <= len(record):
        signature = struct.unpack_from("<H", record, fixup_offset)[0]
        for i in range(1, fixup_count):
            sector_end = i * bytes_per_sector - 2
            if sector_end + 1 < len(record):
                current = struct.unpack_from("<H", record, sector_end)[0]
                if current == signature:
                    fixup_val = struct.unpack_from("<H", record, fixup_offset + i * 2)[0]
                    struct.pack_into("<H", record, sector_end, fixup_val)

    # Walk attributes to find $DATA (type 0x80)
    attr_offset = struct.unpack_from("<H", record, 0x14)[0]

    while attr_offset + 8 <= mft_record_size:
        attr_type = struct.unpack_from("<I", record, attr_offset)[0]
        if attr_type == 0xFFFFFFFF:
            break
        attr_length = struct.unpack_from("<I", record, attr_offset + 4)[0]
        if attr_length == 0 or attr_offset + attr_length > mft_record_size:
            break
        if attr_type == 0x80:  # $DATA
            non_resident = record[attr_offset + 8]
            if non_resident:
                real_size = struct.unpack_from("<Q", record, attr_offset + 0x30)[0]
                alloc_size = struct.unpack_from("<Q", record, attr_offset + 0x28)[0]
                return real_size if real_size > 0 else alloc_size
        attr_offset += attr_length

    return None


def extract_mft(drive_letter: str, output_path: str) -> dict:
    """
    Extract MFT from a live NTFS drive.
    Reads the actual MFT size from record 0's $DATA attribute.

    Args:
        drive_letter: Drive letter (e.g., 'C')
        output_path: Path to save the extracted MFT

    Returns:
        dict with extraction details
    """
    # Normalize drive letter
    drive_letter = drive_letter.rstrip(":").upper()
    drive_path = f"\\\\.\\{drive_letter}:"
    isAdmin=is_admin()
    if not isAdmin:
        raise HTTPException(
            status_code=403,
            detail="Administrator privileges required. Run the server as Administrator."
        )
    else:
        print(f"Running with admin privileges. Attempting to access {drive_path}...")
    try:
        # Open the drive for raw reading (requires admin)
        handle = ctypes.windll.kernel32.CreateFileW(
            drive_path,
            0x80000000 | 0x40000000,      # GENERIC_READ
            0x01 | 0x02,     # FILE_SHARE_READ | FILE_SHARE_WRITE
            None,
            3,               # OPEN_EXISTING
            0x00000080,      # FILE_ATTRIBUTE_NORMAL
            None
        )
        # flags = 0x00000080 | 0x02000000  # FILE_ATTRIBUTE_NORMAL | FILE_FLAG_BACKUP_SEMANTICS
        # handle = ctypes.windll.kernel32.CreateFileW("\\\\.\\C:", GENERIC_READ|GENERIC_WRITE, 
        #              FILE_SHARE_READ|FILE_SHARE_WRITE, None,
        #              OPEN_EXISTING, flags, None)
        if handle == -1:
            # Get Windows error code for more info
            error_code = ctypes.windll.kernel32.GetLastError()
            raise PermissionError(f"Cannot open drive {drive_path}. Run as Administrator. (Error: {error_code})")
        
        # Read boot sector (first 512 bytes)
        boot_sector = ctypes.create_string_buffer(512)
        bytes_read = ctypes.c_ulong(0)
        
        success = ctypes.windll.kernel32.ReadFile(
            handle, boot_sector, 512, ctypes.byref(bytes_read), None
        )
        
        if not success:
            ctypes.windll.kernel32.CloseHandle(handle)
            raise IOError("Failed to read boot sector")
        
        # Parse boot sector
        ntfs = NTFSBootSector(boot_sector.raw)
        
        # Validate NTFS signature
        if boot_sector.raw[3:7] != b'NTFS':
            ctypes.windll.kernel32.CloseHandle(handle)
            raise ValueError("Not an NTFS volume")
        
        # Seek to MFT location
        mft_offset_high = ctypes.c_long((ntfs.mft_offset >> 32) & 0xFFFFFFFF)
        mft_offset_low = ctypes.c_ulong(ntfs.mft_offset & 0xFFFFFFFF)
        
        result = ctypes.windll.kernel32.SetFilePointer(
            handle, mft_offset_low, ctypes.byref(mft_offset_high), 0
        )
        
        if result == 0xFFFFFFFF:
            ctypes.windll.kernel32.CloseHandle(handle)
            raise IOError("Failed to seek to MFT")
        
        # Read MFT record 0 to determine the actual MFT size
        record0_buf = ctypes.create_string_buffer(ntfs.mft_record_size)
        success = ctypes.windll.kernel32.ReadFile(
            handle, record0_buf, ntfs.mft_record_size, ctypes.byref(bytes_read), None
        )
        
        actual_mft_size = None
        if success and bytes_read.value == ntfs.mft_record_size:
            actual_mft_size = _get_actual_mft_size(
                record0_buf.raw, ntfs.mft_record_size, ntfs.bytes_per_sector
            )
        
        if actual_mft_size and actual_mft_size > 0:
            mft_size = actual_mft_size
            print(f"[+] Actual $MFT size from record 0: {mft_size:,} bytes ({mft_size / (1024*1024):.2f} MB)")
        else:
            mft_size = ntfs.mft_record_size * 100000
            print(f"[!] Could not determine actual MFT size, falling back to ~{mft_size / (1024*1024):.2f} MB cap")
        
        # Re-seek to MFT start
        mft_offset_high2 = ctypes.c_long((ntfs.mft_offset >> 32) & 0xFFFFFFFF)
        mft_offset_low2 = ctypes.c_ulong(ntfs.mft_offset & 0xFFFFFFFF)
        ctypes.windll.kernel32.SetFilePointer(
            handle, mft_offset_low2, ctypes.byref(mft_offset_high2), 0
        )
        
        # Read MFT in chunks
        chunk_size = 1024 * 1024  # 1MB chunks
        total_read = 0
        
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        with open(output_path, 'wb') as f:
            while total_read < mft_size:
                read_size = min(chunk_size, mft_size - total_read)
                buffer = ctypes.create_string_buffer(read_size)
                
                success = ctypes.windll.kernel32.ReadFile(
                    handle, buffer, read_size, ctypes.byref(bytes_read), None
                )
                
                if not success or bytes_read.value == 0:
                    break
                
                f.write(buffer.raw[:bytes_read.value])
                total_read += bytes_read.value
                
                # Check if we hit end of MFT (look for empty records)
                if bytes_read.value < read_size:
                    break
        
        ctypes.windll.kernel32.CloseHandle(handle)
        
        return {
            "success": True,
            "drive": f"{drive_letter}:",
            "output_file": output_path,
            "bytes_extracted": total_read,
            "mft_offset": ntfs.mft_offset,
            "mft_record_size": ntfs.mft_record_size,
            "bytes_per_cluster": ntfs.bytes_per_cluster,
            "estimated_records": total_read // ntfs.mft_record_size
        }
        
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Routes using extract_mft.exe executable
# ============================================================================

@router.get("/exe/status")
def exe_status():
    """Get status of extract_mft.exe and its location"""
    exe_available = exe_exists()
    admin_status = is_admin()
    
    return {
        "exe_available": exe_available,
        "exe_path": EXTRACT_MFT_EXE,
        "admin_privileges": admin_status,
        "message": "extract_mft.exe is ready to use" if exe_available 
                   else "extract_mft.exe not found"
    }


@router.get("/exe/list")
def list_ntfs_drives_exe():
    """
    List available NTFS drives using extract_mft.exe
    
    Requires Administrator privileges
    """
    if not is_admin():
        raise HTTPException(
            status_code=403,
            detail="Administrator privileges required to list drives"
        )
    
    if not exe_exists():
        raise HTTPException(
            status_code=404,
            detail="extract_mft.exe not found"
        )
    
    success, output, error = run_extract_mft_exe(["--list"])
    
    if not success:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list drives: {error}"
        )
    
    # Parse the JSON output
    parsed = parse_exe_output(output)
    
    # Check for errors
    if parsed["errors"]:
        raise HTTPException(
            status_code=500,
            detail=parsed["errors"][0]["message"]
        )
    
    # Return clean response
    return {
        "success": True,
        "status": "drives_listed",
        "data": {
            "total_drives": len(parsed["drive_list"]),
            "drives": [
                {
                    "index": drive.get("index"),
                    "letter": drive.get("letter"),
                    "total_gb": drive.get("total_gb"),
                    "free_gb": drive.get("free_gb")
                }
                for drive in parsed["drive_list"]
            ]
        }
    }


@router.post("/exe/extract")
def extract_mft_exe_endpoint(request: MFTRequest):
    """
    Extract NTFS artifacts using extract_mft.exe
    
    Extracts:
    - $MFT (Master File Table)
    - $LogFile (Transaction log)
    - $UsnJrnl:$J (Change journal)
    
    Requires Administrator privileges
    """
    if not is_admin():
        raise HTTPException(
            status_code=403,
            detail="Administrator privileges required. Run the server as Administrator."
        )
    
    if not exe_exists():
        raise HTTPException(
            status_code=404,
            detail="extract_mft.exe not found"
        )
    
    # Normalize drive letter
    drive = request.drive.rstrip(":").upper()
    
    # Validate drive letter format
    if len(drive) != 1 or not drive.isalpha():
        raise HTTPException(
            status_code=400,
            detail="Invalid drive letter. Provide single letter (C, D, E, etc.)"
        )
    
    # Run extraction
    success, output, error = run_extract_mft_exe(["--extract", drive])
    
    if not success:
        raise HTTPException(
            status_code=500,
            detail=f"Extraction process failed: {error}"
        )
    
    # Parse the JSON output
    parsed = parse_exe_output(output)
    
    # Check for errors in output
    if parsed["errors"]:
        raise HTTPException(
            status_code=500,
            detail=parsed["errors"][0]["message"]
        )
    
    # Build response
    extraction_status = {
        "mft": "FAILED",
        "logfile": "FAILED", 
        "usn_journal": "FAILED"
    }
    
    extracted_artifacts = {}
    
    # Map extraction results to status
    for artifact, result in parsed["extraction_results"].items():
        if result["status"] == "success":
            size_mb = round(result["bytes"] / (1024 * 1024), 2)
            extracted_artifacts[artifact.lower()] = {
                "size_bytes": result["bytes"],
                "size_mb": size_mb,
                "path": result["path"],
                "status": "extracted"
            }
            
            if artifact == "$MFT":
                extraction_status["mft"] = "SUCCESS"
            elif artifact == "$LogFile":
                extraction_status["logfile"] = "SUCCESS"
            elif artifact == "$UsnJrnl:$J":
                extraction_status["usn_journal"] = "SUCCESS"
    
    return {
        "success": True,
        "status": "extraction_complete",
        "drive": f"{drive}:",
        "timestamp": datetime.now().isoformat(),
        "extraction": {
            "status": extraction_status,
            "artifacts": extracted_artifacts
        },
        "volume": parsed["volume_info"],
        "usn_journal": parsed["usn_journal_status"],
        "output_directory": parsed["summary"]["output_dir"] if parsed["summary"] else None
    }


@router.post("/extract")
def extract_mft_endpoint(request: MFTRequest):
    """
    Extract MFT from a specified NTFS drive
    
    Requires Administrator privileges to access raw disk.
    """
    if not is_admin():
        raise HTTPException(
            status_code=403,
            detail="Administrator privileges required. Run the server as Administrator."
        )
    
    # Generate output filename with timestamp
    drive = request.drive.rstrip(":").upper()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_filename = f"MFT_{drive}_{timestamp}.bin"
    output_path = os.path.join(MFT_OUTPUT_DIR, output_filename)
    
    result = extract_mft(drive, output_path)
    
    return result


@router.get("/")
def get_mft_info():
    """Get information about MFT extraction capability"""
    admin_status = is_admin()
    
    # List previously extracted MFT files
    extracted_files = []
    if os.path.exists(MFT_OUTPUT_DIR):
        for f in os.listdir(MFT_OUTPUT_DIR):
            if f.endswith('.bin'):
                filepath = os.path.join(MFT_OUTPUT_DIR, f)
                extracted_files.append({
                    "filename": f,
                    "size_mb": round(os.path.getsize(filepath) / (1024 * 1024), 2),
                    "created": datetime.fromtimestamp(os.path.getctime(filepath)).isoformat()
                })
    
    return {
        "admin_privileges": admin_status,
        "output_directory": MFT_OUTPUT_DIR,
        "extracted_files": extracted_files,
        "message": "Use POST /extract with drive letter to extract MFT" if admin_status 
                   else "Run server as Administrator to extract MFT"
    }


@router.get("/test-admin")
def test_admin():
    """Test admin privileges and drive access"""
    admin_status = is_admin()
    
    # Test if can access C: drive
    drive_test = None
    try:
        drive_path = "\\\\.\\C:"
        handle = ctypes.windll.kernel32.CreateFileW(
            drive_path,
            0x80000000,  # GENERIC_READ
            0x01 | 0x02, # FILE_SHARE_READ | FILE_SHARE_WRITE
            None,
            3,           # OPEN_EXISTING
            0x00000080,  # FILE_ATTRIBUTE_NORMAL
            None
        )
        if handle != -1:
            ctypes.windll.kernel32.CloseHandle(handle)
            drive_test = "Success"
        else:
            error_code = ctypes.windll.kernel32.GetLastError()
            drive_test = f"Failed with error code: {error_code}"
    except Exception as e:
        drive_test = f"Exception: {str(e)}"
    
    return {
        "admin_privileges": admin_status,
        "drive_access_test": drive_test
    }


