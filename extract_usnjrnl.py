#!/usr/bin/env python3
"""
$USN Journal Extractor - Extract Update Sequence Number Journal from NTFS drives
Run this script as Administrator to extract $UsnJrnl from live NTFS system
"""

import struct
import os
import ctypes
import sys
from datetime import datetime


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


class MFTRecord:
    """Parse MFT record to find attributes"""
    
    def __init__(self, data: bytes, record_num: int = 0):
        self.data = data
        self.record_num = record_num
        self.attributes = {}
        self.parse_attributes()
    
    def parse_attributes(self):
        """Parse all attributes in the MFT record"""
        # MFT record signature should be 'FILE'
        if self.data[0:4] != b'FILE':
            return
        
        # Offset to first attribute is at offset 0x14
        attr_offset = struct.unpack_from("<H", self.data, 0x14)[0]
        
        # Parse attributes
        while attr_offset < len(self.data):
            attr_type = struct.unpack_from("<I", self.data, attr_offset)[0]
            
            # 0xFFFFFFFF marks end of attributes
            if attr_type == 0xFFFFFFFF:
                break
            
            attr_len = struct.unpack_from("<I", self.data, attr_offset + 4)[0]
            if attr_len == 0:
                break
            
            attr_data = self.data[attr_offset:attr_offset + attr_len]
            self.attributes[attr_type] = attr_data
            attr_offset += attr_len


def is_admin():
    """Check if running with administrator privileges"""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False


def extract_data_attribute(drive_handle, ntfs: NTFSBootSector, mft_record_data: bytes) -> bytes:
    """
    Extract DATA attribute (0x80) from an MFT record
    Handles both resident and non-resident attributes
    """
    mft_record = MFTRecord(mft_record_data)
    
    # Find DATA attribute (type 0x80)
    if 0x80 not in mft_record.attributes:
        return b''
    
    attr_data = mft_record.attributes[0x80]
    
    # Check if resident (byte at offset 8)
    is_resident = attr_data[8] == 0
    
    if is_resident:
        # Resident data: value offset at 0x14, value length at 0x10
        value_offset = struct.unpack_from("<H", attr_data, 0x14)[0]
        value_length = struct.unpack_from("<I", attr_data, 0x10)[0]
        return attr_data[value_offset:value_offset + value_length]
    
    else:
        # Non-resident: need to read data runs
        # Starting VCN at 0x10, Last VCN at 0x18
        run_offset = struct.unpack_from("<H", attr_data, 0x20)[0]
        data_runs = attr_data[run_offset:]
        
        # Parse data runs and read data
        extracted_data = b''
        run_pos = 0
        current_lcn = 0
        
        while run_pos < len(data_runs):
            run_header = data_runs[run_pos]
            if run_header == 0:
                break
            
            # Parse run header
            length_size = run_header & 0x0F
            offset_size = (run_header >> 4) & 0x0F
            
            run_pos += 1
            
            # Get length
            if length_size > 0:
                length_bytes = data_runs[run_pos:run_pos + length_size]
                cluster_count = int.from_bytes(length_bytes, byteorder='little')
                run_pos += length_size
            else:
                break
            
            # Get offset (relative to previous)
            if offset_size > 0:
                offset_bytes = data_runs[run_pos:run_pos + offset_size]
                cluster_offset = int.from_bytes(offset_bytes, byteorder='little', signed=True)
                run_pos += offset_size
                current_lcn += cluster_offset
            else:
                cluster_offset = 0
            
            # Read clusters from disk
            cluster_start = current_lcn * ntfs.bytes_per_cluster
            bytes_to_read = cluster_count * ntfs.bytes_per_cluster
            
            # Seek and read
            seek_high = ctypes.c_long((cluster_start >> 32) & 0xFFFFFFFF)
            seek_low = ctypes.c_ulong(cluster_start & 0xFFFFFFFF)
            
            ctypes.windll.kernel32.SetFilePointer(
                drive_handle, seek_low, ctypes.byref(seek_high), 0
            )
            
            buffer = ctypes.create_string_buffer(bytes_to_read)
            bytes_read = ctypes.c_ulong(0)
            
            success = ctypes.windll.kernel32.ReadFile(
                drive_handle, buffer, bytes_to_read, ctypes.byref(bytes_read), None
            )
            
            if success and bytes_read.value > 0:
                extracted_data += buffer.raw[:bytes_read.value]
        
        return extracted_data


