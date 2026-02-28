from fastapi import APIRouter

router = APIRouter()


@router.post("/live/{drive}")
def analyze_live(drive: str):
    """Analyze a live NTFS drive for timestomping"""
    # TODO: Implement live analysis logic
    return {
        "message": f"Analysis started for drive {drive}",
        "status": "pending"
    }


@router.post("/image")
def analyze_image(filename: str):
    """Analyze an uploaded disk image for timestomping"""
    # TODO: Implement image analysis logic
    return {
        "message": f"Analysis started for image {filename}",
        "status": "pending"
    }
