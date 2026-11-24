import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageLoader } from './PageLoader';

describe('PageLoader', () => {
  it('matches a stockout request and its surrounding app frame', () => {
    const { container } = render(<PageLoader pathname="/dcfp/stockouts/request-1" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading page…');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(container.querySelector('[data-layout="stockout"]')).not.toBeNull();
    expect(container).toHaveTextContent('Stockout request');
    expect(container.querySelector('.md\\:flex')).not.toBeNull();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('uses the matched page shape for another workspace', () => {
    const { container } = render(<PageLoader pathname="/moh" />);
    expect(container.querySelector('[data-layout="dashboard"]')).not.toBeNull();
    expect(container).toHaveTextContent('MOH dashboard');
  });

  it('keeps the signed-out page in its own frame', () => {
    const { container } = render(<PageLoader pathname="/sign-in?from=%2Fdcfp" />);
    expect(container.querySelector('[data-layout]')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading page…');
  });
});
