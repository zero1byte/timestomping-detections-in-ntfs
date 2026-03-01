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

@router.get("/list_files", response_model=List[Dict[str, Any]])
def list_files(drive: str):
    """
    List all files in the specified drive.

    Args:
        drive (str): The drive letter (e.g., 'C').
    Returns:
        List[Dict[str, Any]]: A list of dictionaries containing file information.
    """
    if not os.path.exists(f"{drive}:\\"):
        raise HTTPException(status_code=404, detail="Drive not found.")

    file_list = []
    for root, dirs, files in os.walk(f"{drive}:\\"):
        for file in files:
            file_path = os.path.join(root, file)
            try:
                file_info = {
                    "name": file,
                    "path": file_path,
                    "size": os.path.getsize(file_path),
                    "created": datetime.fromtimestamp(os.path.getctime(file_path)).isoformat(),
                    "modified": datetime.fromtimestamp(os.path.getmtime(file_path)).isoformat(),
                }
                file_list.append(file_info)
            except Exception as e:
                print(f"Error accessing file {file_path}: {e}")
                continue

    return file_list