from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    secret_key: str

    access_token_expire_minutes: int = 720  # 12h — single-user home tool; refresh lasts 30d
    refresh_token_expire_days: int = 30

    class Config:
        env_file = ".env"


settings = Settings()
