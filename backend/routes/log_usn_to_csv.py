#!/usr/bin/env python3
"""
$LogFile and $UsnJrnl -> CSV Exporter
======================================
Exports every record from $LogFile, $UsnJrnl $J, and $UsnJrnl $Max to CSV.

No third-party libraries needed — pure Python stdlib only.

Usage:
  python log_usn_to_csv.py --log    '$LogFile'  --out logfile.csv
  python log_usn_to_csv.py --usnj   '$J'        --out usnjrnl_j.csv
  python log_usn_to_csv.py --usnmax '$Max'       --out usnjrnl_max.csv

  # All three at once
  python log_usn_to_csv.py --log '$LogFile' --usnj '$J' --usnmax '$Max' ^
      --outlog logfile.csv --outj usnjrnl_j.csv --outmax usnjrnl_max.csv

PowerShell tip: always use single quotes so $ is not expanded.
"""

import argparse
import csv
import os
import struct
import sys
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

EPOCH_DIFF = 116444736000000000  # 100-ns ticks 1601->1970

def filetime_to_str(ft: int) -> str:
    if ft == 0:
        return ""
    try:
        ts = (ft - EPOCH_DIFF) / 1e7
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return ""

def u8(d, o):  return struct.unpack_from("<B", d, o)[0] if o+1 <= len(d) else 0
def u16(d, o): return struct.unpack_from("<H", d, o)[0] if o+2 <= len(d) else 0
def u32(d, o): return struct.unpack_from("<I", d, o)[0] if o+4 <= len(d) else 0
def u64(d, o): return struct.unpack_from("<Q", d, o)[0] if o+8 <= len(d) else 0
def i64(d, o): return struct.unpack_from("<q", d, o)[0] if o+8 <= len(d) else 0

def decode_flags(value: int, flag_map: dict) -> str:
    return "|".join(name for mask, name in flag_map.items() if value & mask) or ""

def fix_path(p: str, candidates: list) -> str:
    """Strip trailing slash, auto-resolve if directory given instead of file."""
    if p is None:
        return None
    p = p.strip()
    while p.endswith("\\") or p.endswith("/"):
        p = p[:-1]
    if os.path.isfile(p):
        return p
    for name in candidates:
        c = os.path.join(p, name)
        if os.path.isfile(c):
            print(f"[INFO] Auto-resolved: {c}")
            return c
    print(f"[ERROR] File not found: {p}")
    print("  TIP: Use single quotes in PowerShell  e.g.  --log '$LogFile'")
    sys.exit(1)


# ===========================================================================
# $LogFile
# ===========================================================================

LOGFILE_PAGE  = 4096
RSTR_SIG      = b"RSTR"
RCRD_SIG      = b"RCRD"

REDO_OPCODES = {
    0x00: "Noop",
    0x01: "CompensationLogRecord",
    0x02: "InitializeFileRecordSegment",
    0x03: "DeallocateFileRecordSegment",
    0x04: "WriteEndOfFileRecordSegment",
    0x05: "CreateAttribute",
    0x06: "DeleteAttribute",
    0x07: "UpdateResidentValue",
    0x08: "UpdateNonResidentValue",
    0x09: "UpdateMappingPairs",
    0x0A: "DeleteDirtyClusters",
    0x0B: "SetNewAttributeSizes",
    0x0C: "AddIndexEntryRoot",
    0x0D: "DeleteIndexEntryRoot",
    0x0E: "AddIndexEntryAllocation",
    0x0F: "DeleteIndexEntryAllocation",
    0x10: "WriteEndOfIndexBuffer",
    0x11: "SetIndexEntryVcnRoot",
    0x12: "SetIndexEntryVcnAllocation",
    0x13: "UpdateFileNameRoot",
    0x14: "UpdateFileNameAllocation",
    0x15: "SetBitsInNonResidentBitMap",
    0x16: "ClearBitsInNonResidentBitMap",
    0x17: "HotFix",
    0x18: "EndTopLevelAction",
    0x19: "PrepareTransaction",
    0x1A: "CommitTransaction",
    0x1B: "ForgetTransaction",
    0x1C: "OpenNonResidentAttribute",
    0x1D: "OpenAttributeTableDump",
    0x1E: "AttributeNamesDump",
    0x1F: "DirtyPageTableDump",
    0x20: "TransactionTableDump",
    0x21: "UpdateRecordDataRoot",
    0x22: "UpdateRecordDataAllocation",
    0x23: "Win10UpdateRecordDataRoot",
    0x24: "Win10UpdateRecordDataAllocation",
}

