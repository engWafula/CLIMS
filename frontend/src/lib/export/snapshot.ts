/*
 * Pictures of rendered visuals for PDF reports and "Download image". Charts are
 * SVG styled by CSS variables, so they are captured as they look on screen, but
 * always in the light theme: a document is read on white paper whatever the
 * viewer's theme. html-to-image is loaded only when a picture is taken.
 */

export interface Snapshot {
  dataUrl: string;
  /** CSS pixels of the captured element. */
  width: number;
  height: number;
}

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

/** Leaves out controls (buttons, menus) and anything marked for the screen only. */
function keep(node: Node): boolean {
  if (!(node instanceof HTMLElement)) return true;
  if (node.dataset.printHide !== undefined || node.dataset.snapshotHide !== undefined) return false;
  return node.tagName !== 'BUTTON';
}

/**
 * Runs `capture` with the page in the light theme, then puts the viewer's theme
 * back. Two frames let the browser restyle the charts before they are read.
 */
export async function inLightTheme<T>(capture: () => Promise<T>): Promise<T> {
  const root = document.documentElement;
  const wasDark = root.classList.contains('dark');
  if (wasDark) {
    root.classList.remove('dark');
    await nextFrame();
    await nextFrame();
  }
  try {
    return await capture();
  } finally {
    if (wasDark) root.classList.add('dark');
  }
}

/** PNG pictures of `elements`, in order, at twice their CSS size for print sharpness. */
export async function snapshotElements(elements: readonly HTMLElement[]): Promise<Snapshot[]> {
  const [first] = elements;
  if (!first) return [];
  const { toPng, getFontEmbedCSS } = await import('html-to-image');
  return inLightTheme(async () => {
    // Fonts are embedded once and reused for every picture.
    const fontEmbedCSS = await getFontEmbedCSS(first).catch(() => '');
    const out: Snapshot[] = [];
    for (const element of elements) {
      const { width, height } = element.getBoundingClientRect();
      const dataUrl = await toPng(element, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        filter: keep,
        fontEmbedCSS,
        cacheBust: false,
      });
      out.push({ dataUrl, width, height });
    }
    return out;
  });
}
