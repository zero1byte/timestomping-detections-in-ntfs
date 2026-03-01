from fastapi import APIRouter
from .list_files import router as list_files_router
from .list_exports import router as list_exports_router

router = APIRouter()

router.include_router(list_files_router, tags=["Files"])
router.include_router(list_exports_router, tags=["Exports"])
