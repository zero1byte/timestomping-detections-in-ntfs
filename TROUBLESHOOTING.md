# NTFS MFT Extraction - Troubleshooting Guide

## Issue: "Error 5 - Cannot open drive"

**Error Message:**
```
{"detail":"Cannot open drive C:. Run as Administrator. (Error: 5)"}
```

**Error Code 5 = `ERROR_ACCESS_DENIED`**

This means the process doesn't have sufficient permissions to access the raw disk.

---

## Why Standalone Scripts Work But API Doesn't

**Standalone Script (`extract_mft.py`):**
- Runs as a regular Python process
- When started from an admin terminal, inherits admin privileges directly
- ✅ Works because the entire process has admin rights

**FastAPI Server (via uvicorn):**
- Runs as a web server
- May spawn subprocesses that don't inherit admin privileges properly
- ❌ Fails because the server process may not have the needed rights

---

## Solutions

### Solution 1: Run Server with Admin Batch File (Recommended)

**Windows Command Prompt:**
1. Right-click **Command Prompt**
2. Select **"Run as administrator"**
3. Navigate to your project:
   ```cmd
   cd C:\Users\Ramesh\WebProject\timestomping-detections-in-ntfs
   ```
4. Run the admin launcher:
   ```cmd
   run_server_admin.bat
   ```

### Solution 2: Run Server with Admin PowerShell Script

**Windows PowerShell:**
1. Right-click **PowerShell**
2. Select **"Run as administrator"**
3. Navigate to your project:
   ```powershell
   cd C:\Users\Ramesh\WebProject\timestomping-detections-in-ntfs
   ```
4. Run the admin launcher:
   ```powershell
   .\run_server_admin.ps1
   ```

### Solution 3: Manual Admin Terminal

**Command Prompt (Admin):**
```cmd
cd C:\Users\Ramesh\WebProject\timestomping-detections-in-ntfs\backend
python -m uvicorn main:app --host 127.0.0.1 --port 5000
```

**PowerShell (Admin):**
```powershell
cd C:\Users\Ramesh\WebProject\timestomping-detections-in-ntfs\backend
python -m uvicorn main:app --host 127.0.0.1 --port 5000
```

---

## Verification Steps

### 1. Verify Admin Privileges

**Command Prompt:**
```cmd
net session
```
- If it works without error → Running as admin ✅
- If "Access Denied" → Not admin ❌

**PowerShell:**
```powershell
[bool]([System.Security.Principal.WindowsIdentity]::GetCurrent().groups -match "S-1-5-32-544")
```
- If `True` → Running as admin ✅
- If `False` → Not admin ❌

### 2. Test Admin Status via API

Once server is running:
```bash
curl http://localhost:5000/disk/test-admin
```

**Success Response:**
```json
{
  "admin_privileges": true,
  "drive_access_test": "Success"
}
```

**Failure Response:**
```json
{
  "admin_privileges": false,
  "drive_access_test": "Failed with error code: 5"
}
```

### 3. Extract MFT via API

```bash
curl -X POST http://localhost:5000/disk/extract \
  -H "Content-Type: application/json" \
  -d '{"drive": "C"}'
```

---

## Testing the API

### Using cURL (Command Prompt)

```cmd
REM Test if server is running
curl http://localhost:5000/health

REM Check admin privileges
curl http://localhost:5000/disk/test-admin

REM Extract $MFT
curl -X POST http://localhost:5000/disk/extract ^
  -H "Content-Type: application/json" ^
  -d "{\"drive\": \"C\"}"
```

### Using Python Script

```bash
python test_api.py
```

### Using Postman

1. **Create a new POST request:**
   - URL: `http://localhost:5000/extract/extract-mft`
   - Body (raw JSON):
     ```json
     {
       "drive": "C"
     }
     ```
   - Click **Send**

---

## What Was Fixed

