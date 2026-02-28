from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import struct
import os
import ctypes
from datetime import datetime

router = APIRouter()

# Output directory for MFT files
MFT_OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "mft_exports")


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


def extract_mft(drive_letter: str, output_path: str, max_records: int = 100000) -> dict:
    """
    Extract MFT from a live NTFS drive
    
    Args:
        drive_letter: Drive letter (e.g., 'C')
        output_path: Path to save the extracted MFT
        max_records: Maximum number of MFT records to extract
    
    Returns:
        dict with extraction details
    """
    # Normalize drive letter
    drive_letter = drive_letter.rstrip(":").upper()
    drive_path = f"\\\\.\\{drive_letter}:"
    
    try:
        # Open the drive for raw reading (requires admin)
        handle = ctypes.windll.kernel32.CreateFileW(
            drive_path,
            0x80000000,  # GENERIC_READ
            0x03,        # FILE_SHARE_READ | FILE_SHARE_WRITE
            None,
            3,           # OPEN_EXISTING
            0,
            None
        )
        
        if handle == -1:
            raise PermissionError("Cannot open drive. Run as Administrator.")
        
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
        
        # Calculate how much MFT to read
        mft_size = ntfs.mft_record_size * max_records
        
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


