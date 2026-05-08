from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    DB_HOST: str = "127.0.0.1"
    DB_PORT: int = 3306
    DB_NAME: str = "radius"
    DB_USER: str = "portaluser"
    DB_PASS: str = ""
    JWT_SECRET: str = ""
    AES_KEY: str = ""  # 32-byte hex
    FR_CONFIG_DIR: str = "/etc/freeradius/3.0"
    FR_LOG: str = "/var/log/freeradius/radius.log"
    PORTAL_VLAN_IP: str = "127.0.0.1"

    class Config:
        env_file = "/opt/portal/.env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
