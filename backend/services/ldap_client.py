import logging
from typing import Optional

from ldap3 import (
    ALL,
    SUBTREE,
    Connection,
    Server,
    ServerPool,
    Tls,
    ROUND_ROBIN,
    AUTO_BIND_TLS_BEFORE_BIND,
)
from ldap3.core.exceptions import LDAPException
import ssl

logger = logging.getLogger(__name__)

_pool: Optional[ServerPool] = None
_pool_config: dict = {}


def _make_server(url: str) -> Server:
    tls = Tls(validate=ssl.CERT_REQUIRED, ca_certs_file=None)
    return Server(url, use_ssl=True, tls=tls, get_info=ALL, connect_timeout=30)


def _get_connection(server: Server, bind_dn: str, bind_pw: str) -> Connection:
    return Connection(
        server,
        user=bind_dn,
        password=bind_pw,
        auto_bind=AUTO_BIND_TLS_BEFORE_BIND,
        raise_exceptions=True,
        receive_timeout=30,
    )


def test_connection(server_url: str, bind_dn: str, bind_pw: str) -> dict:
    """Test LDAP connectivity and bind. Returns dict with success + info."""
    try:
        server = _make_server(server_url)
        conn = _get_connection(server, bind_dn, bind_pw)
        info = {
            "success": True,
            "server": server_url,
            "vendor": str(server.info.vendor_name) if server.info else "unknown",
            "naming_contexts": (
                [str(n) for n in server.info.naming_contexts]
                if server.info and server.info.naming_contexts
                else []
            ),
        }
        conn.unbind()
        return info
    except LDAPException as exc:
        return {"success": False, "error": str(exc)}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def list_group_members(
    server_url: str,
    bind_dn: str,
    bind_pw: str,
    group_dn: str,
    base_dn: str,
) -> list[dict]:
    """
    Return all members of an AD group.
    Each entry: sAMAccountName, displayName, mail, distinguishedName.
    """
    try:
        server = _make_server(server_url)
        conn = _get_connection(server, bind_dn, bind_pw)

        # Fetch group members attribute
        conn.search(
            search_base=group_dn,
            search_filter="(objectClass=group)",
            search_scope=SUBTREE,
            attributes=["member"],
        )

        if not conn.entries:
            conn.unbind()
            return []

        member_dns = conn.entries[0].member.values if conn.entries[0].member else []

        results = []
        for member_dn in member_dns:
            conn.search(
                search_base=str(member_dn),
                search_filter="(objectClass=*)",
                search_scope="BASE",
                attributes=["sAMAccountName", "displayName", "mail", "distinguishedName"],
            )
            if conn.entries:
                entry = conn.entries[0]
                results.append(
                    {
                        "username": str(entry.sAMAccountName) if entry.sAMAccountName else "",
                        "display_name": str(entry.displayName) if entry.displayName else "",
                        "email": str(entry.mail) if entry.mail else "",
                        "distinguished_name": str(entry.distinguishedName) if entry.distinguishedName else "",
                    }
                )

        conn.unbind()
        return results
    except LDAPException as exc:
        logger.error("LDAP list_group_members error: %s", exc)
        return []
    except Exception as exc:
        logger.error("Unexpected LDAP error: %s", exc)
        return []


def user_in_group(
    server_url: str,
    bind_dn: str,
    bind_pw: str,
    username: str,
    group_dn: str,
    base_dn: str,
    user_filter: str = "(&(objectClass=user)(sAMAccountName=%u))",
) -> bool:
    """Check if a user is a member of the configured group."""
    try:
        server = _make_server(server_url)
        conn = _get_connection(server, bind_dn, bind_pw)

        resolved_filter = user_filter.replace("%u", username)
        conn.search(
            search_base=base_dn,
            search_filter=resolved_filter,
            search_scope=SUBTREE,
            attributes=["memberOf"],
        )

        if not conn.entries:
            conn.unbind()
            return False

        member_of = [str(g) for g in conn.entries[0].memberOf] if conn.entries[0].memberOf else []
        conn.unbind()
        return group_dn.lower() in [g.lower() for g in member_of]
    except LDAPException as exc:
        logger.error("LDAP user_in_group error: %s", exc)
        return False
