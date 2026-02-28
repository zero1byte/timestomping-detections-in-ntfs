from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import api_router

app = FastAPI(
    title="NTFS Timestomping Detection API",
    description="API for detecting timestomping in NTFS file systems",
    version="1.0.0"
)

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
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
    uvicorn.run(app, host="0.0.0.0", port=5000)
