from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from routes import api_router
import os

app = FastAPI(
    title="NTFS Timestomping Detection API",
    description="API for detecting timestomping in NTFS file systems",
    version="1.0.0"
)

# Get the exports directory path
EXPORTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "exports")

# Create exports directory if it doesn't exist
os.makedirs(EXPORTS_DIR, exist_ok=True)

# Mount exports directory for static file serving
app.mount("/exports", StaticFiles(directory=EXPORTS_DIR), name="exports")

# CORS middleware for frontend - restrict to localhost for security
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

# Include all routes
app.include_router(api_router)


@app.get("/")
def root():
    """Health check endpoint"""
    return {"status": "ok", "message": "NTFS Timestomping Detection API"}


@app.get("/health")
def health_check():
    """Server health status"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5000)
