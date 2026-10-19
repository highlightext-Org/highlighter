// Firefox requires this call directly from the user gesture, before any await.
globalThis.openHighlightextSidebar = () => browser.sidebarAction.open();
