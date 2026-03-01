// gcc low-level-c/extract_mft.c -o low-level-c/extract_mft.exe -ladvapi32

// .\low-level-c\extract_mft.exe --help
// .\low-level-c\extract_mft.exe --list
// .\low-level-c\extract_mft.exe --extract E
// .\low-level-c\extract_mft.exe --extract 2
// .\low-level-c\extract_mft.exe --list --extract E

#include <windows.h>
#include <winioctl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

#define MAX_NTFS_DRIVES 64
#define COPY_BUFFER_SIZE (1024 * 1024)
#define USN_SEARCH_LIMIT 200000ULL

typedef struct NtfsDriveInfo {
    char root[4];     /* e.g. "C:\\" */
    char letter;      /* e.g. 'C' */
    ULONGLONG total;
    ULONGLONG free_space;
} NtfsDriveInfo;

typedef struct NtfsBootInfo {
    DWORD bytes_per_sector;
    DWORD sectors_per_cluster;
    DWORD bytes_per_cluster;
    ULONGLONG mft_cluster;
    ULONGLONG mft_offset;
    DWORD mft_record_size;
} NtfsBootInfo;

static WORD read_u16_le(const BYTE *p) {
    return (WORD)(p[0] | (p[1] << 8));
}

static DWORD read_u32_le(const BYTE *p) {
    return (DWORD)p[0] | ((DWORD)p[1] << 8) | ((DWORD)p[2] << 16) | ((DWORD)p[3] << 24);
}

static ULONGLONG read_u64_le(const BYTE *p) {
    ULONGLONG v = 0;
    int i;
    for (i = 0; i < 8; i++) {
        v |= ((ULONGLONG)p[i]) << (8 * i);
    }
    return v;
}

static ULONGLONG read_unsigned_le(const BYTE *p, int nbytes) {
    ULONGLONG v = 0;
    int i;
    for (i = 0; i < nbytes; i++) {
        v |= ((ULONGLONG)p[i]) << (8 * i);
    }
    return v;
}

static LONGLONG read_signed_le(const BYTE *p, int nbytes) {
    LONGLONG v = 0;
    int i;
    for (i = 0; i < nbytes; i++) {
        v |= ((LONGLONG)p[i]) << (8 * i);
    }
    if (nbytes > 0 && nbytes < 8 && (p[nbytes - 1] & 0x80) != 0) {
        v |= -((LONGLONG)1 << (nbytes * 8));
    }
    return v;
}

static void json_escape_string(const char *src, char *dst, size_t dst_size) {
    size_t i = 0;
    size_t j = 0;
    if (!src || !dst || dst_size < 2) return;
    
    while (src[i] && j < dst_size - 2) {
        if (src[i] == '"' || src[i] == '\\' || src[i] == '\n' || src[i] == '\r' || src[i] == '\t') {
            if (j + 2 >= dst_size) break;
            dst[j++] = '\\';
            if (src[i] == '"') dst[j++] = '"';
            else if (src[i] == '\\') dst[j++] = '\\';
            else if (src[i] == '\n') dst[j++] = 'n';
            else if (src[i] == '\r') dst[j++] = 'r';
            else if (src[i] == '\t') dst[j++] = 't';
        } else {
            dst[j++] = src[i];
        }
        i++;
    }
    dst[j] = '\0';
}

static void print_json_error(const char *message, DWORD error_code) {
    LPSTR msg_buf = NULL;
    char escaped_msg[512] = {0};
    char escaped_sys_msg[512] = {0};
    DWORD flags = FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS;
    DWORD lang = MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT);

    json_escape_string(message, escaped_msg, sizeof(escaped_msg));
    
    FormatMessageA(flags, NULL, error_code, lang, (LPSTR)&msg_buf, 0, NULL);
    if (msg_buf) {
        size_t n = strlen(msg_buf);
        while (n > 0 && (msg_buf[n - 1] == '\r' || msg_buf[n - 1] == '\n')) {
            msg_buf[n - 1] = '\0';
            n--;
        }
        json_escape_string(msg_buf, escaped_sys_msg, sizeof(escaped_sys_msg));
        printf("{\"type\":\"error\",\"message\":\"%s\",\"error_code\":%lu,\"system_error\":\"%s\"}\n", 
               escaped_msg, (unsigned long)error_code, escaped_sys_msg);
        LocalFree(msg_buf);
    } else {
        printf("{\"type\":\"error\",\"message\":\"%s\",\"error_code\":%lu}\n", escaped_msg, (unsigned long)error_code);
    }
}

static void print_json_status(const char *status, const char *message) {
    char escaped_msg[512] = {0};
    json_escape_string(message, escaped_msg, sizeof(escaped_msg));
    printf("{\"type\":\"status\",\"status\":\"%s\",\"message\":\"%s\"}\n", status, escaped_msg);
}

static void print_json_info(const char *key, const char *value) {
    char escaped_val[512] = {0};
    json_escape_string(value, escaped_val, sizeof(escaped_val));
    printf("{\"type\":\"info\",\"key\":\"%s\",\"value\":\"%s\"}\n", key, escaped_val);
}

static void print_win32_error(const char *prefix, DWORD error_code) {
    print_json_error(prefix, error_code);
}

