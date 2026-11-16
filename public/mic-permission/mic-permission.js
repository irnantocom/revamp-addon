// Plain script: the extension CSP allows no inline code, and this page needs no bundle.
const result = document.getElementById('result');

document.getElementById('allow').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    result.className = 'ok';
    result.textContent = 'Microphone allowed. You can close this tab.';
  } catch (error) {
    result.className = 'error';
    result.textContent =
      error && error.name === 'NotFoundError'
        ? 'No microphone was found.'
        : 'The microphone is blocked. Click the lock icon in the address bar, allow the microphone, then try again.';
  }
});
