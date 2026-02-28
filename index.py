from dfvfs.helpers import volume_scanner
from dfvfs.resolver import resolver

source = "disk.dd"

scanner = volume_scanner.VolumeScanner()
base_path_specs = scanner.GetBasePathSpecs(source)

for path_spec in base_path_specs:
    file_entry = resolver.Resolver.OpenFileEntryByPathSpec(
        path_spec, location="/$MFT")

    if file_entry:
        data = file_entry.GetFileObject().read()
        print("MFT size:", len(data))