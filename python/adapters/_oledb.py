"""Private OLE DB (ADODB) wrapper used by ``ProficyHistorianAdapter``.

Ported from the legacy ``AIModelAPI/apps/historian_api/oledb.py`` module.
Windows-only — imports of ``win32com`` are guarded so that importing this
module on non-Windows hosts is still safe (functions/classes raise at call
time, not import time). This keeps the Mock fallback path working on macOS.

Only Proficy / iFix uses this; SQL Server goes through ``pymssql`` instead.
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)


try:  # pragma: no cover — import-time Windows check
    import win32com.client as _win32com  # type: ignore
    _HAS_WIN32 = True
except Exception as _exc:  # ImportError on macOS/Linux
    _win32com = None
    _HAS_WIN32 = False
    log.debug("win32com unavailable: %s", _exc)


# ---- ADO enumerations (kept identical to legacy oledb.py) ------------------

adArray = 0
adByRef = 0
adVector = 0
adEmpty = 0
adTinyInt = 16
adSmallInt = 2
adInteger = 3
adBigInt = 20
adUnsignedTinyInt = 17
adUnsignedSmallInt = 18
adUnsignedInt = 19
adUnsignedBigInt = 21
adSingle = 4
adDouble = 5
adCurrency = 6
adDecimal = 14
adNumeric = 131
adBoolean = 11
adError = 10
adUserDefined = 132
adVariant = 12
adIDispatch = 9
adIUnknown = 13
adGUID = 72
adDate = 7
adDBDate = 133
adDBTime = 134
adDBTimeStamp = 135
adBSTR = 8
adChar = 129
adVarChar = 200
adLongVarChar = 201
adWChar = 130
adVarWChar = 202
adLongVarWChar = 203
adBinary = 128
adVarBinary = 204
adLongVarBinary = 205
adChapter = 136
adFileTime = 64
adDBFileTime = 137
adPropVariant = 138
adVarNumeric = 139

adFldUnspecified = -1
adFldMayDefer = 0x2
adFldUpdatable = 0x4
adFldUnknownUpdatable = 0x8
adFldFixed = 0x10
adFldIsNullable = 0x20
adFldMayBeNull = 0x40
adFldLong = 0x80
adFldRowID = 0x100
adFldRowVersion = 0x200
adFldCacheDeferred = 0x1000
adFldNegativeScale = 0x4000
adFldKeyColumn = 0x8000


# PEP-249 type codes
apilevel = "2.0"
threadsafety = 2
paramstyle = "pyformat"

STRING = 1
BINARY = 2
NUMBER = 3
DATETIME = 4
ROWID = 5
UNKNOWN = 0


def is_available() -> bool:
    """True when ``win32com.client`` imported successfully."""
    return _HAS_WIN32


def connect(dsn, user=None, password=None, host=None, database=None, provider=None):
    """Open an ADODB connection. Signature matches legacy ``oledb.connect``."""
    conn = Connection()
    conn.connect(dsn, user=user, password=password,
                 host=host, database=database, provider=provider)
    return conn


class Connection:
    """Thin wrapper around ``ADODB.Connection``."""

    def __init__(self):
        if not _HAS_WIN32:
            raise RuntimeError(
                "OLE/COM (win32com.client) is not available on this platform; "
                "the Proficy adapter requires Windows with pywin32 installed."
            )
        self.Conn = _win32com.Dispatch("ADODB.Connection")

    def connect(self, dsn, user=None, password=None, host=None,
                database=None, provider=None):
        if self.Conn.State == 1:
            self.Conn.Close()

        if provider is not None:
            self.Conn.Provider = str(provider)
        if host is not None:
            self.Conn.Properties("Data Source").Value = str(host)
            if database is not None:
                self.Conn.Properties("Initial Catalog").Value = str(database)
        else:
            if database is not None:
                self.Conn.Properties("Data Source").Value = str(database)
        if user is not None:
            self.Conn.Properties("User ID").Value = str(user)
        if password is not None:
            self.Conn.Properties("Password").Value = str(password)

        if host is not None:
            self.Conn.Open(host, user, password)
        else:
            self.Conn.Open(database, user, password)

        return self.Conn.State == 1

    def cursor(self):
        return Cursor(self.Conn)

    def close(self):
        try:
            self.Conn.Close()
        except Exception:  # pragma: no cover — best-effort teardown
            pass


class Cursor:
    """Minimal PEP-249-ish cursor over ``ADODB.Recordset``."""

    def __init__(self, Conn):
        if not _HAS_WIN32:
            raise RuntimeError("win32com.client not available")
        self.arraysize = 1
        self.PassConn = Conn
        self.rs = None
        self.Fields = None
        self.rsList: list = []
        self.rsListPos = 0
        self.description: list = []

    def execute(self, operation, parameters=None):
        self.rs = _win32com.Dispatch("ADODB.Recordset")
        self.rsList = [self.rs]
        self.rsListPos = 0
        query = operation if parameters is None else (operation % parameters)
        self.rs.Open(query, ActiveConnection=self.PassConn)
        self.Fields = [self.rs.Fields.Item(col)
                       for col in range(self.rs.Fields.Count)]
        self.description = self.describefields()

    def describefields(self):
        description = []
        for col in range(len(self.Fields)):
            field = self.Fields[col]
            fieldtype = field.Type
            if fieldtype & adArray:
                fieldtype = fieldtype & (~adArray)
            if fieldtype & adByRef:
                fieldtype = fieldtype & (~adByRef)
            if fieldtype == adVector:
                fieldtype = fieldtype & (~adVector)

            type_code = UNKNOWN
            if fieldtype in (adBigInt, adBoolean, adCurrency, adDecimal,
                             adDouble, adInteger, adNumeric, adSingle,
                             adSmallInt, adTinyInt, adUnsignedBigInt,
                             adUnsignedInt, adUnsignedSmallInt,
                             adUnsignedTinyInt):
                type_code = NUMBER
            elif fieldtype in (adBinary, adGUID, adIDispatch, adIUnknown,
                               adLongVarBinary, adVarBinary):
                type_code = BINARY
            elif fieldtype in (adBSTR, adChar, adLongVarChar, adLongVarWChar,
                               adVarChar, adVarWChar, adWChar):
                type_code = STRING
            elif fieldtype in (adDate, adDBDate, adDBTime, adDBTimeStamp):
                type_code = DATETIME
            # adEmpty / adError / adUserDefined / adVariant fall through to UNKNOWN

            description.append((
                field.Name,
                type_code,
                field.ActualSize,
                field.DefinedSize,
                field.Precision,
                field.NumericScale,
                field.Attributes & adFldMayBeNull,
            ))
        return description

    def close(self):
        try:
            self.rs.Close()
        except Exception:  # pragma: no cover
            pass

    def fetchone(self):
        if self.rs.EOF:
            return None
        row = [self.Fields[col].Value for col in range(len(self.Fields))]
        self.rs.MoveNext()
        return row

    def fetchall(self):
        rows = []
        while not self.rs.EOF:
            rows.append([self.Fields[col].Value for col in range(len(self.Fields))])
            self.rs.MoveNext()
        return rows

    def fetchmany(self, size=None):
        if size is None:
            size = self.arraysize
        rows = []
        for _ in range(size):
            if self.rs.EOF:
                return rows
            rows.append([self.Fields[col].Value for col in range(len(self.Fields))])
            self.rs.MoveNext()
        return rows

    def executemany(self, operation, parameters=None):
        if parameters is None:
            raise ValueError("executemany requires parameters")
        self.rsList = []
        self.rsListPos = 0
        for row_params in parameters:
            rs = _win32com.Dispatch("ADODB.Recordset")
            rs.Open(operation % row_params, ActiveConnection=self.PassConn)
            self.rsList.append(rs)
        self.rs = self.rsList[0]
        self.Fields = [self.rs.Fields.Item(col)
                       for col in range(self.rs.Fields.Count)]
        self.description = self.describefields()

    def nextset(self):
        self.rsListPos += 1
        if self.rsListPos >= len(self.rsList):
            return None
        self.rs = self.rsList[self.rsListPos]
        self.Fields = [self.rs.Fields.Item(col)
                       for col in range(self.rs.Fields.Count)]
        self.description = self.describefields()
        return 1

    def getrowcount(self):
        if self.rs.State == 0:
            self.rs.Open()
        return self.rs.RecordCount

    def __getattr__(self, name):
        if name == "rowcount":
            return self.getrowcount()
        raise AttributeError(name)