LOG_RECORD_FLAGS = {
    0x0001: "MultiPage",
    0x0002: "SystemClient",
}

# CSV columns for $LogFile
LOGFILE_COLUMNS = [
    # Page-level context
    "page_number",
    "page_offset_in_file",
    "page_signature",           # RSTR or RCRD
    "page_last_lsn",
    "page_flags",
    "page_count",
    "page_position",
    # RSTR-only fields (restart page)
    "rstr_ntfs_major",
    "rstr_ntfs_minor",
    "rstr_system_page_size",
    "rstr_log_page_size",
    "rstr_restart_area_offset",
    "rstr_client_count",
    "rstr_log_clients_offset",
    "rstr_oldest_lsn",
    "rstr_last_lsn_to_data_length",
    "rstr_flags",
    # Log record fields (RCRD pages)
    "rec_index_in_page",
    "rec_offset_in_page",
    "rec_lsn",
    "rec_lsn_hex",
    "rec_prev_lsn",
    "rec_prev_lsn_hex",
    "rec_client_prev_lsn",
    "rec_client_prev_lsn_hex",
    "rec_client_id",
    "rec_transaction_id",
    "rec_flags",
    "rec_flags_decoded",
    "rec_type",
    "rec_length",
    "rec_redo_op",
    "rec_redo_op_name",
    "rec_undo_op",
    "rec_undo_op_name",
    "rec_redo_offset",
    "rec_redo_length",
    "rec_undo_offset",
    "rec_undo_length",
    "rec_target_attribute",
    "rec_lcns_to_follow",
    "rec_record_offset",
    "rec_attribute_offset",
    "rec_cluster_index",
    "rec_target_vcn",
    "rec_target_lcn",
]


def apply_logfile_fixup(data: bytearray) -> bytearray:
    usa_off   = u16(data, 4)
    usa_count = u16(data, 6)
    if usa_off + usa_count * 2 > len(data):
        return data
    seq = u16(data, usa_off)
    for i in range(1, usa_count):
        pos = i * 512 - 2
        if pos + 2 > len(data):
            break
        if u16(data, pos) != seq:
            break
        orig = u16(data, usa_off + i * 2)
        data[pos]   = orig & 0xFF
        data[pos+1] = (orig >> 8) & 0xFF
    return data