static int enable_privilege(LPCSTR privilege_name) {
    HANDLE token = NULL;
    TOKEN_PRIVILEGES tp;
    LUID luid;

    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &token)) {
        return 0;
    }
    if (!LookupPrivilegeValueA(NULL, privilege_name, &luid)) {
        CloseHandle(token);
        return 0;
    }

    tp.PrivilegeCount = 1;
    tp.Privileges[0].Luid = luid;
    tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
    if (!AdjustTokenPrivileges(token, FALSE, &tp, sizeof(tp), NULL, NULL)) {
        CloseHandle(token);
        return 0;
    }

    CloseHandle(token);
    return (GetLastError() == ERROR_SUCCESS);
}

static int mkdir_if_missing(const char *path) {
    DWORD attrs = GetFileAttributesA(path);
    if (attrs != INVALID_FILE_ATTRIBUTES) {
        return (attrs & FILE_ATTRIBUTE_DIRECTORY) ? 1 : 0;
    }
    return CreateDirectoryA(path, NULL) ? 1 : 0;
}

static void make_timestamp(char *buf, size_t buf_size) {
    SYSTEMTIME st;
    GetLocalTime(&st);
    (void)snprintf(
        buf, buf_size, "%04u%02u%02u_%02u%02u%02u",
        st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond
    );
}

static int list_ntfs_drives(NtfsDriveInfo *out, int max_out) {
    char drives[1024];
    DWORD len = GetLogicalDriveStringsA((DWORD)sizeof(drives), drives);
    int count = 0;
    char *p = drives;

    if (len == 0 || len > sizeof(drives)) {
        return 0;
    }

    while (*p && count < max_out) {
        UINT drive_type = GetDriveTypeA(p);
        if (drive_type == DRIVE_FIXED || drive_type == DRIVE_REMOVABLE) {
            char fs_name[MAX_PATH] = {0};
            if (GetVolumeInformationA(p, NULL, 0, NULL, NULL, NULL, fs_name, (DWORD)sizeof(fs_name))) {
                if (_stricmp(fs_name, "NTFS") == 0) {
                    ULONGLONG free_bytes = 0, total_bytes = 0, total_free = 0;
                    if (GetDiskFreeSpaceExA(
                            p,
                            (PULARGE_INTEGER)&free_bytes,
                            (PULARGE_INTEGER)&total_bytes,
                            (PULARGE_INTEGER)&total_free)) {
                        strncpy(out[count].root, p, sizeof(out[count].root) - 1);
                        out[count].root[sizeof(out[count].root) - 1] = '\0';
                        out[count].letter = p[0];
                        out[count].total = total_bytes;
                        out[count].free_space = free_bytes;
                        count++;
                    }
                }
            }
        }
        p += strlen(p) + 1;
    }

    return count;
}

static void print_ntfs_drives(const NtfsDriveInfo *drives, int count) {
    int i;
    printf("{\"type\":\"drive_list\",\"count\":%d,\"drives\":[", count);
    for (i = 0; i < count; i++) {
        double total_gb = (double)drives[i].total / (1024.0 * 1024.0 * 1024.0);
        double free_gb = (double)drives[i].free_space / (1024.0 * 1024.0 * 1024.0);
        if (i > 0) printf(",");
        printf("{\"index\":%d,\"letter\":\"%c\",\"total_gb\":%.2f,\"free_gb\":%.2f}", 
               i + 1, drives[i].letter, total_gb, free_gb);
    }
    printf("]}\n");
}

static void print_help(const char *prog) {
    printf("{\"type\":\"help\",\"usage\":[\n");
    printf("\"  %s --help\",\n", prog);
    printf("\"  %s --list\",\n", prog);
    printf("\"  %s --extract [drive]\"\n", prog);
    printf("],\"flags\":{\n");
    printf("\"--help\":\"Show this help message.\",\n");
    printf("\"--list\":\"List NTFS partitions and exit.\",\n");
    printf("\"--extract [drive]\":\"Extract $MFT, $LogFile and $UsnJrnl:$J. drive can be index (1,2,3...) or letter (C, D:, E)\"\n");
    printf("},\"examples\":[\n");
    printf("\"  %s --list\",\n", prog);
    printf("\"  %s --extract E\",\n", prog);
    printf("\"  %s --extract 2\",\n", prog);
    printf("\"  %s --list --extract E\"\n", prog);
    printf("]}\n");
}

static int parse_extract_target(const char *arg, const NtfsDriveInfo *drives, int count, int *selected_index) {
    int i;

    if (!arg || !selected_index || count <= 0) {
        return 0;
    }

    if (isdigit((unsigned char)arg[0])) {
        char *endptr = NULL;
        long v = strtol(arg, &endptr, 10);
        if (*arg != '\0' && endptr && *endptr == '\0' && v >= 1 && v <= count) {
            *selected_index = (int)(v - 1);
            return 1;
        }
    }

    if (isalpha((unsigned char)arg[0])) {
        char letter = (char)toupper((unsigned char)arg[0]);
        for (i = 0; i < count; i++) {
            if (drives[i].letter == letter) {
                *selected_index = i;
                return 1;
            }
        }
    }

    return 0;
}

static int read_at_offset(HANDLE h, ULONGLONG offset, BYTE *buffer, DWORD size) {
    LARGE_INTEGER pos;
    DWORD total = 0;
    DWORD got = 0;

    pos.QuadPart = (LONGLONG)offset;
    if (!SetFilePointerEx(h, pos, NULL, FILE_BEGIN)) {
        return 0;
    }

    while (total < size) {
        if (!ReadFile(h, buffer + total, size - total, &got, NULL)) {
            return 0;
        }
        if (got == 0) {
            return 0;
        }
        total += got;
    }
    return 1;
}

