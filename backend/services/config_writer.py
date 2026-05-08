"""
Render Jinja2 templates → write FreeRADIUS config files → reload service.
"""
import base64
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from jinja2 import Environment, FileSystemLoader
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from backend.config import get_settings
from backend.services.radius_db import get_all_config, get_nas_list

logger = logging.getLogger(__name__)

TEMPLATE_DIR = Path(__file__).parent.parent / "templates"


def _get_jinja_env() -> Environment:
    return Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)), autoescape=False)


def decrypt_value(encrypted_b64: str, aes_key_hex: str) -> str:
    """Decrypt AES-256-GCM encrypted base64 value. Nonce is first 12 bytes."""
    raw = base64.b64decode(encrypted_b64)
    nonce = raw[:12]
    ciphertext = raw[12:]
    key = bytes.fromhex(aes_key_hex)
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ciphertext, None).decode()


def encrypt_value(plaintext: str, aes_key_hex: str) -> str:
    """Encrypt with AES-256-GCM; prepend 12-byte random nonce; base64 encode."""
    key = bytes.fromhex(aes_key_hex)
    nonce = os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ciphertext).decode()


def _backup_file(path: Path) -> Optional[Path]:
    if path.exists():
        bak = path.with_suffix(path.suffix + ".bak")
        shutil.copy2(path, bak)
        return bak
    return None


def _restore_backups(paths: list[tuple[Path, Optional[Path]]]) -> None:
    for target, bak in paths:
        if bak and bak.exists():
            shutil.copy2(bak, target)
            logger.info("Restored backup %s -> %s", bak, target)


async def write_all() -> dict:
    """
    Render all FreeRADIUS config templates and reload the service.
    Returns {"success": bool, "stderr": str}.
    """
    settings = get_settings()
    fr_dir = Path(settings.FR_CONFIG_DIR)
    config = await get_all_config()
    nas_list = await get_nas_list()

    aes_key = settings.AES_KEY

    # Decrypt sensitive values
    ldap_bind_pw = ""
    if config.get("ldap_bind_pw"):
        try:
            ldap_bind_pw = decrypt_value(config["ldap_bind_pw"], aes_key)
        except Exception:
            ldap_bind_pw = ""

    radius_shared_secret = ""
    if config.get("radius_shared_secret"):
        try:
            radius_shared_secret = decrypt_value(config["radius_shared_secret"], aes_key)
        except Exception:
            radius_shared_secret = ""

    ctx = {
        "ldap_server": config.get("ldap_server", ""),
        "ldap_bind_dn": config.get("ldap_bind_dn", ""),
        "ldap_bind_pw": ldap_bind_pw,
        "ldap_base_dn": config.get("ldap_base_dn", ""),
        "ldap_group_dn": config.get("ldap_group_dn", ""),
        "ldap_user_filter": config.get("ldap_user_filter", "(&(objectClass=user)(sAMAccountName=%u))"),
        "default_simultaneous_use": config.get("default_simultaneous_use", "2"),
        "radius_shared_secret": radius_shared_secret,
        "nas_list": nas_list,
        "db_user": settings.DB_USER,
        "db_pass": settings.DB_PASS,
        "db_name": settings.DB_NAME,
        "db_host": settings.DB_HOST,
        "db_port": settings.DB_PORT,
    }

    env = _get_jinja_env()

    # Map template name -> target path
    targets = [
        ("ldap.conf.j2", fr_dir / "mods-enabled" / "ldap"),
        ("sql.conf.j2", fr_dir / "mods-enabled" / "sql"),
        ("clients.conf.j2", fr_dir / "clients.conf"),
        ("concurrent_limit.j2", fr_dir / "policy.d" / "concurrent_limit"),
    ]

    backups: list[tuple[Path, Optional[Path]]] = []
    try:
        for template_name, target_path in targets:
            bak = _backup_file(target_path)
            backups.append((target_path, bak))

            template = env.get_template(template_name)
            rendered = template.render(**ctx)
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_text(rendered)
            logger.info("Wrote %s", target_path)

    except Exception as exc:
        logger.error("Template rendering failed: %s", exc)
        _restore_backups(backups)
        return {"success": False, "stderr": str(exc)}

    # Reload FreeRADIUS
    try:
        result = subprocess.run(
            ["sudo", "systemctl", "reload", "freeradius"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            logger.error("FreeRADIUS reload failed: %s", result.stderr)
            _restore_backups(backups)
            return {"success": False, "stderr": result.stderr}
        return {"success": True, "stderr": ""}
    except subprocess.TimeoutExpired:
        _restore_backups(backups)
        return {"success": False, "stderr": "systemctl reload timed out after 10 seconds"}
    except Exception as exc:
        _restore_backups(backups)
        return {"success": False, "stderr": str(exc)}