### Issue in `getMFT.py`
**Before:**
```python
drive_path = f"\\\\.\\{drive_letter}:"
drive_path = f"C:"  # ❌ HARDCODED! Overrides the parameter
handle = ctypes.windll.kernel32.CreateFileW(
    drive_path,
    0x80000000 | 0x40000000,  # ❌ Wrong flags
    ...
)
```

**After:**
```python
drive_path = f"\\\\.\\{drive_letter}:"  # ✅ Uses actual drive parameter
flags = 0x00000080 | 0x02000000  # ✅ Better flags: BACKUP_SEMANTICS
handle = ctypes.windll.kernel32.CreateFileW(
    drive_path,
    0x80000000,  # ✅ Correct GENERIC_READ
    0x01 | 0x02,  # ✅ FILE_SHARE_READ | FILE_SHARE_WRITE
    None,
    3,
    flags,  # ✅ Proper flags for backup/forensic access
    None
)
```

### Key Changes:
1. **Removed hardcoded drive path** - Now uses the actual drive parameter
2. **Added FILE_FLAG_BACKUP_SEMANTICS** - Better for raw disk access
3. **Fixed flags** - Proper Windows API flags for forensic analysis

---

## API Endpoints After Fix

### New Extract Routes

**Extract $MFT:**
```
POST /extract/extract-mft
Body: {"drive": "C"}
```

**Extract $LogFile:**
```
POST /extract/extract-logfile
Body: {"drive": "C"}
```

**Extract $UsnJrnl:**
```
POST /extract/extract-usnjrnl
Body: {"drive": "C"}
```

**Extract All:**
```
POST /extract/extract-all
Body: {"drive": "C"}
```

**View Status:**
```
GET /extract/status
```

**List Drives:**
```
GET /extract/drives
```

---

## Comparison: Standalone vs API

| Feature | Standalone Script | API |
|---------|------------------|-----|
| **How to Run** | `python extract_mft.py C` | `curl -X POST http://localhost:5000/...` |
| **Admin Required** | ✅ Yes (direct process) | ✅ Yes (server process) |
| **Output Files** | `mft_exports/` | `exports/$MFT/C/` |
| **Works with different drives** | ✅ Yes | ✅ Yes |
| **Callable from other programs** | ❌ No | ✅ Yes (HTTP API) |
| **Progress display** | ✅ Yes (console) | ✅ Yes (response) |

---

## Complete Workflow

### Step 1: Start Server as Admin
```powershell
# PowerShell (as Administrator)
cd C:\Users\Ramesh\WebProject\timestomping-detections-in-ntfs
.\run_server_admin.ps1
```

### Step 2: Verify it's Running
```bash
curl http://localhost:5000/health
# Response: {"status":"healthy"}
```

### Step 3: Check Admin Status
```bash
curl http://localhost:5000/disk/test-admin
# Response: {"admin_privileges":true,"drive_access_test":"Success"}
```

### Step 4: Extract MFT
```bash
curl -X POST http://localhost:5000/extract/extract-all \
  -H "Content-Type: application/json" \
  -d '{"drive": "C"}'
```

### Step 5: Check Results
```bash
curl http://localhost:5000/extract/status
```

---

## If Still Getting Error 5

1. **Verify you're running as admin:**
   ```powershell
   [bool]([System.Security.Principal.WindowsIdentity]::GetCurrent().groups -match "S-1-5-32-544")
   ```

2. **Check Windows Event Viewer for Access Denied errors:**
   - Windows Logs > Security > Look for failure audits

3. **Disable antivirus temporarily** (if using 3rd-party antivirus):
   - Some antivirus software blocks raw disk access

4. **Try a different drive** (if C: is locked):
   ```bash
   curl -X POST http://localhost:5000/extract/extract-all \
     -H "Content-Type: application/json" \
     -d '{"drive": "D"}'
   ```

5. **Restart the server** after each change

---

## References

- **Windows Error Codes:** https://docs.microsoft.com/en-us/windows/win32/debug/system-error-codes
- **CreateFileW API:** https://docs.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew
- **Raw Disk Access:** https://docs.microsoft.com/en-us/windows/win32/fileio/opening-a-disk-or-partition