static int write_all(HANDLE h, const BYTE *buffer, DWORD size) {
    DWORD total = 0;
    DWORD wrote = 0;

    while (total < size) {
        if (!WriteFile(h, buffer + total, size - total, &wrote, NULL)) {
            return 0;
        }
        if (wrote == 0) {
            return 0;
        }
        total += wrote;
    }
    return 1;
}

static int write_text_file(const char *path, const char *text) {
    HANDLE h;
    size_t len = strlen(text);
    h = CreateFileA(
        path,
        GENERIC_WRITE,
        0,
        NULL,
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        NULL
    );
    if (h == INVALID_HANDLE_VALUE) {
        return 0;
    }
    if (len > 0 && !write_all(h, (const BYTE *)text, (DWORD)len)) {
        CloseHandle(h);
        return 0;
    }
    CloseHandle(h);
    return 1;
}

static int copy_handle_to_file(HANDLE in_file, const char *output_path, ULONGLONG *out_bytes) {
    HANDLE out_file = INVALID_HANDLE_VALUE;
    BYTE *buf = NULL;
    ULONGLONG total_written = 0;
    int ok = 0;

    out_file = CreateFileA(
        output_path,
        GENERIC_WRITE,
        0,
        NULL,
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        NULL
    );
    if (out_file == INVALID_HANDLE_VALUE) {
        return 0;
    }

    buf = (BYTE *)malloc(COPY_BUFFER_SIZE);
    if (!buf) {
        goto cleanup;
    }

    for (;;) {
        DWORD got = 0;
        if (!ReadFile(in_file, buf, COPY_BUFFER_SIZE, &got, NULL)) {
            goto cleanup;
        }
        if (got == 0) {
            break;
        }
        if (!write_all(out_file, buf, got)) {
            goto cleanup;
        }
        total_written += got;
    }

    ok = 1;

cleanup:
    if (out_bytes) {
        *out_bytes = total_written;
    }
    free(buf);
    CloseHandle(out_file);
    if (!ok) {
        DeleteFileA(output_path);
    }
    return ok;
}

static int extract_usn_stream_via_path(
    char drive_letter,
    const char *output_path,
    ULONGLONG *out_bytes,
    DWORD *out_error
) {
    char path_normal[MAX_PATH];
    char path_extended[MAX_PATH];
    const char *candidates[2];
    int i;

    (void)snprintf(path_normal, sizeof(path_normal), "%c:\\$Extend\\$UsnJrnl:$J", drive_letter);
    (void)snprintf(path_extended, sizeof(path_extended), "\\\\?\\%c:\\$Extend\\$UsnJrnl:$J", drive_letter);
    candidates[0] = path_normal;
    candidates[1] = path_extended;

    if (out_error) {
        *out_error = 0;
    }

    for (i = 0; i < 2; i++) {
        HANDLE in_file = CreateFileA(
            candidates[i],
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            NULL,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_SEQUENTIAL_SCAN | FILE_FLAG_BACKUP_SEMANTICS,
            NULL
        );
        if (in_file == INVALID_HANDLE_VALUE) {
            if (out_error) {
                *out_error = GetLastError();
            }
            continue;
        }

        if (copy_handle_to_file(in_file, output_path, out_bytes)) {
            CloseHandle(in_file);
            return 1;
        }

        if (out_error) {
            *out_error = GetLastError();
        }
        CloseHandle(in_file);
    }

    return 0;
}

static int extract_usn_stream_via_fsctl(
    HANDLE volume,
    const USN_JOURNAL_DATA *journal_data,
    const char *output_path,
    ULONGLONG *out_bytes,
    DWORD *out_error
) {
    HANDLE out_file = INVALID_HANDLE_VALUE;
    BYTE *buf = NULL;
    DWORD bytes_ret = 0;
    ULONGLONG total_written = 0;
    int ok = 0;
    READ_USN_JOURNAL_DATA read_data;

    if (out_error) {
        *out_error = 0;
    }
    if (!volume || volume == INVALID_HANDLE_VALUE || !journal_data || !output_path) {
        if (out_error) {
            *out_error = ERROR_INVALID_PARAMETER;
        }
        SetLastError(ERROR_INVALID_PARAMETER);
        return 0;
    }

    out_file = CreateFileA(
        output_path,
        GENERIC_WRITE,
        0,
        NULL,
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        NULL
    );
    if (out_file == INVALID_HANDLE_VALUE) {
        if (out_error) {
            *out_error = GetLastError();
        }
        return 0;
    }

    buf = (BYTE *)malloc(COPY_BUFFER_SIZE);
    if (!buf) {
        if (out_error) {
            *out_error = ERROR_OUTOFMEMORY;
        }
        SetLastError(ERROR_OUTOFMEMORY);
        goto cleanup;
    }

    ZeroMemory(&read_data, sizeof(read_data));
    read_data.StartUsn = 0;
    read_data.ReasonMask = 0xFFFFFFFF;
    read_data.ReturnOnlyOnClose = 0;
    read_data.Timeout = 0;
    read_data.BytesToWaitFor = 0;
    read_data.UsnJournalID = journal_data->UsnJournalID;

    for (;;) {
        USN next_usn;
        DWORD payload;
        USN previous_start = read_data.StartUsn;

        if (!DeviceIoControl(
                volume,
                FSCTL_READ_USN_JOURNAL,
                &read_data,
                (DWORD)sizeof(read_data),
                buf,
                COPY_BUFFER_SIZE,
                &bytes_ret,
                NULL)) {
            DWORD err = GetLastError();
            if (out_error) {
                *out_error = err;
            }
            SetLastError(err);
            goto cleanup;
        }

        if (bytes_ret < (DWORD)sizeof(USN)) {
            if (out_error) {
                *out_error = ERROR_INVALID_DATA;
            }
            SetLastError(ERROR_INVALID_DATA);
            goto cleanup;
        }

        next_usn = *(USN *)buf;
        payload = bytes_ret - (DWORD)sizeof(USN);

        if (payload > 0) {
            if (!write_all(out_file, buf + sizeof(USN), payload)) {
                DWORD err = GetLastError();
                if (out_error) {
                    *out_error = err;
                }
                goto cleanup;
            }
            total_written += payload;
        }

        if (next_usn <= previous_start) {
            break;
        }

        read_data.StartUsn = next_usn;
        if (next_usn >= journal_data->NextUsn) {
            break;
        }
    }

    ok = 1;

cleanup:
    if (out_bytes) {
        *out_bytes = total_written;
    }
    free(buf);
    if (out_file != INVALID_HANDLE_VALUE) {
        CloseHandle(out_file);
    }
    if (!ok) {
        DeleteFileA(output_path);
    }
    return ok;
}

