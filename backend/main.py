from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from models.schemas import HealthResponse

# FastAPIアプリケーションの作成
app = FastAPI(
    title="HandTracking 3D Pro API",
    description="Backend API for hand tracking app (health check only)",
    version="1.0.0"
)

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Viteのデフォルトポート
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/", response_model=HealthResponse)
async def root():
    """ルートエンドポイント"""
    return {
        "status": "ok",
        "message": "HandTracking 3D Pro API is running"
    }

@app.get("/api/health", response_model=HealthResponse)
async def health_check():
    """ヘルスチェックエンドポイント"""
    return {
        "status": "ok",
        "message": "API is healthy"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)