def parse_logfile_page(raw: bytes, page_num: int):
    """
    Returns a list of row dicts — one row per log record inside this page,
    or one row for RSTR pages.
    """
    if len(raw) < 40:
        return []
    sig = raw[0:4]
    if sig not in (RSTR_SIG, RCRD_SIG):
        return []

    data = apply_logfile_fixup(bytearray(raw))

    base = {
        "page_number":          page_num,
        "page_offset_in_file":  page_num * LOGFILE_PAGE,
        "page_signature":       sig.decode("ascii", errors="replace"),
        "page_last_lsn":        f"0x{u64(data,8):016X}",
        "page_flags":           f"0x{u32(data,16):08X}",
        "page_count":           u16(data, 20),
        "page_position":        u16(data, 22),
    }

    # ── RSTR (restart page) ─────────────────────────────────────────────
    if sig == RSTR_SIG:
        row = {c: "" for c in LOGFILE_COLUMNS}
        row.update(base)
        row["rstr_system_page_size"]        = u32(data, 24) if len(data) >= 28 else ""
        row["rstr_log_page_size"]           = u32(data, 28) if len(data) >= 32 else ""
        row["rstr_restart_area_offset"]     = u16(data, 32) if len(data) >= 34 else ""
        row["rstr_ntfs_minor"]              = u16(data, 34) if len(data) >= 36 else ""
        row["rstr_ntfs_major"]              = u16(data, 36) if len(data) >= 38 else ""
        # Restart area fields
        ra = u16(data, 32) if len(data) >= 34 else 0
        if ra and ra + 48 <= len(data):
            row["rstr_oldest_lsn"]              = f"0x{u64(data, ra+8):016X}"
            row["rstr_last_lsn_to_data_length"] = u32(data, ra+24)
            row["rstr_client_count"]            = u16(data, ra+28)
            row["rstr_log_clients_offset"]      = u16(data, ra+30)
            row["rstr_flags"]                   = f"0x{u32(data, ra+32):08X}"
        return [row]

    # ── RCRD (log data page) ─────────────────────────────────────────────
    rows = []
    # First log record starts after the page header (40 bytes)
    # The update sequence array may push it further
    usa_off   = u16(data, 4)
    usa_count = u16(data, 6)
    rec_start = usa_off + usa_count * 2
    # align to 8
    rec_start = (rec_start + 7) & ~7
    if rec_start < 40:
        rec_start = 40

    offset = rec_start
    rec_idx = 0

    while offset + 48 <= len(data):
        this_type   = u32(data, offset)
        this_flags  = u16(data, offset + 4)
        undo_op     = u16(data, offset + 6)
        redo_op     = u16(data, offset + 8)
        rec_len     = u16(data, offset + 10)

        if rec_len == 0:
            break
        if offset + rec_len > len(data):
            break

        row = {c: "" for c in LOGFILE_COLUMNS}
        row.update(base)
        row["rec_index_in_page"]    = rec_idx
        row["rec_offset_in_page"]   = offset

        lsn      = u64(data, offset + 16)
        prev_lsn = u64(data, offset + 24)
        cprev    = u64(data, offset + 32)

        row["rec_lsn"]               = lsn
        row["rec_lsn_hex"]           = f"0x{lsn:016X}"
        row["rec_prev_lsn"]          = prev_lsn
        row["rec_prev_lsn_hex"]      = f"0x{prev_lsn:016X}"
        row["rec_client_prev_lsn"]   = cprev
        row["rec_client_prev_lsn_hex"] = f"0x{cprev:016X}"
        row["rec_client_id"]         = u32(data, offset + 40)
        row["rec_transaction_id"]    = u32(data, offset + 44)
        row["rec_flags"]             = f"0x{this_flags:04X}"
        row["rec_flags_decoded"]     = decode_flags(this_flags, LOG_RECORD_FLAGS)
        row["rec_type"]              = f"0x{this_type:08X}"
        row["rec_length"]            = rec_len
        row["rec_redo_op"]           = f"0x{redo_op:04X}"
        row["rec_redo_op_name"]      = REDO_OPCODES.get(redo_op, "")
        row["rec_undo_op"]           = f"0x{undo_op:04X}"
        row["rec_undo_op_name"]      = REDO_OPCODES.get(undo_op, "")

        # Extended fields present when rec_len >= 80
        if rec_len >= 80:
            row["rec_redo_offset"]      = u16(data, offset + 48)
            row["rec_redo_length"]      = u16(data, offset + 50)
            row["rec_undo_offset"]      = u16(data, offset + 52)
            row["rec_undo_length"]      = u16(data, offset + 54)
            row["rec_target_attribute"] = u16(data, offset + 56)
            row["rec_lcns_to_follow"]   = u16(data, offset + 58)
            row["rec_record_offset"]    = u16(data, offset + 60)
            row["rec_attribute_offset"] = u16(data, offset + 62)
            row["rec_cluster_index"]    = u16(data, offset + 64)
            row["rec_target_vcn"]       = i64(data, offset + 68) if rec_len >= 80 else ""
            row["rec_target_lcn"]       = i64(data, offset + 76) if rec_len >= 88 else ""

        rows.append(row)
        rec_idx += 1
        offset += rec_len

    return rows