static int parse_boot_sector(const BYTE *boot, NtfsBootInfo *ntfs) {
    signed char clusters_per_mft_record;

    if (memcmp(boot + 3, "NTFS", 4) != 0) {
        return 0;
    }

    ntfs->bytes_per_sector = read_u16_le(boot + 0x0B);
    ntfs->sectors_per_cluster = boot[0x0D];
    ntfs->bytes_per_cluster = ntfs->bytes_per_sector * ntfs->sectors_per_cluster;
    ntfs->mft_cluster = read_u64_le(boot + 0x30);
    ntfs->mft_offset = ntfs->mft_cluster * ntfs->bytes_per_cluster;

    clusters_per_mft_record = (signed char)boot[0x40];
    if (clusters_per_mft_record < 0) {
        ntfs->mft_record_size = 1U << (-clusters_per_mft_record);
    } else {
        ntfs->mft_record_size = (DWORD)(clusters_per_mft_record * ntfs->bytes_per_cluster);
    }

    if (ntfs->bytes_per_sector == 0 || ntfs->bytes_per_cluster == 0 || ntfs->mft_record_size == 0) {
        return 0;
    }
    return 1;
}

static int apply_mft_fixup(BYTE *record, DWORD record_size, DWORD bytes_per_sector) {
    WORD usa_offset;
    WORD usa_count;
    WORD usn;
    WORD i;

    if (record_size < 8 || bytes_per_sector == 0) {
        return 0;
    }

    usa_offset = read_u16_le(record + 4);
    usa_count = read_u16_le(record + 6);

    if (usa_offset == 0 || usa_count < 2) {
        return 0;
    }
    if ((DWORD)usa_offset + ((DWORD)usa_count * 2) > record_size) {
        return 0;
    }

    usn = read_u16_le(record + usa_offset);

    for (i = 1; i < usa_count; i++) {
        DWORD sector_end = ((DWORD)i * bytes_per_sector);
        DWORD fixup_pos;
        if (sector_end < 2 || sector_end > record_size) {
            return 0;
        }
        fixup_pos = sector_end - 2;
        if (read_u16_le(record + fixup_pos) != usn) {
            return 0;
        }
        record[fixup_pos] = record[usa_offset + (i * 2)];
        record[fixup_pos + 1] = record[usa_offset + (i * 2) + 1];
    }
    return 1;
}

static int utf16le_equals_ascii_ci(const BYTE *utf16, size_t utf16_chars, const char *ascii) {
    size_t i;
    size_t ascii_len = strlen(ascii);
    if (ascii_len != utf16_chars) {
        return 0;
    }
    for (i = 0; i < ascii_len; i++) {
        unsigned char low = utf16[i * 2];
        unsigned char high = utf16[i * 2 + 1];
        if (high != 0) {
            return 0;
        }
        if (toupper(low) != toupper((unsigned char)ascii[i])) {
            return 0;
        }
    }
    return 1;
}

static int attr_name_matches_ascii(const BYTE *attr, DWORD attr_len, const char *target_name) {
    BYTE name_len;
    WORD name_off;

    if (!target_name) {
        return 1;
    }

    name_len = attr[9];
    name_off = read_u16_le(attr + 10);

    if (target_name[0] == '\0') {
        return name_len == 0;
    }
    if (name_len == 0) {
        return 0;
    }
    if ((DWORD)name_off + ((DWORD)name_len * 2) > attr_len) {
        return 0;
    }
    return utf16le_equals_ascii_ci(attr + name_off, name_len, target_name);
}

static int record_has_filename(const BYTE *record, DWORD record_size, const char *target_name) {
    WORD first_attr;
    DWORD off;

    if (memcmp(record, "FILE", 4) != 0) {
        return 0;
    }

    first_attr = read_u16_le(record + 0x14);
    off = first_attr;

    while (off + 16 <= record_size) {
        DWORD attr_type = read_u32_le(record + off);
        DWORD attr_len = read_u32_le(record + off + 4);
        BYTE non_resident = record[off + 8];

        if (attr_type == 0xFFFFFFFF) {
            break;
        }
        if (attr_len < 16 || off + attr_len > record_size) {
            break;
        }

        if (attr_type == 0x30 && non_resident == 0) {
            const BYTE *attr = record + off;
            DWORD value_len = read_u32_le(attr + 16);
            WORD value_off = read_u16_le(attr + 20);

            if ((DWORD)value_off + value_len <= attr_len && value_len >= 66) {
                const BYTE *value = attr + value_off;
                BYTE name_len = value[64];
                if ((DWORD)66 + ((DWORD)name_len * 2) <= value_len) {
                    if (utf16le_equals_ascii_ci(value + 66, name_len, target_name)) {
                        return 1;
                    }
                }
            }
        }

        off += attr_len;
    }

    return 0;
}

