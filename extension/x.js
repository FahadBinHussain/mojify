// background.js

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Check if the message is for the 'paste' action
    if (request.action === "paste") {
        const tabId = sender.tab.id;
        if (!tabId) {
            console.error("Paste action failed: Could not get sender tab ID.");
            sendResponse({ success: false, error: "No tab ID" });
            return;
        }

        const debuggee = { tabId: tabId };
        const protocolVersion = "1.3";

        // Attach the debugger to the tab
        chrome.debugger.attach(debuggee, protocolVersion, () => {
            if (chrome.runtime.lastError) {
                console.error(`Debugger attach error: ${chrome.runtime.lastError.message}`);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                return;
            }

            // This function sends a single key event and returns a promise
            const sendKeyEvent = (type) => {
                return new Promise(resolve => {
                    chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", type, resolve);
                });
            };

            // This async function sequences the key presses to simulate Ctrl+V
            const performPaste = async () => {
                try {
                    // Modifiers: 2 = Control key pressed
                    await sendKeyEvent({ type: 'keyDown', modifiers: 2, windowsVirtualKeyCode: 17, key: 'Control' });
                    await sendKeyEvent({ type: 'keyDown', modifiers: 2, windowsVirtualKeyCode: 86, text: 'v' });
                    await sendKeyEvent({ type: 'keyUp', modifiers: 2, windowsVirtualKeyCode: 86, text: 'v' });
                    await sendKeyEvent({ type: 'keyUp', windowsVirtualKeyCode: 17, key: 'Control' });

                    // Detach the debugger after the action is complete
                    chrome.debugger.detach(debuggee, () => {
                        sendResponse({ success: true });
                    });
                } catch (e) {
                    console.error("Error during key event dispatch:", e);
                    // Ensure we always try to detach
                    chrome.debugger.detach(debuggee, () => {
                        sendResponse({ success: false, error: "Key dispatch failed" });
                    });
                }
            };

            performPaste();
        });

        // Return true to indicate you're sending the response asynchronously
        return true;
    }
}); 