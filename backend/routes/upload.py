from fastapi import APIRouter, UploadFile, File, HTTPException

router = APIRouter()


@router.post("/")
async def upload_image(file: UploadFile = File(...)):
    """Upload NTFS disk image for analysis"""
    allowed_extensions = [".dd", ".raw", ".img", ".e01"]
    
    if not any(file.filename.lower().endswith(ext) for ext in allowed_extensions):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(allowed_extensions)}"
        )
    
    # TODO: Save and process the uploaded file
    return {
        "message": "File uploaded successfully",
        "filename": file.filename,
        "size": file.size
    }
