Install required packages
    py -m pip install -r requirements.txt

Run python server with Admin privilages
    py -m uvicorn main:app --reload --port 3000

To run server at localhost :
    cd backend
    uvicorn main:app --reload --port 3000

For windows we need:
    Visual Studio Build Tools for C++   

gcc low-level-c/extract_mft.c -o low-level-c/extract_mft.exe -ladvapi32