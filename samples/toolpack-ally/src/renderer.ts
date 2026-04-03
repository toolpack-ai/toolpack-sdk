declare global {
  interface Window {
    toolpackAlly?: import('./preload').ToolpackAllyAPI;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const info = window.toolpackAlly;

  const setText = (id: string, value: string): void => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = value;
    }
  };

  if (info) {
    setText('app-name', info.appName);
    setText('version', info.version);
    setText('platform', info.platform);
    setText('platform-friendly', info.friendlyPlatform);
  }

  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (action === 'docs') {
        window.open('https://toolpack.ai/docs', '_blank', 'noopener');
      }
      if (action === 'support') {
        window.open('mailto:support@toolpack.ai');
      }
    });
  });
});

export {};