def extract_usnjrnl(drive_letter: str, output_path: str) -> dict:
    """
    Extract $UsnJrnl from a live NTFS drive
    $UsnJrnl is stored in MFT record 6
    
    Args:
        drive_letter: Drive letter (e.g., 'C')
        output_path: Path to save the extracted $UsnJrnl
    
    Returns:
        dict with extraction details
    """
    # Normalize drive letter
    drive_letter = drive_letter.rstrip(":").upper()
    drive_path = f"\\\\.\\{drive_letter}:"
    
    print(f"[*] Attempting to extract $UsnJrnl from {drive_path}")
    
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
        print(f"    - MFT offset: {ntfs.mft_offset} bytes")
        print(f"    - MFT record size: {ntfs.mft_record_size} bytes")
        
        # Read MFT record 6 ($UsnJrnl)
        usnjrnl_record_num = 6
        record_offset = ntfs.mft_offset + (usnjrnl_record_num * ntfs.mft_record_size)
        
        print(f"\n[*] Reading $UsnJrnl (MFT Record #{usnjrnl_record_num})")
        
        seek_high = ctypes.c_long((record_offset >> 32) & 0xFFFFFFFF)
        seek_low = ctypes.c_ulong(record_offset & 0xFFFFFFFF)
        
        ctypes.windll.kernel32.SetFilePointer(
            handle, seek_low, ctypes.byref(seek_high), 0
        )
        
        # Read the MFT record
        mft_record_buffer = ctypes.create_string_buffer(ntfs.mft_record_size)
        success = ctypes.windll.kernel32.ReadFile(
            handle, mft_record_buffer, ntfs.mft_record_size, ctypes.byref(bytes_read), None
        )
        
        if not success:
            ctypes.windll.kernel32.CloseHandle(handle)
            raise IOError("Failed to read MFT record 6")
        
        print(f"[+] MFT Record 6 read ({bytes_read.value} bytes)")
        
        # Extract data attribute
        usnjrnl_data = extract_data_attribute(handle, ntfs, mft_record_buffer.raw)
        
        ctypes.windll.kernel32.CloseHandle(handle)
        
        if not usnjrnl_data:
            raise IOError("Could not extract $UsnJrnl data")
        
        # Save to file
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        with open(output_path, 'wb') as f:
            f.write(usnjrnl_data)
        
        print(f"\n[+] $UsnJrnl extraction completed successfully!")
        print(f"[+] Total bytes extracted: {len(usnjrnl_data):,}")
        print(f"[+] Output file: {output_path}")
        
        return {
            "success": True,
            "drive": f"{drive_letter}:",
            "output_file": output_path,
            "bytes_extracted": len(usnjrnl_data),
            "file_type": "$UsnJrnl"
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
    print("NTFS $UsnJrnl Extractor")
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
        output_dir = os.path.join(os.path.dirname(__file__), "usnjrnl_exports")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = os.path.join(output_dir, f"$UsnJrnl_{drive_letter.upper()}_{timestamp}.bin")
    
    print(f"\n[*] Drive: {drive_letter}")
    print(f"[*] Output: {output_path}\n")
    
    # Extract $UsnJrnl
    result = extract_usnjrnl(drive_letter, output_path)
    
    if result["success"]:
        print("\n" + "=" * 70)
        print("[+] SUCCESS! $UsnJrnl extracted successfully")
        print("=" * 70)
        sys.exit(0)
    else:
        print("\n" + "=" * 70)
        print("[!] FAILED! Could not extract $UsnJrnl")
        print("=" * 70)
        sys.exit(1)


if __name__ == "__main__":
    main()
