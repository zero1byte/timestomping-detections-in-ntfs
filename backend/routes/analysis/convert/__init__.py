from fastapi import APIRouter
from .mft_csv import router as mft_router
from .logfile_csv import router as logfile_router
from .usnjrnl_csv import router as usnjrnl_router

router = APIRouter()

router.include_router(mft_router, tags=["Convert"])
router.include_router(logfile_router, tags=["Convert"])
router.include_router(usnjrnl_router, tags=["Convert"])
