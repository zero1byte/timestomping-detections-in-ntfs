from fastapi import APIRouter
from .files import router as files_router
from .convert import router as convert_router

api_router_ = APIRouter()

api_router_.include_router(files_router, prefix="/analysis", tags=["Analysis"])
api_router_.include_router(convert_router, prefix="/analysis", tags=["Conversion"])

