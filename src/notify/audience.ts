let viewer: string | null = null;
export const setAlertViewer = (id: string | null) => { viewer = id; };
export const alertViewer = () => viewer;