static int read_mft_record(HANDLE volume, const NtfsBootInfo *ntfs, ULONGLONG record_no, BYTE *record) {
    ULONGLONG offset = ntfs->mft_offset + (record_no * ntfs->mft_record_size);
    if (!read_at_offset(volume, offset, record, ntfs->mft_record_size)) {
        return 0;
    }
    if (memcmp(record, "FILE", 4) != 0) {
        return 0;
    }
    if (!apply_mft_fixup(record, ntfs->mft_record_size, ntfs->bytes_per_sector)) {
        return 0;
    }
    return 1;
}

static int find_mft_record_by_filename(
    HANDLE volume,
    const NtfsBootInfo *ntfs,
    const char *target_name,
    ULONGLONG max_records,
    ULONGLONG *out_record_no,
    BYTE *record_buffer
) {
    ULONGLONG i;
    for (i = 0; i < max_records; i++) {
        if (!read_mft_record(volume, ntfs, i, record_buffer)) {
            continue;
        }
        if ((read_u16_le(record_buffer + 0x16) & 0x0001) == 0) {
            continue;
        }
        if (record_has_filename(record_buffer, ntfs->mft_record_size, target_name)) {
            *out_record_no = i;
            return 1;
        }
    }
    return 0;
}

static int dump_nonresident_data_runs(
    HANDLE volume,
    const NtfsBootInfo *ntfs,
    const BYTE *attr,
    DWORD attr_len,
    HANDLE out_file,
    ULONGLONG *out_bytes
) {
    WORD run_off;
    ULONGLONG data_size;
    const BYTE *p;
    const BYTE *attr_end;
    LONGLONG current_lcn = 0;
    ULONGLONG remaining;
    BYTE *io_buf = NULL;
    BYTE *zero_buf = NULL;
    ULONGLONG total_written = 0;
    int ok = 0;

    if (attr_len < 64) {
        return 0;
    }

    run_off = read_u16_le(attr + 0x20);
    data_size = read_u64_le(attr + 0x30);
    if (run_off >= attr_len) {
        return 0;
    }

    p = attr + run_off;
    attr_end = attr + attr_len;
    remaining = data_size;

    io_buf = (BYTE *)malloc(COPY_BUFFER_SIZE);
    zero_buf = (BYTE *)calloc(1, COPY_BUFFER_SIZE);
    if (!io_buf || !zero_buf) {
        goto cleanup;
    }

    while (p < attr_end && *p != 0 && remaining > 0) {
        BYTE header = *p++;
        int len_size = header & 0x0F;
        int off_size = (header >> 4) & 0x0F;
        ULONGLONG cluster_count;
        LONGLONG lcn_delta = 0;
        ULONGLONG run_bytes;
        ULONGLONG to_copy;

        if (len_size == 0 || len_size > 8 || off_size > 8) {
            goto cleanup;
        }
        if ((size_t)(attr_end - p) < (size_t)(len_size + off_size)) {
            goto cleanup;
        }

        cluster_count = read_unsigned_le(p, len_size);
        p += len_size;
        if (off_size > 0) {
            lcn_delta = read_signed_le(p, off_size);
            p += off_size;
            current_lcn += lcn_delta;
            if (current_lcn < 0) {
                goto cleanup;
            }
        }

        run_bytes = cluster_count * ntfs->bytes_per_cluster;
        to_copy = (run_bytes < remaining) ? run_bytes : remaining;

        if (off_size == 0) {
            ULONGLONG done = 0;
            while (done < to_copy) {
                DWORD chunk = (DWORD)((to_copy - done) > COPY_BUFFER_SIZE ? COPY_BUFFER_SIZE : (to_copy - done));
                if (!write_all(out_file, zero_buf, chunk)) {
                    goto cleanup;
                }
                done += chunk;
                total_written += chunk;
            }
        } else {
            ULONGLONG disk_off = ((ULONGLONG)current_lcn) * ntfs->bytes_per_cluster;
            ULONGLONG done = 0;
            while (done < to_copy) {
                DWORD chunk = (DWORD)((to_copy - done) > COPY_BUFFER_SIZE ? COPY_BUFFER_SIZE : (to_copy - done));
                if (!read_at_offset(volume, disk_off + done, io_buf, chunk)) {
                    goto cleanup;
                }
                if (!write_all(out_file, io_buf, chunk)) {
                    goto cleanup;
                }
                done += chunk;
                total_written += chunk;
            }
        }

        remaining -= to_copy;
    }

    if (remaining != 0) {
        goto cleanup;
    }

    ok = 1;

cleanup:
    if (out_bytes) {
        *out_bytes = total_written;
    }
    free(io_buf);
    free(zero_buf);
    return ok;
}

