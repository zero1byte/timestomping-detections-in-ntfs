#!/usr/bin/env python3
"""
MFT Extractor - Extract Master File Table from NTFS drives
Run this script as Administrator to extract MFT from live NTFS system
"""

import struct
import os
import ctypes
import sys
from datetime import datetime
from pathlib import Path


class NTFSBootSector:
    """Parse NTFS boot sector to get MFT location"""
    
    def __init__(self, data: bytes):
        try:
            # NTFS boot sector structure
            self.bytes_per_sector = struct.unpack_from("<H", data, 0x0B)[0]
            self.sectors_per_cluster = struct.unpack_from("<B", data, 0x0D)[0]
            self.total_sectors = struct.unpack_from("<Q", data, 0x28)[0]
            self.mft_cluster = struct.unpack_from("<Q", data, 0x30)[0]
            self.mft_mirror_cluster = struct.unpack_from("<Q", data, 0x38)[0]
            self.clusters_per_mft_record = struct.unpack_from("<b", data, 0x40)[0]
            
            # Validate NTFS signature
            if data[3:7] != b'NTFS':
                raise ValueError("Not a valid NTFS boot sector")
            
            # Calculate bytes per cluster
            self.bytes_per_cluster = self.bytes_per_sector * self.sectors_per_cluster
            
            # Calculate MFT record size
            if self.clusters_per_mft_record < 0:
                self.mft_record_size = 2 ** abs(self.clusters_per_mft_record)
            else:
                self.mft_record_size = self.clusters_per_mft_record * self.bytes_per_cluster
            
            # MFT offset in bytes
            self.mft_offset = self.mft_cluster * self.bytes_per_cluster
            
        except Exception as e:
            raise ValueError(f"Failed to parse NTFS boot sector: {str(e)}")


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
    
    print(f"[*] Attempting to extract MFT from {drive_path}")
    
    try:
        # Open the drive for raw reading (requires admin)
        handle = ctypes.windll.kernel32.CreateFileW(
            drive_path,
            0x80000000,      # GENERIC_READ
            0x01 | 0x02,     # FILE_SHARE_READ | FILE_SHARE_WRITE
            None,
            3,               # OPEN_EXISTING
            0x00000080,      # FILE_ATTRIBUTE_NORMAL
            None
        )
        
        if handle == -1:
            error_code = ctypes.windll.kernel32.GetLastError()
            raise PermissionError(
                f"Cannot open drive {drive_path}. Error code: {error_code}\n"
                f"Please run this script as Administrator!"
            )
        
        print(f"[+] Successfully opened drive handle")
        
        # Read boot sector (first 512 bytes)
        boot_sector = ctypes.create_string_buffer(512)
        bytes_read = ctypes.c_ulong(0)
        
        success = ctypes.windll.kernel32.ReadFile(
            handle, boot_sector, 512, ctypes.byref(bytes_read), None
        )
        
        if not success:
            ctypes.windll.kernel32.CloseHandle(handle)
            raise IOError("Failed to read boot sector")
        
        print(f"[+] Boot sector read ({bytes_read.value} bytes)")
        
        # Parse boot sector
        ntfs = NTFSBootSector(boot_sector.raw)
        
        print(f"[+] NTFS Boot Sector Information:")
        print(f"    - Bytes per sector: {ntfs.bytes_per_sector}")
        print(f"    - Sectors per cluster: {ntfs.sectors_per_cluster}")
        print(f"    - Bytes per cluster: {ntfs.bytes_per_cluster}")
        print(f"    - MFT cluster: {ntfs.mft_cluster}")
        print(f"    - MFT offset: {ntfs.mft_offset} bytes")
        print(f"    - MFT record size: {ntfs.mft_record_size} bytes")
        
        # Seek to MFT location
        mft_offset_high = ctypes.c_long((ntfs.mft_offset >> 32) & 0xFFFFFFFF)
        mft_offset_low = ctypes.c_ulong(ntfs.mft_offset & 0xFFFFFFFF)
        
        result = ctypes.windll.kernel32.SetFilePointer(
            handle, mft_offset_low, ctypes.byref(mft_offset_high), 0
        )
        
        if result == 0xFFFFFFFF:
            ctypes.windll.kernel32.CloseHandle(handle)
            raise IOError("Failed to seek to MFT")
        
        print(f"[+] Seeked to MFT location at offset {ntfs.mft_offset}")
        
        # Calculate how much MFT to read
        mft_size = ntfs.mft_record_size * max_records
        
        # Read MFT in chunks
        chunk_size = 1024 * 1024  # 1MB chunks
        total_read = 0
        
        # Create output directory if it doesn't exist
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        print(f"[*] Reading MFT... (max {max_records} records, ~{mft_size / (1024*1024):.2f} MB)")
        
        with open(output_path, 'wb') as f:
            while total_read < mft_size:
                read_size = min(chunk_size, mft_size - total_read)
                buffer = ctypes.create_string_buffer(read_size)
                
                success = ctypes.windll.kernel32.ReadFile(
                    handle, buffer, read_size, ctypes.byref(bytes_read), None
                )
                
                if not success or bytes_read.value == 0:
                    print(f"[!] End of MFT reached")
                    break
                
                f.write(buffer.raw[:bytes_read.value])
                total_read += bytes_read.value
                
                # Show progress
                progress = (total_read / mft_size) * 100
                print(f"    [{progress:.1f}%] {total_read / (1024*1024):.2f} MB extracted", end='\r')
                
                # Check if we hit end of MFT (look for empty records)
                if bytes_read.value < read_size:
                    print(f"[!] Partial read, likely end of data")
                    break
        
        ctypes.windll.kernel32.CloseHandle(handle)
        
        print(f"\n[+] MFT extraction completed successfully!")
        print(f"[+] Total bytes extracted: {total_read:,}")
        print(f"[+] Estimated MFT records: {total_read // ntfs.mft_record_size:,}")
        print(f"[+] Output file: {output_path}")
        
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
        print(f"[!] ERROR: {str(e)}")
        return {"success": False, "error": str(e)}
    except Exception as e:
        print(f"[!] ERROR: {str(e)}")
        return {"success": False, "error": str(e)}


def main():
    """Main entry point"""
    
    # Check admin privileges
    if not is_admin():
        print("[!] This script requires Administrator privileges!")
        print("[!] Please run Command Prompt or PowerShell as Administrator")
        sys.exit(1)
    
    print("=" * 70)
    print("NTFS MFT Extractor")
    print("=" * 70)
    
    # Get drive letter from user
    if len(sys.argv) > 1:
        drive_letter = sys.argv[1]
    else:
        drive_letter = input("\nEnter drive letter to extract (e.g., C, D): ").strip()
    
    if not drive_letter:
        drive_letter = "C"
    
    # Get output path from user
    if len(sys.argv) > 2:
        output_path = sys.argv[2]
    else:
        # Default output directory
        output_dir = os.path.join(os.path.dirname(__file__), "mft_exports")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = os.path.join(output_dir, f"MFT_{drive_letter.upper()}_{timestamp}.bin")
    
    print(f"\n[*] Drive: {drive_letter}")
    print(f"[*] Output: {output_path}\n")
    
    # Extract MFT
    result = extract_mft(drive_letter, output_path)
    
    if result["success"]:
        print("\n" + "=" * 70)
        print("[+] SUCCESS! MFT extracted successfully")
        print("=" * 70)
        sys.exit(0)
    else:
        print("\n" + "=" * 70)
        print("[!] FAILED! Could not extract MFT")
        print("=" * 70)
        sys.exit(1)


if __name__ == "__main__":
    main()
