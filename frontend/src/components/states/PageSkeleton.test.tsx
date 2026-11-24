import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageSkeleton } from './PageSkeleton';

describe('PageSkeleton', () => {
  it.each(['table', 'dashboard', 'detail', 'form', 'stockout'] as const)(
    'announces the %s layout once and hides its shapes',
    (layout) => {
      const { container } = render(<PageSkeleton layout={layout} />);

      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-busy', 'true');
      expect(status).toHaveAttribute('data-layout', layout);
      expect(status).toHaveTextContent(/^Loading page…$/);
      expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    },
  );

  it('draws a different shape for each layout', () => {
    const shapes = (['table', 'dashboard', 'detail', 'form', 'stockout'] as const).map((layout) => {
      const { container, unmount } = render(<PageSkeleton layout={layout} />);
      const count = container.querySelectorAll('[data-slot="skeleton"]').length;
      unmount();
      return count;
    });
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('takes a className for layout', () => {
    render(<PageSkeleton layout="form" className="mt-4" />);
    expect(screen.getByRole('status')).toHaveClass('mt-4');
  });
});
