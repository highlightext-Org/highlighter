// Chrome service workers cannot create Web Workers; an offscreen document hosts them.
(function (root) {
  let creating;
  root.runMatchJob = async job => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] });
    if (!contexts.length) {
      if (!creating) creating = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['WORKERS'], justification: 'Run keyword and regex matching in a worker with execution time limits.' }).finally(() => { creating = null; });
      await creating;
    }
    const result = await chrome.runtime.sendMessage({ target: 'match-host', job });
    if (result.error) throw new Error(result.error);
    return result;
  };
})(globalThis);
