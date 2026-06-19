from fastapi import FastAPI

from app.routers import auth, parts, containers, bins

app = FastAPI(title="Mnemo", version="1.0.0")

app.include_router(auth.router)
app.include_router(parts.router)
app.include_router(containers.router)
app.include_router(bins.router)


@app.get("/health")
def health():
    return {"status": "ok"}