def export_logfile(path: str, out_path: str):
    size = os.path.getsize(path)
    total_pages = size // LOGFILE_PAGE
    print(f"[INFO] $LogFile   : {path}")
    print(f"[INFO] Size       : {size:,} bytes  (~{total_pages:,} pages)")
    print(f"[INFO] Output CSV : {out_path}")

    total_rows = 0
    with open(path, "rb") as f, \
         open(out_path, "w", newline="", encoding="utf-8-sig") as cf:
        writer = csv.DictWriter(cf, fieldnames=LOGFILE_COLUMNS)
        writer.writeheader()
        page_num = 0
        while True:
            raw = f.read(LOGFILE_PAGE)
            if not raw or len(raw) < LOGFILE_PAGE:
                break
            rows = parse_logfile_page(raw, page_num)
            for row in rows:
                writer.writerow(row)
                total_rows += 1
            page_num += 1
            if page_num % 500 == 0:
                pct = page_num / total_pages * 100 if total_pages else 0
                print(f"  ... {page_num:,} pages / {total_rows:,} records ({pct:.1f}%)", end="\r")

    print(f"\n[DONE] $LogFile: {page_num:,} pages -> {total_rows:,} records written to {out_path}")


# ===========================================================================
# $UsnJrnl $J
# ===========================================================================

USN_REASONS = {
    0x00000001: "DataOverwrite",
    0x00000002: "DataExtend",
    0x00000004: "DataTruncation",
    0x00000010: "NamedDataOverwrite",
    0x00000020: "NamedDataExtend",
    0x00000040: "NamedDataTruncation",
    0x00000100: "FileCreate",
    0x00000200: "FileDelete",
    0x00000400: "EAChange",
    0x00000800: "SecurityChange",
    0x00001000: "RenameOldName",
    0x00002000: "RenameNewName",
    0x00004000: "IndexableChange",
    0x00008000: "BasicInfoChange",
    0x00010000: "HardLinkChange",
    0x00020000: "CompressionChange",
    0x00040000: "EncryptionChange",
    0x00080000: "ObjectIdChange",
    0x00100000: "ReparsePointChange",
    0x00200000: "StreamChange",
    0x00400000: "TransactedChange",
    0x80000000: "Close",
}

FILE_ATTRS = {
    0x0001: "ReadOnly",
    0x0002: "Hidden",
    0x0004: "System",
    0x0010: "Directory",
    0x0020: "Archive",
    0x0040: "Device",
    0x0080: "Normal",
    0x0100: "Temporary",
    0x0200: "Sparse",
    0x0400: "ReparsePoint",
    0x0800: "Compressed",
    0x1000: "Offline",
    0x2000: "NotIndexed",
    0x4000: "Encrypted",
    0x8000: "IntegrityStream",
    0x00010000: "Virtual",
    0x00020000: "NoScrub",
    0x00040000: "RecallOnOpen",
    0x00080000: "Pinned",
    0x00100000: "Unpinned",
    0x00400000: "RecallOnDataAccess",
}

SOURCE_INFO = {
    0x00000001: "DataManagement",
    0x00000002: "AuxiliaryData",
    0x00000004: "ReplicationManagement",
    0x00000008: "ClientReplication",
}

# CSV columns for $J (USN_RECORD_V2 and V3)
USNJ_COLUMNS = [
    "record_offset",            # byte offset in $J stream
    "record_length",
    "major_version",
    "minor_version",
    # File reference
    "file_ref_number",          # lower 48 bits
    "file_ref_seq",             # upper 16 bits (sequence number)
    "file_ref_hex",             # raw 64-bit hex
    # Parent reference
    "parent_ref_number",
    "parent_ref_seq",
    "parent_ref_hex",
    # USN (Update Sequence Number)
    "usn",
    "usn_hex",
    # Timestamp
    "timestamp_utc",
    "timestamp_raw",
    # Reason
    "reason_flags_raw",
    "reason_decoded",
    # Source info
    "source_info_raw",
    "source_info_decoded",
    # Security
    "security_id",
    # File attributes
    "file_attributes_raw",
    "file_attributes_decoded",
    # Filename
    "filename_length",
    "filename_offset",
    "filename",
    # V3 extra fields
    "file_id_128",              # V3 only: 128-bit file ID
    "parent_id_128",            # V3 only: 128-bit parent ID
]


