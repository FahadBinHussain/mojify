import subprocess
import sys
from trigger_listener import listen_for_triggers
from emote_downloader import download_emotes_main

def main():
    if len(sys.argv) > 1 and sys.argv[1] == '-download':
        download_emotes_main()
    else:
        subprocess.run(["./copy_to_clipboard"])  # use "idk what" if onefile build, use "_internal/copy_to_clipboard" if one directory build
        listen_for_triggers()

if __name__ == "__main__":
    main()
