#include <windows.h>
#include <shlobj.h>  // For CF_HDROP
#include <string>
#include <iostream>


void CopyFileToClipboard(const std::wstring& filePath) {
    // Ensure the file exists
    if (GetFileAttributesW(filePath.c_str()) == INVALID_FILE_ATTRIBUTES) {
        std::wcerr << L"File does not exist: " << filePath << std::endl;
        return;
    }

    // Prepare the DROPFILES structure
    DROPFILES dropFiles = {0};
    dropFiles.pFiles = sizeof(DROPFILES); // Offset to file list
    dropFiles.fWide = TRUE;              // Unicode file paths

    // Calculate memory size for DROPFILES + file path (null-terminated) + extra null for double-null
    size_t filePathSize = (filePath.length() + 1) * sizeof(wchar_t); // Path with null terminator
    size_t globalSize = sizeof(DROPFILES) + filePathSize + sizeof(wchar_t); // DROPFILES + path + double null

    // Allocate global memory for the DROPFILES structure and file path
    HGLOBAL hGlobal = GlobalAlloc(GHND, globalSize);
    if (!hGlobal) {
        std::cerr << "GlobalAlloc failed." << std::endl;
        return;
    }

    // Lock the memory and populate it with DROPFILES and file path
    void* pGlobal = GlobalLock(hGlobal);
    if (!pGlobal) {
        std::cerr << "GlobalLock failed." << std::endl;
        GlobalFree(hGlobal);
        return;
    }

    // Copy DROPFILES structure
    memcpy(pGlobal, &dropFiles, sizeof(DROPFILES));

    // Copy the file path (null-terminated)
    memcpy(static_cast<BYTE*>(pGlobal) + sizeof(DROPFILES), filePath.c_str(), filePathSize);

    // Add double-null termination
    memset(static_cast<BYTE*>(pGlobal) + sizeof(DROPFILES) + filePathSize, 0, sizeof(wchar_t));

    // Unlock the global memory
    GlobalUnlock(hGlobal);

    // Open the clipboard
    if (!OpenClipboard(nullptr)) {
        std::cerr << "Failed to open clipboard." << std::endl;
        GlobalFree(hGlobal);
        return;
    }

    // Clear the clipboard and set CF_HDROP data
    EmptyClipboard();
    if (!SetClipboardData(CF_HDROP, hGlobal)) {
        std::cerr << "SetClipboardData failed." << std::endl;
        GlobalFree(hGlobal);
    } else {
        std::cout << "File copied to clipboard successfully!" << std::endl;
    }

    // Close the clipboard
    CloseClipboard();
}

int main(int argc, char* argv[]) {
    if (argc != 2) {
        std::cerr << "Usage: " << argv[0] << " <file_path>" << std::endl;
        return 1;
    }

    std::wstring filePath = std::wstring(argv[1], argv[1] + strlen(argv[1]));
    CopyFileToClipboard(filePath);
    return 0;
}
