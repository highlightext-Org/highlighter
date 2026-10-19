importScripts('matcher.js');
self.onmessage = ({ data }) => {
  try {
    const match = Highlightext.createMatcher(data.rules, data.options, ruleId => self.postMessage({ progress: ruleId }));
    let remaining = 5000;
    const results = data.texts.map(text => { const matches = match(text, remaining); remaining -= matches.length; return matches; });
    self.postMessage({ results, capped: remaining === 0 });
  } catch (error) { self.postMessage({ error: error.message }); }
};
