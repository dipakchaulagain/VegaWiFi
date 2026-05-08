from typing import Optional
from pydantic import BaseModel


class ActiveSession(BaseModel):
    radacctid: int
    acctsessionid: str
    username: str
    nasipaddress: str
    nasportid: Optional[str] = None
    calledstationid: Optional[str] = None
    callingstationid: Optional[str] = None
    framedipaddress: Optional[str] = None
    acctstarttime: Optional[str] = None
    duration_seconds: int = 0


class AccountingRecord(BaseModel):
    radacctid: int
    acctsessionid: str
    username: str
    realm: Optional[str] = None
    nasipaddress: str
    calledstationid: Optional[str] = None
    callingstationid: Optional[str] = None
    framedipaddress: Optional[str] = None
    acctstarttime: Optional[str] = None
    acctstoptime: Optional[str] = None
    acctsessiontime: Optional[int] = None
    acctinputoctets: Optional[int] = None
    acctoutputoctets: Optional[int] = None
    acctterminatecause: Optional[str] = None


class AccountingListResponse(BaseModel):
    total: int
    page: int
    per_page: int
    items: list[AccountingRecord]
