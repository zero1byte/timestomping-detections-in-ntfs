# Timestomping Detection in NTFS

A forensic analysis tool that detects timestamp manipulation (timestomping) in NTFS file systems by correlating timestamps across multiple NTFS artifacts — **$MFT ($SI vs $FN)**, **$UsnJrnl**, and **$LogFile**.

## How It Works

Timestomping is an anti-forensic technique where attackers alter file timestamps to blend malicious files with legitimate ones. This tool extracts raw NTFS metadata and cross-references:

| Artifact | Purpose |
|---|---|
| **$MFT — $STANDARD_INFORMATION** | Core file timestamps (easily modified by attackers) |
| **$MFT — $FILE_NAME** | Kernel-managed timestamps (cannot be modified from user-mode) |
| **$UsnJrnl** | Change journal recording every file system operation |
| **$LogFile** | NTFS transaction log capturing low-level metadata operations |

Discrepancies between `$SI` and `$FN` timestamps, combined with USN and LogFile analysis, flag potential tampering.

## Project Structure

```
├── app/                    # React + Vite frontend
│   └── src/routes/
│       ├── home.jsx        # Landing page with project overview
│       ├── partitions.jsx  # NTFS drive/partition selector
│       ├── analyze.jsx     # Live artifact extraction with progress
│       └── results.jsx     # Timestomping detection results table
├── backend/                # FastAPI backend
│   ├── main.py             # App entry point, CORS, static mounts
│   └── routes/
│       ├── drives.py       # GET /drives — list NTFS partitions
│       ├── extract_ntfs.py # POST /extract/* — extract MFT, LogFile, UsnJrnl
│       ├── analyze.py      # POST /analyze/* — analysis endpoints
│       ├── mft_to_csv.py   # MFT → CSV with timestomping detection columns
│       └── analysis/
│           ├── convert/    # CSV conversion endpoints
│           └── files/      # Export listing endpoints
├── exports/                # Extracted artifact binaries & CSVs
├── low-level-c/            # C-based MFT extraction utility
└── requirements.txt
```

## Prerequisites

- **Python 3.10+**
- **Node.js 18+**
- **Windows** (NTFS access requires admin privileges)
- **Visual Studio Build Tools for C++** (for low-level extraction module)

## Installation

### Backend

```bash
cd backend
pip install -r ../requirements.txt
```

### Frontend

```bash
cd app
npm install
```

### Low-Level C Utility (optional)

```bash
gcc low-level-c/extract_mft.c -o low-level-c/extract_mft.exe -ladvapi32
```

## Running

### Backend (requires Administrator)

Option A — use the batch file:

```bash
run_server_admin.bat
```

Option B — manual:

```bash
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 3000 --reload
or
uvicorn main:app --host 127.0.0.1 --port 3000 --reload
```

> The backend must run as **Administrator** to read raw NTFS volumes.

### Frontend

```bash
cd app
npm run dev
```

Opens at [http://localhost:5173](http://localhost:5173). The frontend connects to the backend API at `http://127.0.0.1:5000`.

## Usage

1. **Select Partition** — pick an NTFS drive from the detected partitions
2. **Extract Artifacts** — the tool sequentially extracts `$MFT`, `$LogFile`, and `$UsnJrnl` from the live volume
3. **Download / Review** — exported files are saved to `exports/` and available for download
4. **Analyze** — compare `$SI` vs `$FN` timestamps to detect anomalies; results are classified as High / Medium / Low severity

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/drives` | List available NTFS partitions |
| `POST` | `/extract/extract-mft` | Extract $MFT from a drive |
| `POST` | `/extract/extract-logfile` | Extract $LogFile from a drive |
| `POST` | `/extract/extract-usnjrnl` | Extract $UsnJrnl from a drive |
| `POST` | `/extract/extract-all` | Extract all three artifacts |
| `POST` | `/analysis/mft/convert` | Convert MFT binary to CSV |
| `GET` | `/analysis/exports` | List exported files |
| `GET` | `/health` | Server health check |

## Tech Stack

- **Frontend:** React 19, React Router, Tailwind CSS, Vite
- **Backend:** FastAPI, Uvicorn, psutil
- **Analysis:** Python struct-based MFT parsing, NTFS raw volume I/O