from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Database
    database_url: str

    # Auth
    api_secret_key: str

    # Google AI Studio
    google_ai_studio_api_key: str | None = None

    # Nvidia API
    nvidia_api_key: str | None = None
    nvidia_model: str = "mistralai/mistral-medium-3.5-128b"
    nvidia_vision_model: str = "nvidia/llama-3.2-11b-vision-instruct"

    # Economy defaults
    default_hourly_earn_rate: int = 100
    default_daily_target_hours: float = 3.0
    default_lazy_tax: int = 100
    default_step_income_cap: int = 50
    default_loan_interest_rate: float = 0.05

    environment: str = "development"

    class Config:
        env_file = ".env"
        extra = "ignore"

@lru_cache
def get_settings() -> Settings:
    return Settings()
