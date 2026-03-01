#!/usr/bin/env python3
"""
Test script for NTFS Extraction API
Run this after starting the server to test all endpoints
"""

import requests
import json
from datetime import datetime

BASE_URL = "http://localhost:5000"

def print_response(title, response):
    """Pretty print API response"""
    print(f"\n{'='*70}")
    print(f"[{title}]")
    print(f"{'='*70}")
    print(f"Status Code: {response.status_code}")
    print(f"Response:")
    print(json.dumps(response.json(), indent=2))

def test_list_drives():
    """Test: List available drives"""
    print("\n[TEST 1] Listing Available Drives...")
    try:
        response = requests.get(f"{BASE_URL}/extract/drives")
        print_response("Available Drives", response)
        return response.json()
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return None

def test_extract_mft(drive="C"):
    """Test: Extract $MFT"""
    print(f"\n[TEST 2] Extracting $MFT from {drive}: drive...")
    try:
        response = requests.post(
            f"{BASE_URL}/extract/extract-mft",
            json={"drive": drive}
        )
        print_response(f"Extract $MFT ({drive}:)", response)
        return response.json()
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return None

def test_extract_logfile(drive="C"):
    """Test: Extract $LogFile"""
    print(f"\n[TEST 3] Extracting $LogFile from {drive}: drive...")
    try:
        response = requests.post(
            f"{BASE_URL}/extract/extract-logfile",
            json={"drive": drive}
        )
        print_response(f"Extract $LogFile ({drive}:)", response)
        return response.json()
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return None

def test_extract_usnjrnl(drive="C"):
    """Test: Extract $UsnJrnl"""
    print(f"\n[TEST 4] Extracting $UsnJrnl from {drive}: drive...")
    try:
        response = requests.post(
            f"{BASE_URL}/extract/extract-usnjrnl",
            json={"drive": drive}
        )
        print_response(f"Extract $UsnJrnl ({drive}:)", response)
        return response.json()
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return None

def test_extract_all(drive="C"):
    """Test: Extract all artifacts"""
    print(f"\n[TEST 5] Extracting ALL artifacts from {drive}: drive...")
    try:
        response = requests.post(
            f"{BASE_URL}/extract/extract-all",
            json={"drive": drive}
        )
        print_response(f"Extract All ({drive}:)", response)
        return response.json()
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return None

def test_extraction_status():
    """Test: Get extraction status"""
    print(f"\n[TEST 6] Getting Extraction Status...")
    try:
        response = requests.get(f"{BASE_URL}/extract/status")
        print_response("Extraction Status", response)
        return response.json()
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return None

def main():
    """Run all tests"""
    print("="*70)
    print("NTFS Extraction API - Integration Tests")
    print(f"Server: {BASE_URL}")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*70)
    
    # Test 1: Get available drives
    drives_result = test_list_drives()
    
    if not drives_result or not drives_result.get("available_drives"):
        print("\n[!] No drives found or server not responding")
        return
    
    # Get first available drive
    drive = drives_result["available_drives"][0]["letter"]
    print(f"\n[*] Using drive: {drive}")
    
    # Test 2-4: Individual extractions
    test_extract_mft(drive)
    test_extract_logfile(drive)
    test_extract_usnjrnl(drive)
    
    # Test 5: Extract all
    test_extract_all(drive)
    
    # Test 6: Get status
    test_extraction_status()
    
    print("\n" + "="*70)
    print("All tests completed!")
    print("="*70)

if __name__ == "__main__":
    try:
        # Check if server is running
        response = requests.get(f"{BASE_URL}/health", timeout=2)
        main()
    except requests.exceptions.ConnectionError:
        print("ERROR: Cannot connect to server!")
        print(f"Make sure the server is running at {BASE_URL}")
        print("\nStart the server with:")
        print("  cd backend")
        print("  python main.py")
    except Exception as e:
        print(f"ERROR: {str(e)}")
