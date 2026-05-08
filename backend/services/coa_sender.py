import subprocess
import shlex
import logging

logger = logging.getLogger(__name__)


def disconnect_session(
    nas_ip: str,
    nas_secret: str,
    session_id: str,
    username: str,
) -> bool:
    """
    Send RFC 3576 Disconnect-Request to NAS via radclient.
    Returns True on Disconnect-ACK, False otherwise.
    """
    payload = f"Acct-Session-Id={session_id},User-Name={username}"

    cmd = [
        "radclient",
        "-x",
        f"{nas_ip}:3799",
        "disconnect",
        nas_secret,
    ]

    try:
        result = subprocess.run(
            cmd,
            input=payload,
            capture_output=True,
            text=True,
            timeout=10,
        )
        logger.info("radclient stdout: %s", result.stdout)
        logger.info("radclient stderr: %s", result.stderr)
        return "Disconnect-ACK" in result.stdout
    except FileNotFoundError:
        logger.error("radclient binary not found")
        return False
    except subprocess.TimeoutExpired:
        logger.error("radclient timed out for session %s", session_id)
        return False
    except Exception as exc:
        logger.error("CoA error: %s", exc)
        return False