def parse_usn_j_record(data: bytes, offset: int):
    """Parse one USN_RECORD_V2 or V3. Returns (row_dict, next_offset)."""
    if offset + 60 > len(data):
        return None, None

    rec_len = u32(data, offset)
    if rec_len < 60:
        return None, None
    if offset + rec_len > len(data):
        return None, None

    major = u16(data, offset + 4)
    minor = u16(data, offset + 6)

    if major == 2 and minor == 0:
        min_size = 60
    elif major == 3 and minor == 0:
        min_size = 80
    else:
        return None, offset + max(rec_len, 8)

    if rec_len < min_size:
        return None, offset + rec_len

    file_ref_raw   = u64(data, offset + 8)
    parent_ref_raw = u64(data, offset + 16)
    usn_val        = i64(data, offset + 24)
    ts_raw         = u64(data, offset + 32)
    reason_raw     = u32(data, offset + 40)
    src_raw        = u32(data, offset + 44)
    sec_id         = u32(data, offset + 48)
    attr_raw       = u32(data, offset + 52)
    fn_len         = u16(data, offset + 56)
    fn_off         = u16(data, offset + 58)

    row = {c: "" for c in USNJ_COLUMNS}
    row["record_offset"]          = offset
    row["record_length"]          = rec_len
    row["major_version"]          = major
    row["minor_version"]          = minor
    row["file_ref_number"]        = file_ref_raw & 0x0000FFFFFFFFFFFF
    row["file_ref_seq"]           = (file_ref_raw >> 48) & 0xFFFF
    row["file_ref_hex"]           = f"0x{file_ref_raw:016X}"
    row["parent_ref_number"]      = parent_ref_raw & 0x0000FFFFFFFFFFFF
    row["parent_ref_seq"]         = (parent_ref_raw >> 48) & 0xFFFF
    row["parent_ref_hex"]         = f"0x{parent_ref_raw:016X}"
    row["usn"]                    = usn_val
    row["usn_hex"]                = f"0x{usn_val & 0xFFFFFFFFFFFFFFFF:016X}"
    row["timestamp_utc"]          = filetime_to_str(ts_raw)
    row["timestamp_raw"]          = f"0x{ts_raw:016X}"
    row["reason_flags_raw"]       = f"0x{reason_raw:08X}"
    row["reason_decoded"]         = decode_flags(reason_raw, USN_REASONS)
    row["source_info_raw"]        = f"0x{src_raw:08X}"
    row["source_info_decoded"]    = decode_flags(src_raw, SOURCE_INFO)
    row["security_id"]            = sec_id
    row["file_attributes_raw"]    = f"0x{attr_raw:08X}"
    row["file_attributes_decoded"]= decode_flags(attr_raw, FILE_ATTRS)
    row["filename_length"]        = fn_len
    row["filename_offset"]        = fn_off

    abs_fn = offset + fn_off
    if abs_fn + fn_len <= len(data):
        row["filename"] = data[abs_fn: abs_fn + fn_len].decode("utf-16-le", errors="replace")

    # V3: 128-bit identifiers at offsets 60 and 72
    if major == 3 and rec_len >= 80:
        def fmt128(d, o):
            if o + 16 > len(d):
                return ""
            return d[o:o+16].hex().upper()
        row["file_id_128"]   = fmt128(data, offset + 60)
        row["parent_id_128"] = fmt128(data, offset + 68)

    return row, offset + rec_len


