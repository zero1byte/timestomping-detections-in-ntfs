from fastapi import APIRouter
from .drives import router as drives_router
from .upload import router as upload_router
from .analyze import router as analyze_router
from .disk.getMFT import router as get_mft_router

api_router = APIRouter()

api_router.include_router(drives_router, prefix="/drives", tags=["Drives"])
api_router.include_router(upload_router, prefix="/upload", tags=["Upload"])
api_router.include_router(analyze_router, prefix="/analyze", tags=["Analysis"])

api_router.include_router(get_mft_router, prefix="/disk", tags=["Disk"])