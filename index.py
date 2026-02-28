from dfvfs.helpers import volume_scanner
from dfvfs.resolver import resolver
from dfvfs.lib import definitions

SOURCE = r'\\.\C:'   # LIVE NTFS partition

scanner = volume_scanner.VolumeScanner()

print("[+] Scanning volume...")

base_path_specs = scanner.GetBasePathSpecs(
    SOURCE,
    scan_context=None)

for path_spec in base_path_specs:

    file_entry = resolver.Resolver.OpenFileEntryByPathSpec(
        path_spec,
        location='/$MFT')

    if file_entry:
        print("[+] $MFT found")

        file_object = file_entry.GetFileObject()

        with open("MFT_dump.bin", "wb") as f:
            data = file_object.read()
            f.write(data)

        print("[+] $MFT extracted successfully")
        break