def export_usn_j(path: str, out_path: str, chunk: int = 64 * 1024 * 1024):
    """Export $J (USN journal data stream) to CSV. Reads in chunks for large files."""
    size = os.path.getsize(path)
    print(f"[INFO] $UsnJrnl $J : {path}")
    print(f"[INFO] Size         : {size:,} bytes")
    print(f"[INFO] Output CSV   : {out_path}")

    written = 0
    global_offset = 0

    with open(path, "rb") as f, \
         open(out_path, "w", newline="", encoding="utf-8-sig") as cf:
        writer = csv.DictWriter(cf, fieldnames=USNJ_COLUMNS)
        writer.writeheader()

        # $J begins with a sparse region of zeros — skip them
        leftover = b""
        while True:
            raw = f.read(chunk)
            if not raw:
                break

            data = leftover + raw
            offset = 0

            # Skip leading zeros (sparse region)
            while offset + 4 <= len(data) and u32(data, offset) == 0:
                offset += 8

            while offset < len(data):
                rec_len_peek = u32(data, offset) if offset + 4 <= len(data) else 0

                # If record would spill past this chunk, save remainder for next iteration
                if rec_len_peek > 0 and offset + rec_len_peek > len(data):
                    leftover = data[offset:]
                    break

                row, next_off = parse_usn_j_record(data, offset)

                if row is None:
                    if next_off is None:
                        leftover = b""
                        offset = len(data)
                        break
                    offset = next_off
                    continue

                # Adjust offset to be relative to the real file
                row["record_offset"] = global_offset + offset - len(leftover)
                writer.writerow(row)
                written += 1
                offset = next_off

                if written % 10000 == 0:
                    pct = (global_offset + offset) / size * 100 if size else 0
                    print(f"  ... {written:,} records written ({pct:.1f}%)", end="\r")
            else:
                leftover = b""

            global_offset += len(raw)

    print(f"\n[DONE] $J: {written:,} records written to {out_path}")


# ===========================================================================
# $UsnJrnl $Max
# ===========================================================================
#
# $Max is a small resident stream that holds a single USN_JOURNAL_DATA_V0/V1/V2
# structure describing the journal's configuration and current state.
# We export it as a single-row CSV with all fields.
#

USNMAX_COLUMNS = [
    "usn_journal_id",
    "usn_journal_id_hex",
    "first_usn",
    "first_usn_hex",
    "next_usn",
    "next_usn_hex",
    "lowest_valid_usn",
    "lowest_valid_usn_hex",
    "max_usn",
    "max_usn_hex",
    "maximum_size_bytes",
    "allocation_delta_bytes",
    # V1/V2 extra fields (Windows 8+)
    "min_supported_major_version",
    "max_supported_major_version",
    # V2 extra (Windows 10 1703+)
    "flags",
    "flags_decoded",
    "range_track_chunk_size",
    "range_track_file_size_threshold",
]

MAX_FLAGS = {
    0x00000001: "TrackModifiedRangesEnabled",
}

