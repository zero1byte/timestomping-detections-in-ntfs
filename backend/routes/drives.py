from fastapi import APIRouter
import psutil

router = APIRouter()


@router.get("/")
def get_drives():
    """Get list of available NTFS drives on the system"""
    drives = []
    for partition in psutil.disk_partitions():
        if "ntfs" in partition.fstype.lower():
            try:
                usage = psutil.disk_usage(partition.mountpoint)
                drives.append({
                    "drive": partition.device,
                    "mountpoint": partition.mountpoint,
                    "fstype": partition.fstype,
                    "total_gb": round(usage.total / (1024**3), 2),
                    "free_gb": round(usage.free / (1024**3), 2)
                })
            except PermissionError:
                drives.append({
                    "drive": partition.device,
                    "mountpoint": partition.mountpoint,
                    "fstype": partition.fstype,
                    "total_gb": None,
                    "free_gb": None
                })
    return {"drives": drives}
