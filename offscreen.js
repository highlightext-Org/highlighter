chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'match-host') return;
  runMatchJob(message.job).then(respond, error => respond({ error: error.message }));
  return true;
});
