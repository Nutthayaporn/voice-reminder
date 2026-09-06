export const pushSupported = () => false;
export const pushEnabled = async () => false;
export const enableWebPush = async () => { throw new Error('Web Push is available in a supported browser.'); };
export const disableWebPush = async () => {};
export const testWebPush = async () => {};
