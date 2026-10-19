// Shared by Firefox's background document and Chrome's offscreen document.
(function (root) {
  let active = 0;
  root.runMatchJob = function (job) {
    if (active >= 3) return Promise.reject(new Error('Matching is busy. Try again shortly.'));
    active++;
    return new Promise((resolve, reject) => {
      let worker;
      try { worker = new Worker(chrome.runtime.getURL('match-worker.js')); }
      catch (error) { active--; reject(error); return; }
      let ruleTimer, finished = false;
      const deadline = setTimeout(() => finish(new Error('Scan exceeded its 2 second budget. Reduce rules or page size.')), 2000);
      function finish(error, value) {
        if (finished) return; finished = true;
        clearTimeout(deadline); clearTimeout(ruleTimer); worker.terminate(); active--;
        error ? reject(error) : resolve(value);
      }
      worker.onmessage = ({ data }) => {
        if (data.progress) {
          clearTimeout(ruleTimer);
          ruleTimer = setTimeout(() => finish(new Error(`Regex ${data.progress} exceeded its 75 ms budget. Disable or simplify this rule.`)), 75);
        } else finish(data.error ? new Error(data.error) : null, data);
      };
      worker.onerror = event => finish(new Error(event.message || 'Matching worker failed.'));
      try { worker.postMessage(job); } catch (error) { finish(error); }
    });
  };
})(globalThis);