def export_usn_max(path: str, out_path: str):
    """Export $Max (journal configuration) to CSV — always a single row."""
    size = os.path.getsize(path)
    print(f"[INFO] $UsnJrnl $Max : {path}")
    print(f"[INFO] Size           : {size} bytes")
    print(f"[INFO] Output CSV     : {out_path}")

    with open(path, "rb") as f:
        data = f.read()

    row = {c: "" for c in USNMAX_COLUMNS}

    def put(col, val):
        row[col] = val

    if len(data) >= 56:  # V0 minimum
        jid  = u64(data, 0)
        fusn = i64(data, 8)
        nusn = i64(data, 16)
        lusn = i64(data, 24)
        musn = i64(data, 32)
        mxsz = u64(data, 40)
        adlt = u64(data, 48)

        put("usn_journal_id",        jid)
        put("usn_journal_id_hex",    f"0x{jid:016X}")
        put("first_usn",             fusn)
        put("first_usn_hex",         f"0x{fusn & 0xFFFFFFFFFFFFFFFF:016X}")
        put("next_usn",              nusn)
        put("next_usn_hex",          f"0x{nusn & 0xFFFFFFFFFFFFFFFF:016X}")
        put("lowest_valid_usn",      lusn)
        put("lowest_valid_usn_hex",  f"0x{lusn & 0xFFFFFFFFFFFFFFFF:016X}")
        put("max_usn",               musn)
        put("max_usn_hex",           f"0x{musn & 0xFFFFFFFFFFFFFFFF:016X}")
        put("maximum_size_bytes",    mxsz)
        put("allocation_delta_bytes",adlt)

    if len(data) >= 60:  # V1
        put("min_supported_major_version", u16(data, 56))
        put("max_supported_major_version", u16(data, 58))

    if len(data) >= 80:  # V2
        flags = u32(data, 60)
        put("flags",               f"0x{flags:08X}")
        put("flags_decoded",       decode_flags(flags, MAX_FLAGS))
        put("range_track_chunk_size",             u64(data, 64))
        put("range_track_file_size_threshold",    i64(data, 72))

    with open(out_path, "w", newline="", encoding="utf-8-sig") as cf:
        writer = csv.DictWriter(cf, fieldnames=USNMAX_COLUMNS)
        writer.writeheader()
        writer.writerow(row)

    print(f"[DONE] $Max: 1 row written to {out_path}")
    print()
    print("  Journal summary:")
    print(f"    Journal ID   : {row['usn_journal_id_hex']}")
    print(f"    First USN    : {row['first_usn']}")
    print(f"    Next USN     : {row['next_usn']}")
    print(f"    Max size     : {int(row['maximum_size_bytes']):,} bytes" if row['maximum_size_bytes'] else "")
    print(f"    Alloc delta  : {int(row['allocation_delta_bytes']):,} bytes" if row['allocation_delta_bytes'] else "")
    if row["min_supported_major_version"]:
        print(f"    USN version  : V{row['min_supported_major_version']}..V{row['max_supported_major_version']}")


# ===========================================================================
# Entry point
# ===========================================================================

def main():
    p = argparse.ArgumentParser(
        description="Export $LogFile, $UsnJrnl $J, and $UsnJrnl $Max to CSV",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples (PowerShell -- single quotes prevent $ expansion):\n\n"
            "  # Individual files\n"
            "  python log_usn_to_csv.py --log    '$LogFile'  --outlog  logfile.csv\n"
            "  python log_usn_to_csv.py --usnj   '$J'        --outj    usnjrnl_j.csv\n"
            "  python log_usn_to_csv.py --usnmax '$Max'      --outmax  usnjrnl_max.csv\n\n"
            "  # All three at once\n"
            "  python log_usn_to_csv.py --log '$LogFile' --usnj '$J' --usnmax '$Max' "
            "--outlog logfile.csv --outj usnjrnl_j.csv --outmax usnjrnl_max.csv\n"
        )
    )
    p.add_argument("--log",    metavar="FILE", help="Path to $LogFile")
    p.add_argument("--usnj",   metavar="FILE", help="Path to $UsnJrnl $J stream")
    p.add_argument("--usnmax", metavar="FILE", help="Path to $UsnJrnl $Max stream")
    p.add_argument("--outlog", metavar="CSV",  default="logfile.csv",     help="Output for $LogFile  (default: logfile.csv)")
    p.add_argument("--outj",   metavar="CSV",  default="usnjrnl_j.csv",   help="Output for $J        (default: usnjrnl_j.csv)")
    p.add_argument("--outmax", metavar="CSV",  default="usnjrnl_max.csv", help="Output for $Max      (default: usnjrnl_max.csv)")

    args = p.parse_args()

    if not any([args.log, args.usnj, args.usnmax]):
        p.print_help()
        sys.exit(0)

    if args.log:
        path = fix_path(args.log, ["$LogFile", "LogFile"])
        export_logfile(path, args.outlog)
        print()

    if args.usnj:
        path = fix_path(args.usnj, ["$J", "J"])
        export_usn_j(path, args.outj)
        print()

    if args.usnmax:
        path = fix_path(args.usnmax, ["$Max", "Max"])
        export_usn_max(path, args.outmax)


if __name__ == "__main__":
    main()
