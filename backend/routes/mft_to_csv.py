#!/usr/bin/env python3
"""
MFT -> CSV Full Exporter
========================
Dumps EVERY field from EVERY MFT record into a CSV.

One row per record. Columns cover:
  - MFT record header fields
  - $STANDARD_INFORMATION  (SI_*) : all 4 MACB timestamps, DOS flags, owner, security
  - $FILE_NAME             (FN_*) : all 4 MACB timestamps, sizes, namespace, parent ref
  - $DATA                  (DATA_*): resident/non-resident, real size, alloc size, VCN
  - $OBJECT_ID             (OID_*): GUID fields
  - $VOLUME_NAME           (VOL_NAME)
  - $VOLUME_INFORMATION    (VOL_*): NTFS version, flags
  - $INDEX_ROOT            (IDX_*): type, collation rule
  - $ATTRIBUTE_LIST        (ALIST): present flag
  - $SECURITY_DESCRIPTOR   (SD_*): present flag, size
  - $REPARSE_POINT         (RP_*): reparse tag
  - $EA / $EA_INFORMATION  (EA_*): sizes
  - $BITMAP                (BMP_*): sizes
  - $LOGGED_UTILITY_STREAM (LUS_*): present flag
  - raw attribute inventory: comma-separated list of all attribute type names

Usage:
  python mft_to_csv.py --mft "E:/isea_hackathon/$MFT" --out mft_dump.csv
  python mft_to_csv.py --mft "E:/isea_hackathon/$MFT" --out mft_dump.csv --search dos.pdf
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

EPOCH_DIFF = 116444736000000000  # 100-ns ticks between 1601-01-01 and 1970-01-01

def filetime_to_str(ft: int) -> str:
    if ft == 0:
        return ""
    try:
        ts = (ft - EPOCH_DIFF) / 1e7
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return ""

def filetime_to_raw(ft: int) -> str:
    return f"0x{ft:016X}" if ft else ""

def u8(d, o):  return struct.unpack_from("<B", d, o)[0]
def u16(d, o): return struct.unpack_from("<H", d, o)[0]
def u32(d, o): return struct.unpack_from("<I", d, o)[0]
def u64(d, o): return struct.unpack_from("<Q", d, o)[0]
def s64(d, o): return struct.unpack_from("<q", d, o)[0]

def safe_u16(d, o): return u16(d, o) if o + 2 <= len(d) else 0
def safe_u32(d, o): return u32(d, o) if o + 4 <= len(d) else 0
def safe_u64(d, o): return u64(d, o) if o + 8 <= len(d) else 0

def guid_str(data: bytes, offset: int) -> str:
    if offset + 16 > len(data):
        return ""
    d = data[offset:offset+16]
    return (f"{u32(d,0):08X}-{u16(d,4):04X}-{u16(d,6):04X}-"
            f"{d[8]:02X}{d[9]:02X}-"
            f"{d[10]:02X}{d[11]:02X}{d[12]:02X}{d[13]:02X}{d[14]:02X}{d[15]:02X}")

# ---------------------------------------------------------------------------
# Decode tables
# ---------------------------------------------------------------------------

FILE_FLAGS = {
    0x0001: "InUse",
    0x0002: "Directory",
    0x0004: "Extension",
    0x0008: "SpecialIndex",
}

DOS_FLAGS = {
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
}

FN_NAMESPACE = {0: "POSIX", 1: "Win32", 2: "DOS", 3: "Win32&DOS"}

ATTR_TYPES = {
    0x10: "$STANDARD_INFORMATION",
    0x20: "$ATTRIBUTE_LIST",
    0x30: "$FILE_NAME",
    0x40: "$OBJECT_ID",
    0x50: "$SECURITY_DESCRIPTOR",
    0x60: "$VOLUME_NAME",
    0x70: "$VOLUME_INFORMATION",
    0x80: "$DATA",
    0x90: "$INDEX_ROOT",
    0xA0: "$INDEX_ALLOCATION",
    0xB0: "$BITMAP",
    0xC0: "$REPARSE_POINT",
    0xD0: "$EA_INFORMATION",
    0xE0: "$EA",
    0x100: "$LOGGED_UTILITY_STREAM",
    0xFFFFFFFF: "END",
}

VOL_FLAGS = {
    0x0001: "Dirty",
    0x0002: "ResizeLogFile",
    0x0004: "UpgradeOnMount",
    0x0008: "MountedOnNT4",
    0x0010: "DeleteUSNUnderway",
    0x0020: "RepairObjectIds",
    0x0040: "ModifiedByChkdsk",
    0x8000: "ModifiedByChkdsk2",
}

REPARSE_TAGS = {
    0xA0000003: "MOUNT_POINT",
    0xA000000C: "SYMLINK",
    0x80000017: "WIM",
    0xC0000004: "HSM",
    0x80000006: "HSM2",
    0x80000007: "SIS",
    0x80000008: "WOF",
    0xA0000009: "DFS",
    0xA000000A: "DFSR",
    0xA000000B: "DEDUP",
    0xA0000014: "APPXSTRM",
    0x80000012: "ONEDRIVE",
    0x9000001A: "PROJFS",
}

def decode_flags(value: int, flag_map: dict) -> str:
    return "|".join(name for mask, name in flag_map.items() if value & mask) or ""

# ---------------------------------------------------------------------------
# CSV column definitions  (order matters — this is what the header looks like)
# ---------------------------------------------------------------------------

COLUMNS = [
    # ── MFT Record Header ──────────────────────────────────────────────────
    "record_number",
    "signature",
    "is_in_use",
    "is_directory",
    "is_extension",
    "is_special_index",
    "flags_raw",
    "sequence_number",
    "log_file_sequence_number",
    "hard_link_count",
    "first_attr_offset",
    "used_size_bytes",
    "allocated_size_bytes",
    "base_record_ref",
    "base_record_seq",
    "next_attr_id",
    "record_offset_in_mft",
    "attribute_list",           # comma-sep list of all attr type names

    # ── $STANDARD_INFORMATION (0x10) ──────────────────────────────────────
    "SI_created_utc",
    "SI_modified_utc",
    "SI_mft_changed_utc",
    "SI_accessed_utc",
    "SI_created_raw",
    "SI_modified_raw",
    "SI_mft_changed_raw",
    "SI_accessed_raw",
    "SI_dos_flags_raw",
    "SI_dos_flags_decoded",
    "SI_max_versions",
    "SI_version",
    "SI_class_id",
    "SI_owner_id",
    "SI_security_id",
    "SI_quota_charged",
    "SI_update_sequence_number",

    # ── $FILE_NAME (0x30) — up to 3 instances (POSIX / Win32 / DOS) ───────
    "FN1_filename",
    "FN1_namespace",
    "FN1_parent_ref",
    "FN1_parent_seq",
    "FN1_created_utc",
    "FN1_modified_utc",
    "FN1_mft_changed_utc",
    "FN1_accessed_utc",
    "FN1_alloc_size_bytes",
    "FN1_real_size_bytes",
    "FN1_flags_decoded",
    "FN1_reparse_value",

    "FN2_filename",
    "FN2_namespace",
    "FN2_parent_ref",
    "FN2_parent_seq",
    "FN2_created_utc",
    "FN2_modified_utc",
    "FN2_mft_changed_utc",
    "FN2_accessed_utc",
    "FN2_alloc_size_bytes",
    "FN2_real_size_bytes",
    "FN2_flags_decoded",
    "FN2_reparse_value",

    "FN3_filename",
    "FN3_namespace",
    "FN3_parent_ref",
    "FN3_parent_seq",
    "FN3_created_utc",
    "FN3_modified_utc",
    "FN3_mft_changed_utc",
    "FN3_accessed_utc",
    "FN3_alloc_size_bytes",
    "FN3_real_size_bytes",
    "FN3_flags_decoded",
    "FN3_reparse_value",

    # ── $DATA (0x80) ───────────────────────────────────────────────────────
    "DATA_stream_count",
    "DATA_resident",
    "DATA_real_size_bytes",
    "DATA_alloc_size_bytes",
    "DATA_init_size_bytes",
    "DATA_start_vcn",
    "DATA_end_vcn",
    "DATA_stream_names",        # named ADS streams, comma-sep

    # ── $OBJECT_ID (0x40) ──────────────────────────────────────────────────
    "OID_object_id",
    "OID_birth_volume_id",
    "OID_birth_object_id",
    "OID_domain_id",

    # ── $VOLUME_NAME (0x60) ────────────────────────────────────────────────
    "VOL_name",

    # ── $VOLUME_INFORMATION (0x70) ─────────────────────────────────────────
    "VOL_ntfs_major",
    "VOL_ntfs_minor",
    "VOL_flags_raw",
    "VOL_flags_decoded",

    # ── $INDEX_ROOT (0x90) ─────────────────────────────────────────────────
    "IDX_attr_type",
    "IDX_collation_rule",
    "IDX_alloc_size",
    "IDX_clusters_per_block",

    # ── $SECURITY_DESCRIPTOR (0x50) ────────────────────────────────────────
    "SD_present",
    "SD_size_bytes",

    # ── $REPARSE_POINT (0xC0) ──────────────────────────────────────────────
    "RP_tag_raw",
    "RP_tag_name",
    "RP_data_length",
    "RP_target",                # symlink / mount-point target if parseable

    # ── $EA_INFORMATION (0xD0) + $EA (0xE0) ───────────────────────────────
    "EA_info_size",
    "EA_data_size",
    "EA_count",

    # ── $BITMAP (0xB0) ─────────────────────────────────────────────────────
    "BMP_size_bytes",

    # ── $ATTRIBUTE_LIST (0x20) ─────────────────────────────────────────────
    "ALIST_present",
    "ALIST_size_bytes",

    # ── $LOGGED_UTILITY_STREAM (0x100) ─────────────────────────────────────
    "LUS_present",
    "LUS_size_bytes",

    # ── Timestomp detection helper ──────────────────────────────────────────
    "TIMESTOMP_si_fn_created_diff_sec",
    "TIMESTOMP_si_fn_modified_diff_sec",
    "TIMESTOMP_nanosec_zeroed",         # True if SI timestamps have .0000000 sub-second
]

# ---------------------------------------------------------------------------
# Core parser
# ---------------------------------------------------------------------------

MFT_SIG = b"FILE"
MFT_RECORD_SIZE = 1024

def apply_fixup(data: bytearray) -> bytearray:
    """Apply Update Sequence Array fixup to restore original sector-end bytes."""
    if len(data) < 8:
        return data
    usa_offset = u16(data, 4)
    usa_count  = u16(data, 6)
    if usa_offset + usa_count * 2 > len(data):
        return data
    seq_num = u16(data, usa_offset)
    for i in range(1, usa_count):
        sector_end = i * 512 - 2
        if sector_end + 2 > len(data):
            break
        # verify
        if u16(data, sector_end) != seq_num:
            break  # fixup mismatch — record may be corrupt
        orig = u16(data, usa_offset + i * 2)
        data[sector_end]     = orig & 0xFF
        data[sector_end + 1] = (orig >> 8) & 0xFF
    return data


def parse_fn_attr(content: bytes) -> dict:
    """Parse $FILE_NAME attribute content into a dict."""
    if len(content) < 66:
        return {}
    parent_ref_raw = u64(content, 0)
    r = {
        "parent_ref": parent_ref_raw & 0x0000FFFFFFFFFFFF,
        "parent_seq": (parent_ref_raw >> 48) & 0xFFFF,
        "created_utc":     filetime_to_str(u64(content, 8)),
        "modified_utc":    filetime_to_str(u64(content, 16)),
        "mft_changed_utc": filetime_to_str(u64(content, 24)),
        "accessed_utc":    filetime_to_str(u64(content, 32)),
        "alloc_size":      u64(content, 40),
        "real_size":       u64(content, 48),
        "flags":           u32(content, 56),
        "flags_decoded":   decode_flags(u32(content, 56), DOS_FLAGS),
        "reparse_value":   u32(content, 60),
        "namespace":       FN_NAMESPACE.get(u8(content, 65), str(u8(content, 65))),
    }
    name_len = u8(content, 64)
    if len(content) >= 66 + name_len * 2:
        r["filename"] = content[66: 66 + name_len * 2].decode("utf-16-le", errors="replace")
    else:
        r["filename"] = ""
    return r


def parse_mft_record(raw_data: bytes, record_num: int, file_offset: int) -> dict:
    """Parse one MFT record into a flat dict matching COLUMNS."""
    row = {c: "" for c in COLUMNS}

    data = bytearray(raw_data)
    if data[0:4] != MFT_SIG:
        return None

    data = apply_fixup(data)

    # ── Header ──────────────────────────────────────────────────────────────
    flags_raw       = u16(data, 22)
    base_ref_raw    = u64(data, 32)

    row["record_number"]            = record_num
    row["signature"]                = data[0:4].decode("ascii", errors="replace")
    row["is_in_use"]                = bool(flags_raw & 0x0001)
    row["is_directory"]             = bool(flags_raw & 0x0002)
    row["is_extension"]             = bool(flags_raw & 0x0004)
    row["is_special_index"]         = bool(flags_raw & 0x0008)
    row["flags_raw"]                = f"0x{flags_raw:04X}"
    row["sequence_number"]          = u16(data, 16)
    row["log_file_sequence_number"] = f"0x{u64(data, 8):016X}"
    row["hard_link_count"]          = u16(data, 18)
    row["first_attr_offset"]        = u16(data, 20)
    row["used_size_bytes"]          = u32(data, 24)
    row["allocated_size_bytes"]     = u32(data, 28)
    row["base_record_ref"]          = base_ref_raw & 0x0000FFFFFFFFFFFF
    row["base_record_seq"]          = (base_ref_raw >> 48) & 0xFFFF
    row["next_attr_id"]             = u16(data, 40)
    row["record_offset_in_mft"]     = file_offset

    # ── Walk attributes ──────────────────────────────────────────────────────
    attr_names = []
    fn_list    = []   # collect all $FILE_NAME instances
    data_streams = [] # collect all $DATA instances

    offset = u16(data, 20)

    while offset + 4 <= len(data):
        atype = u32(data, offset)
        if atype == 0xFFFFFFFF or atype == 0:
            break
        if offset + 8 > len(data):
            break
        alen = u32(data, offset + 4)
        if alen < 8 or offset + alen > len(data):
            break

        aname_len    = u8(data, offset + 9)
        non_resident = bool(u8(data, offset + 8))
        atype_name   = ATTR_TYPES.get(atype, f"0x{atype:08X}")
        attr_names.append(atype_name)

        # Get attribute name (ADS name for $DATA etc.)
        attr_stream_name = ""
        if aname_len > 0:
            aname_off = u16(data, offset + 10)
            nstart = offset + aname_off
            if nstart + aname_len * 2 <= len(data):
                attr_stream_name = data[nstart: nstart + aname_len * 2].decode("utf-16-le", errors="replace")

        # ── Resident content ──────────────────────────────────────────────
        content = b""
        if not non_resident and alen >= 24:
            c_off = u16(data, offset + 20)
            c_len = u32(data, offset + 16)
            cs = offset + c_off
            content = bytes(data[cs: cs + c_len])

        # ── Non-resident fields ────────────────────────────────────────────
        nr_start_vcn = nr_end_vcn = nr_alloc = nr_init = nr_real = 0
        if non_resident and alen >= 64:
            nr_start_vcn = u64(data, offset + 16)
            nr_end_vcn   = u64(data, offset + 24)
            nr_alloc     = u64(data, offset + 40)
            nr_real      = u64(data, offset + 48)
            nr_init      = u64(data, offset + 56)

        # ── Per-attribute parsing ──────────────────────────────────────────

        if atype == 0x10:  # $STANDARD_INFORMATION
            if len(content) >= 48:
                si_c  = u64(content, 0)
                si_m  = u64(content, 8)
                si_mc = u64(content, 16)
                si_a  = u64(content, 24)
                si_df = u32(content, 32)
                row["SI_created_utc"]     = filetime_to_str(si_c)
                row["SI_modified_utc"]    = filetime_to_str(si_m)
                row["SI_mft_changed_utc"] = filetime_to_str(si_mc)
                row["SI_accessed_utc"]    = filetime_to_str(si_a)
                row["SI_created_raw"]     = filetime_to_raw(si_c)
                row["SI_modified_raw"]    = filetime_to_raw(si_m)
                row["SI_mft_changed_raw"] = filetime_to_raw(si_mc)
                row["SI_accessed_raw"]    = filetime_to_raw(si_a)
                row["SI_dos_flags_raw"]   = f"0x{si_df:08X}"
                row["SI_dos_flags_decoded"] = decode_flags(si_df, DOS_FLAGS)
                row["SI_max_versions"]    = u32(content, 36) if len(content) >= 40 else ""
                row["SI_version"]         = u32(content, 40) if len(content) >= 44 else ""
                row["SI_class_id"]        = u32(content, 44) if len(content) >= 48 else ""
                if len(content) >= 72:
                    row["SI_owner_id"]    = u32(content, 48)
                    row["SI_security_id"] = u32(content, 52)
                    row["SI_quota_charged"] = u64(content, 56)
                    row["SI_update_sequence_number"] = f"0x{u64(content, 64):016X}" if len(content) >= 72 else ""
                # Timestomp: nanosec zeroed check (lower 7 digits of raw filetime = 100ns units)
                row["TIMESTOMP_nanosec_zeroed"] = all(ft % 10000000 == 0 for ft in [si_c, si_m, si_mc, si_a] if ft != 0)

        elif atype == 0x30:  # $FILE_NAME
            fn_list.append(parse_fn_attr(content))

        elif atype == 0x40:  # $OBJECT_ID
            if len(content) >= 16:
                row["OID_object_id"]    = guid_str(content, 0)
            if len(content) >= 32:
                row["OID_birth_volume_id"]  = guid_str(content, 16)
            if len(content) >= 48:
                row["OID_birth_object_id"]  = guid_str(content, 32)
            if len(content) >= 64:
                row["OID_domain_id"]        = guid_str(content, 48)

        elif atype == 0x50:  # $SECURITY_DESCRIPTOR
            row["SD_present"] = True
            row["SD_size_bytes"] = len(content) if not non_resident else nr_real

        elif atype == 0x60:  # $VOLUME_NAME
            row["VOL_name"] = content.decode("utf-16-le", errors="replace")

        elif atype == 0x70:  # $VOLUME_INFORMATION
            if len(content) >= 8:
                vf = u16(content, 6)
                row["VOL_ntfs_major"]    = u8(content, 4)
                row["VOL_ntfs_minor"]    = u8(content, 5)
                row["VOL_flags_raw"]     = f"0x{vf:04X}"
                row["VOL_flags_decoded"] = decode_flags(vf, VOL_FLAGS)

        elif atype == 0x80:  # $DATA
            ds = {
                "name":     attr_stream_name,
                "resident": not non_resident,
                "real":     len(content) if not non_resident else nr_real,
                "alloc":    len(content) if not non_resident else nr_alloc,
                "init":     len(content) if not non_resident else nr_init,
                "start_vcn": nr_start_vcn,
                "end_vcn":   nr_end_vcn,
            }
            data_streams.append(ds)

        elif atype == 0x90:  # $INDEX_ROOT
            if len(content) >= 16:
                row["IDX_attr_type"]         = f"0x{u32(content,0):08X}"
                row["IDX_collation_rule"]    = u32(content, 4)
                row["IDX_alloc_size"]        = u32(content, 8)
                row["IDX_clusters_per_block"]= u8(content, 12)

        elif atype == 0xB0:  # $BITMAP
            row["BMP_size_bytes"] = len(content) if not non_resident else nr_real

        elif atype == 0xC0:  # $REPARSE_POINT
            if len(content) >= 8:
                tag = u32(content, 0)
                dlen = u16(content, 4)
                row["RP_tag_raw"]     = f"0x{tag:08X}"
                row["RP_tag_name"]    = REPARSE_TAGS.get(tag, "")
                row["RP_data_length"] = dlen
                # Try to decode symlink / mount point target
                if tag in (0xA0000003, 0xA000000C) and len(content) >= 20:
                    sub_off = u16(content, 8)
                    sub_len = u16(content, 10)
                    path_start = 16 + sub_off
                    if path_start + sub_len <= len(content):
                        row["RP_target"] = content[path_start: path_start+sub_len].decode("utf-16-le", errors="replace")

        elif atype == 0xD0:  # $EA_INFORMATION
            if len(content) >= 8:
                row["EA_info_size"] = u16(content, 2)
                row["EA_count"]     = u16(content, 4)

        elif atype == 0xE0:  # $EA
            row["EA_data_size"] = len(content) if not non_resident else nr_real

        elif atype == 0x20:  # $ATTRIBUTE_LIST
            row["ALIST_present"]    = True
            row["ALIST_size_bytes"] = len(content) if not non_resident else nr_real

        elif atype == 0x100:  # $LOGGED_UTILITY_STREAM
            row["LUS_present"]    = True
            row["LUS_size_bytes"] = len(content) if not non_resident else nr_real

        offset += alen

    # ── Flatten $FILE_NAME list (up to 3 instances) ──────────────────────
    for i, fn in enumerate(fn_list[:3], start=1):
        pfx = f"FN{i}_"
        row[pfx+"filename"]        = fn.get("filename","")
        row[pfx+"namespace"]       = fn.get("namespace","")
        row[pfx+"parent_ref"]      = fn.get("parent_ref","")
        row[pfx+"parent_seq"]      = fn.get("parent_seq","")
        row[pfx+"created_utc"]     = fn.get("created_utc","")
        row[pfx+"modified_utc"]    = fn.get("modified_utc","")
        row[pfx+"mft_changed_utc"] = fn.get("mft_changed_utc","")
        row[pfx+"accessed_utc"]    = fn.get("accessed_utc","")
        row[pfx+"alloc_size_bytes"]= fn.get("alloc_size","")
        row[pfx+"real_size_bytes"] = fn.get("real_size","")
        row[pfx+"flags_decoded"]   = fn.get("flags_decoded","")
        row[pfx+"reparse_value"]   = fn.get("reparse_value","")

    # ── Flatten $DATA streams ─────────────────────────────────────────────
    if data_streams:
        primary = next((d for d in data_streams if d["name"] == ""), data_streams[0])
        row["DATA_stream_count"]  = len(data_streams)
        row["DATA_resident"]      = primary["resident"]
        row["DATA_real_size_bytes"]  = primary["real"]
        row["DATA_alloc_size_bytes"] = primary["alloc"]
        row["DATA_init_size_bytes"]  = primary["init"]
        row["DATA_start_vcn"]     = primary["start_vcn"]
        row["DATA_end_vcn"]       = primary["end_vcn"]
        ads_names = [d["name"] for d in data_streams if d["name"]]
        row["DATA_stream_names"]  = "; ".join(ads_names)

    # ── Attribute inventory ───────────────────────────────────────────────
    row["attribute_list"] = ", ".join(attr_names)

    # ── Timestomp SI vs FN diff ───────────────────────────────────────────
    if fn_list and row["SI_created_utc"] and fn_list[0].get("created_utc"):
        def to_ts(s):
            try:
                return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").timestamp()
            except Exception:
                return None
        si_c = to_ts(row["SI_created_utc"])
        fn_c = to_ts(fn_list[0]["created_utc"])
        si_m = to_ts(row["SI_modified_utc"])
        fn_m = to_ts(fn_list[0].get("modified_utc",""))
        if si_c and fn_c:
            row["TIMESTOMP_si_fn_created_diff_sec"]  = round(abs(si_c - fn_c))
        if si_m and fn_m:
            row["TIMESTOMP_si_fn_modified_diff_sec"] = round(abs(si_m - fn_m))

    return row


# ---------------------------------------------------------------------------
# Main export function
# ---------------------------------------------------------------------------

def export_mft_to_csv(mft_path: str, out_path: str, search: str = None):
    try:
        total_size = os.path.getsize(mft_path)
    except OSError as e:
        print(f"[ERROR] Cannot stat {mft_path}: {e}")
        sys.exit(1)

    total_records = total_size // MFT_RECORD_SIZE
    print(f"[INFO] MFT file  : {mft_path}")
    print(f"[INFO] Total size: {total_size:,} bytes  (~{total_records:,} records)")
    print(f"[INFO] Output CSV: {out_path}")
    if search:
        print(f"[INFO] Filtering : filename contains '{search}'")
    print()

    written = 0
    scanned = 0

    with open(mft_path, "rb") as mft_f, \
         open(out_path,  "w", newline="", encoding="utf-8-sig") as csv_f:

        writer = csv.DictWriter(csv_f, fieldnames=COLUMNS)
        writer.writeheader()

        record_num = 0
        while True:
            raw = mft_f.read(MFT_RECORD_SIZE)
            if not raw or len(raw) < MFT_RECORD_SIZE:
                break

            file_offset = record_num * MFT_RECORD_SIZE
            row = parse_mft_record(raw, record_num, file_offset)
            record_num += 1

            if row is None:
                continue

            scanned += 1

            if search:
                # Check all three FN filename slots
                names = [str(row.get(f"FN{i}_filename","")) for i in (1,2,3)]
                if not any(search.lower() in n.lower() for n in names):
                    continue

            writer.writerow(row)
            written += 1

            # Progress every 1000 records
            if scanned % 1000 == 0:
                pct = scanned / total_records * 100 if total_records else 0
                print(f"  ... {scanned:,} scanned / {written:,} written  ({pct:.1f}%)", end="\r")

    print(f"\n[DONE] Scanned {scanned:,} records. Wrote {written:,} rows to: {out_path}")
    if written > 0 and search is None:
        print(f"[TIP]  Open in Excel and filter column 'is_in_use'=True for live files only.")
        print(f"[TIP]  Sort by 'TIMESTOMP_si_fn_created_diff_sec' desc to spot timestomping.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Dump every MFT record and attribute to CSV",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            '  python mft_to_csv.py --mft "E:/isea_hackathon/$MFT" --out mft_dump.csv\n'
            '  python mft_to_csv.py --mft "E:/isea_hackathon/$MFT" --out dos_pdf.csv --search dos.pdf\n'
        )
    )
    parser.add_argument("--mft",    required=True, metavar="FILE", help="Path to $MFT file")
    parser.add_argument("--out",    required=True, metavar="CSV",  help="Output CSV file path")
    parser.add_argument("--search", metavar="NAME", default=None,
                        help="Only export records whose filename contains this string")
    args = parser.parse_args()

    # Path sanitizer — handles PowerShell $ stripping
    mft = args.mft.strip()
    while mft.endswith("\\") or mft.endswith("/"):
        mft = mft[:-1]
    if not os.path.isfile(mft):
        for candidate_name in ["$MFT", "MFT"]:
            candidate = os.path.join(mft, candidate_name)
            if os.path.isfile(candidate):
                print(f"[INFO] Auto-resolved MFT path: {candidate}")
                mft = candidate
                break
        else:
            print(f"[ERROR] File not found: {mft}")
            print("  TIP:  Use forward slashes in PowerShell:")
            print('        python mft_to_csv.py --mft "E:/isea_hackathon/$MFT" --out dump.csv')
            sys.exit(1)

    export_mft_to_csv(mft, args.out, search=args.search)


if __name__ == "__main__":
    main()