static int extract_data_stream_from_record(
    HANDLE volume,
    const NtfsBootInfo *ntfs,
    const BYTE *record,
    const char *stream_name,
    const char *output_path,
    ULONGLONG *out_bytes
) {
    WORD first_attr;
    DWORD off;
    const BYTE *selected = NULL;
    DWORD selected_len = 0;
    ULONGLONG selected_start_vcn = ~0ULL;
    int selected_nonresident = 0;
    HANDLE out_file = INVALID_HANDLE_VALUE;
    int ok = 0;
    ULONGLONG written = 0;

    first_attr = read_u16_le(record + 0x14);
    off = first_attr;

    while (off + 16 <= ntfs->mft_record_size) {
        DWORD attr_type = read_u32_le(record + off);
        DWORD attr_len = read_u32_le(record + off + 4);
        const BYTE *attr = record + off;
        if (attr_type == 0xFFFFFFFF) {
            break;
        }
        if (attr_len < 16 || off + attr_len > ntfs->mft_record_size) {
            break;
        }
        if (attr_type == 0x80 && attr_name_matches_ascii(attr, attr_len, stream_name)) {
            int nonresident = (attr[8] != 0);
            ULONGLONG start_vcn = 0;
            if (nonresident) {
                if (attr_len < 0x20) {
                    off += attr_len;
                    continue;
                }
                start_vcn = read_u64_le(attr + 0x10);
            }

            if (!selected ||
                (nonresident && (!selected_nonresident || start_vcn < selected_start_vcn))) {
                selected = attr;
                selected_len = attr_len;
                selected_nonresident = nonresident;
                selected_start_vcn = start_vcn;
            }
        }
        off += attr_len;
    }

    if (!selected && stream_name && stream_name[0] != '\0') {
        off = first_attr;
        while (off + 16 <= ntfs->mft_record_size) {
            DWORD attr_type = read_u32_le(record + off);
            DWORD attr_len = read_u32_le(record + off + 4);
            const BYTE *attr = record + off;
            if (attr_type == 0xFFFFFFFF) {
                break;
            }
            if (attr_len < 16 || off + attr_len > ntfs->mft_record_size) {
                break;
            }
            if (attr_type == 0x80 && attr_name_matches_ascii(attr, attr_len, "")) {
                int nonresident = (attr[8] != 0);
                ULONGLONG start_vcn = 0;
                if (nonresident) {
                    if (attr_len < 0x20) {
                        off += attr_len;
                        continue;
                    }
                    start_vcn = read_u64_le(attr + 0x10);
                }

                if (!selected ||
                    (nonresident && (!selected_nonresident || start_vcn < selected_start_vcn))) {
                    selected = attr;
                    selected_len = attr_len;
                    selected_nonresident = nonresident;
                    selected_start_vcn = start_vcn;
                }
            }
            off += attr_len;
        }
    }

    if (!selected) {
        return 0;
    }

    out_file = CreateFileA(
        output_path,
        GENERIC_WRITE,
        0,
        NULL,
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        NULL
    );
    if (out_file == INVALID_HANDLE_VALUE) {
        return 0;
    }

    if (selected[8] == 0) {
        DWORD value_len = read_u32_le(selected + 16);
        WORD value_off = read_u16_le(selected + 20);
        if ((DWORD)value_off + value_len > selected_len) {
            goto cleanup;
        }
        if (!write_all(out_file, selected + value_off, value_len)) {
            goto cleanup;
        }
        written = value_len;
        ok = 1;
    } else {
        if (!dump_nonresident_data_runs(volume, ntfs, selected, selected_len, out_file, &written)) {
            goto cleanup;
        }
        ok = 1;
    }

cleanup:
    if (out_bytes) {
        *out_bytes = written;
    }
    CloseHandle(out_file);
    if (!ok) {
        DeleteFileA(output_path);
    }
    return ok;
}

