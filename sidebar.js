// Call from the click handler so opening the side panel retains the user gesture.
globalThis.openHighlightextSidebar = () => chrome.windows.getCurrent().then(window => chrome.sidePanel.open({ windowId: window.id }));
