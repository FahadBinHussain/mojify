from dotenv import load_dotenv
import os
import json
import subprocess  # To execute C++ program
import time
from pynput import keyboard

# Load environment variables
load_dotenv()

# Resolve relative paths to absolute paths
def get_absolute_path(relative_path):
    """
    Convert a relative path to an absolute path.
    """
    base_path = os.path.dirname(os.path.abspath(__file__))  # Base path is the script's directory
    return os.path.abspath(os.path.join(base_path, relative_path))

# Path to the C++ executable and mapping file
CPP_EXECUTABLE_PATH = get_absolute_path(os.getenv("CPP_EXECUTABLE_PATH", "copy_to_clipboard.exe"))
MAPPING_FILE = get_absolute_path(os.getenv("MAPPING_FILE", "emote_mapping.json"))

# Load mapping
emote_mapping = {}
if os.path.exists(MAPPING_FILE):
    with open(MAPPING_FILE, "r", encoding="utf-8") as f:
        emote_mapping = json.load(f)

# Update mapping paths to absolute
for trigger, relative_path in emote_mapping.items():
    emote_mapping[trigger] = get_absolute_path(relative_path)

# Create a lowercase mapping for case-insensitive matching
lowercase_mapping = {key.lower(): key for key in emote_mapping}
trigger_buffer_size = max(len(trigger) for trigger in emote_mapping) + 10 if emote_mapping else 20  # Allow extra room for corrections

# Buffer to hold typed characters
typed_text = []

def copy_file_with_cpp(emote_path):
    """
    Use the C++ program to copy the file to the clipboard.
    """
    try:
        result = subprocess.run([CPP_EXECUTABLE_PATH, emote_path], check=True, capture_output=True, text=True)
        print(result.stdout)
    except subprocess.CalledProcessError as e:
        print(f"Error copying file: {e.stderr}")

def replace_trigger_with_emote(trigger):
    """
    Replace the detected trigger with the corresponding emote.
    """
    original_trigger = lowercase_mapping[trigger.lower()]  # Get the original case-sensitive trigger
    emote_path = emote_mapping.get(original_trigger)
    
    if emote_path:
        print(f"Trigger '{original_trigger}' detected. Replacing with emote: {emote_path}")
        
        # Call the C++ program to copy the file to the clipboard
        copy_file_with_cpp(emote_path)

        # Simulate backspaces to clear the trigger word
        from pynput.keyboard import Controller
        keyboard_controller = Controller()

        for _ in range(len(original_trigger)):
            keyboard_controller.press(keyboard.Key.backspace)
            keyboard_controller.release(keyboard.Key.backspace)
            time.sleep(0.01)  # Adjust a slight delay for key simulation (optional)

        # Adjust a slight delay before the paste operation (optional)
        time.sleep(0.01)

        # Simulate paste (Ctrl+V)
        keyboard_controller.press(keyboard.Key.ctrl)
        keyboard_controller.press('v')
        keyboard_controller.release('v')
        keyboard_controller.release(keyboard.Key.ctrl)
    else:
        print(f"Trigger '{trigger}' not found in mapping.")

def check_triggers_in_buffer():
    """
    Check the buffer for any matching triggers.
    """
    global typed_text
    buffer_text = ''.join(typed_text).lower()  # Convert buffer to lowercase for matching
    for trigger in lowercase_mapping:
        if buffer_text.endswith(trigger):  # Match at the end of the buffer
            replace_trigger_with_emote(trigger)
            typed_text = []  # Reset buffer after replacement
            break

def on_press(key):
    """
    Handle keypress events.
    """
    global typed_text

    try:
        char = key.char  # Get the character typed
        if char:
            typed_text.append(char)
            if len(typed_text) > trigger_buffer_size:
                typed_text.pop(0)  # Maintain buffer size

            # Re-check triggers after every key press
            check_triggers_in_buffer()
    except AttributeError:
        # Handle special keys
        if key == keyboard.Key.backspace and typed_text:
            typed_text.pop()
            # Re-check triggers after backspace corrections
            check_triggers_in_buffer()

def on_release(key):
    """
    Handle key release events (optional).
    """
    if key == keyboard.Key.esc:
        # Stop listener on Esc key
        return False

def listen_for_triggers():
    """
    Start the trigger listener.
    """
    print("Listening for triggers...")
    with keyboard.Listener(on_press=on_press, on_release=on_release) as listener:
        listener.join()
        