int main(int argc, char **argv) {
    NtfsDriveInfo drives[MAX_NTFS_DRIVES];
    int count = 0;
    int selected = -1;
    int i;
    int mode_list = 0;
    int mode_extract = 0;
    const char *extract_target_arg = NULL;
    char timestamp[32];
    char output_root[MAX_PATH];
    char output_dir[MAX_PATH];
    char mft_out[MAX_PATH];
    char log_out[MAX_PATH];
    char usn_out[MAX_PATH];
    char usn_status_path[MAX_PATH];
    char vol_path[16];
    HANDLE volume = INVALID_HANDLE_VALUE;
    BYTE boot[512];
    NtfsBootInfo ntfs;
    BYTE *record_buf = NULL;
    DWORD bytes_ret = 0;
    ULONGLONG bytes = 0;
    ULONGLONG usn_record_no = 0;
    ULONGLONG mft_records_estimate = 0;
    ULONGLONG usn_scan_limit = USN_SEARCH_LIMIT;
    USN_JOURNAL_DATA usn_journal_data;
    int usn_journal_active = 0;
    DWORD usn_query_error = 0;
    char usn_status_msg[512];
    int ok_mft = 0;
    int ok_log = 0;
    int ok_usn = 0;

    for (i = 1; i < argc; i++) {
        if (_stricmp(argv[i], "--help") == 0 || _stricmp(argv[i], "-h") == 0) {
            print_help(argv[0]);
            return 0;
        } else if (_stricmp(argv[i], "--list") == 0) {
            mode_list = 1;
        } else if (_stricmp(argv[i], "--extract") == 0) {
            mode_extract = 1;
            if ((i + 1) < argc && argv[i + 1][0] != '-') {
                extract_target_arg = argv[i + 1];
                i++;
            }
        } else {
            printf("[!] Unknown argument: %s\n\n", argv[i]);
            print_help(argv[0]);
            return 1;
        }
    }

    if (!mode_list && !mode_extract) {
        mode_extract = 1;
    }

    (void)enable_privilege(SE_BACKUP_NAME);
    (void)enable_privilege(SE_RESTORE_NAME);

    count = list_ntfs_drives(drives, MAX_NTFS_DRIVES);
    if (count <= 0) {
        print_json_error("Failed to find any NTFS drives", 0);
        return 1;
    }

    if (mode_list || !extract_target_arg) {
        print_ntfs_drives(drives, count);
    }

    if (mode_list && !mode_extract) {
        return 0;
    }

    if (extract_target_arg) {
        if (!parse_extract_target(extract_target_arg, drives, count, &selected)) {
            print_json_error("Invalid extract target", 0);
            return 1;
        }
    } else {
        if (mode_list && !mode_extract) {
            return 0;
        }
        print_json_error("Drive selection required. Use --extract [drive]", 0);
        return 1;
    }

    snprintf(vol_path, sizeof(vol_path), "\\\\.\\%c:", drives[selected].letter);
    volume = CreateFileA(
        vol_path,
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        NULL,
        OPEN_EXISTING,
        0,
        NULL
    );
    if (volume == INVALID_HANDLE_VALUE) {
        print_win32_error("Failed to open selected volume", GetLastError());
        return 1;
    }

    (void)DeviceIoControl(volume, FSCTL_ALLOW_EXTENDED_DASD_IO, NULL, 0, NULL, 0, &bytes_ret, NULL);

    if (!read_at_offset(volume, 0, boot, sizeof(boot))) {
        print_win32_error("Failed to read NTFS boot sector", GetLastError());
        CloseHandle(volume);
        return 1;
    }
    if (!parse_boot_sector(boot, &ntfs)) {
        print_json_error("Selected volume is not a valid NTFS volume", 0);
        CloseHandle(volume);
        return 1;
    }

    printf("{\"type\":\"volume_info\",\"drive\":\"%c:\",\"bytes_per_sector\":%lu,\"bytes_per_cluster\":%lu,\"mft_offset\":%llu,\"mft_record_size\":%lu}\n",
           drives[selected].letter,
           (unsigned long)ntfs.bytes_per_sector,
           (unsigned long)ntfs.bytes_per_cluster,
           ntfs.mft_offset,
           (unsigned long)ntfs.mft_record_size);


    record_buf = (BYTE *)malloc(ntfs.mft_record_size);
    if (!record_buf) {
        printf("[!] Out of memory allocating MFT record buffer.\n");
        CloseHandle(volume);
        return 1;
    }

    make_timestamp(timestamp, sizeof(timestamp));
    snprintf(output_root, sizeof(output_root), "..\\exports");
    if (!mkdir_if_missing(output_root)) {
        printf("[!] Failed to create/access directory: %s\n", output_root);
        free(record_buf);
        CloseHandle(volume);
        return 1;
    }
    snprintf(output_dir, sizeof(output_dir), "%s\\%c_%s", output_root, drives[selected].letter, timestamp);
    if (!mkdir_if_missing(output_dir)) {
        printf("[!] Failed to create directory: %s\n", output_dir);
        free(record_buf);
        CloseHandle(volume);
        return 1;
    }

    snprintf(mft_out, sizeof(mft_out), "%s\\MFT_%c.bin", output_dir, drives[selected].letter);
    snprintf(log_out, sizeof(log_out), "%s\\LogFile_%c.bin", output_dir, drives[selected].letter);
    snprintf(usn_out, sizeof(usn_out), "%s\\UsnJrnl_J_%c.bin", output_dir, drives[selected].letter);
    snprintf(usn_status_path, sizeof(usn_status_path), "%s\\UsnJrnl_status_%c.txt", output_dir, drives[selected].letter);

    if (read_mft_record(volume, &ntfs, 0, record_buf) &&
        extract_data_stream_from_record(volume, &ntfs, record_buf, "", mft_out, &bytes)) {
        printf("{\"type\":\"extraction_complete\",\"artifact\":\"$MFT\",\"bytes\":%llu,\"path\":\"%s\",\"status\":\"success\"}\n", bytes, mft_out);
        if (ntfs.mft_record_size != 0) {
            mft_records_estimate = bytes / ntfs.mft_record_size;
        }
        ok_mft = 1;
    } else {
        print_win32_error("Failed to extract $MFT", GetLastError());
    }

    if (read_mft_record(volume, &ntfs, 2, record_buf) &&
        extract_data_stream_from_record(volume, &ntfs, record_buf, "", log_out, &bytes)) {
        printf("{\"type\":\"extraction_complete\",\"artifact\":\"$LogFile\",\"bytes\":%llu,\"path\":\"%s\",\"status\":\"success\"}\n", bytes, log_out);
        ok_log = 1;
    } else {
        print_win32_error("Failed to extract $LogFile", GetLastError());
    }

    ZeroMemory(&usn_journal_data, sizeof(usn_journal_data));
    if (DeviceIoControl(
            volume,
            FSCTL_QUERY_USN_JOURNAL,
            NULL,
            0,
            &usn_journal_data,
            sizeof(usn_journal_data),
            &bytes_ret,
            NULL)) {
        usn_journal_active = 1;
        printf("{\"type\":\"usn_journal_status\",\"drive\":\"%c:\",\"active\":true,\"journal_id\":%llu,\"next_usn\":%llu}\n",
               drives[selected].letter,
               usn_journal_data.UsnJournalID,
               usn_journal_data.NextUsn);
    } else {
        usn_query_error = GetLastError();
        if (usn_query_error == ERROR_JOURNAL_NOT_ACTIVE) {
            printf("{\"type\":\"usn_journal_status\",\"drive\":\"%c:\",\"active\":false,\"reason\":\"Journal not active\"}\n", drives[selected].letter);
        } else {
            print_win32_error("Could not query USN Journal state", usn_query_error);
        }
    }

    if (usn_journal_active) {
        DWORD usn_raw_extract_error = 0;
        DWORD usn_path_extract_error = 0;
        DWORD usn_fsctl_extract_error = 0;
        if (mft_records_estimate > 0) {
            usn_scan_limit = mft_records_estimate;
            if (usn_scan_limit < 1024ULL) {
                usn_scan_limit = 1024ULL;
            }
        }

        if (find_mft_record_by_filename(volume, &ntfs, "$UsnJrnl", usn_scan_limit, &usn_record_no, record_buf)) {
            if (extract_data_stream_from_record(volume, &ntfs, record_buf, "$J", usn_out, &bytes)) {
                printf("{\"type\":\"extraction_complete\",\"artifact\":\"$UsnJrnl:$J\",\"bytes\":%llu,\"path\":\"%s\",\"status\":\"success\"}\n", bytes, usn_out);
                ok_usn = 1;
                (void)snprintf(
                    usn_status_msg,
                    sizeof(usn_status_msg),
                    "{\"type\":\"usn_extraction\",\"status\":\"success\",\"bytes\":%llu,\"path\":\"%s\"}",
                    bytes,
                    usn_out
                );
            } else {
                usn_raw_extract_error = GetLastError();
                if (usn_raw_extract_error == ERROR_SUCCESS) {
                    usn_raw_extract_error = ERROR_INVALID_DATA;
                }
                print_win32_error("Found $UsnJrnl record but failed to extract stream", usn_raw_extract_error);

                if (extract_usn_stream_via_path(drives[selected].letter, usn_out, &bytes, &usn_path_extract_error)) {
                    printf("{\"type\":\"extraction_complete\",\"artifact\":\"$UsnJrnl:$J\",\"bytes\":%llu,\"path\":\"%s\",\"status\":\"success\",\"method\":\"filesystem_stream\"}\n", bytes, usn_out);
                    ok_usn = 1;
                    (void)snprintf(
                        usn_status_msg,
                        sizeof(usn_status_msg),
                        "{\"type\":\"usn_extraction\",\"status\":\"success\",\"method\":\"filesystem_stream\",\"bytes\":%llu,\"path\":\"%s\"}",
                        bytes,
                        usn_out
                    );
                } else {
                    if (usn_path_extract_error != 0) {
                        print_win32_error("Fallback extraction of $UsnJrnl:$J via filesystem path failed", usn_path_extract_error);
                    }

                    if (extract_usn_stream_via_fsctl(volume, &usn_journal_data, usn_out, &bytes, &usn_fsctl_extract_error)) {
                        printf("{\"type\":\"extraction_complete\",\"artifact\":\"$UsnJrnl:$J\",\"bytes\":%llu,\"path\":\"%s\",\"status\":\"success\",\"method\":\"fsctl_read_usn_journal\"}\n", bytes, usn_out);
                        ok_usn = 1;
                        (void)snprintf(
                            usn_status_msg,
                            sizeof(usn_status_msg),
                            "{\"type\":\"usn_extraction\",\"status\":\"success\",\"method\":\"fsctl_read_usn_journal\",\"bytes\":%llu,\"path\":\"%s\"}",
                            bytes,
                            usn_out
                        );
                    } else {
                        if (usn_fsctl_extract_error != 0) {
                            print_win32_error("Fallback extraction of $UsnJrnl via FSCTL_READ_USN_JOURNAL failed", usn_fsctl_extract_error);
                        }
                        (void)snprintf(
                            usn_status_msg,
                            sizeof(usn_status_msg),
                            "{\"type\":\"usn_extraction\",\"status\":\"failed\",\"reason\":\"Stream extraction failed\",\"raw_error_code\":%lu,\"fallback_error_code\":%lu,\"fsctl_error_code\":%lu}",
                            (unsigned long)usn_raw_extract_error,
                            (unsigned long)usn_path_extract_error,
                            (unsigned long)usn_fsctl_extract_error
                        );
                    }
                }
            }
        } else {
            (void)snprintf(
                usn_status_msg,
                sizeof(usn_status_msg),
                "{\"type\":\"usn_extraction\",\"status\":\"failed\",\"reason\":\"Record not found\",\"scanned_records\":%llu}",
                usn_scan_limit
            );
        }
    } else {
        (void)snprintf(
            usn_status_msg,
            sizeof(usn_status_msg),
            "{\"type\":\"usn_extraction\",\"status\":\"skipped\",\"reason\":\"Journal not active\"}"
        );
    }

    if (usn_status_msg[0] != '\0') {
        if (write_text_file(usn_status_path, usn_status_msg)) {
            /* Status written silently */
        } else {
            print_win32_error("Failed to write USN status file", GetLastError());
        }
    }

    printf("{\"type\":\"extraction_summary\",\"drive\":\"%c:\",\"output_dir\":\"%s\",\"results\":{\"mft\":\"%s\",\"logfile\":\"%s\",\"usn_journal\":\"%s\"}}\n",
           drives[selected].letter,
           output_dir,
           ok_mft ? "SUCCESS" : "FAILED",
           ok_log ? "SUCCESS" : "FAILED",
           ok_usn ? "SUCCESS" : "FAILED");

    free(record_buf);
    CloseHandle(volume);
    return (ok_mft && ok_log && ok_usn) ? 0 : 2;
}
