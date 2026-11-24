import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { ComboboxField } from './ComboboxField';
import { FormDialog } from './FormDialog';
import { TextareaField } from './TextareaField';
import { TextField } from './TextField';

describe('shared form accessibility', () => {
  it('shows a labelled placeholder while combobox options load, then enables the choice', () => {
    const props = {
      label: 'District',
      value: '',
      onValueChange: () => undefined,
      options: [{ value: '1', label: 'Wakiso' }],
      placeholder: 'Choose a district',
      searchLabel: 'Search districts',
      noun: 'districts',
      required: true,
    };
    const { rerender, container } = render(<ComboboxField {...props} isLoading />);
    const field = screen.getByRole('combobox', { name: 'District' });
    expect(field).toBeDisabled();
    expect(field).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading districts…');
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    rerender(<ComboboxField {...props} />);
    expect(screen.getByRole('combobox', { name: 'District' })).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([TextField, TextareaField])(
    'keeps labels, guidance, errors and external descriptions connected',
    (Field) => {
      render(
        <>
          <p id="external">Required for the stock record.</p>
          <Field
            id="stock-note"
            label="Stock note"
            required
            description="Explain the movement."
            error="Enter a note."
            aria-describedby="external"
          />
        </>,
      );
      const input = screen.getByRole('textbox', { name: 'Stock note' });
      expect(input).toHaveAttribute('id', 'stock-note');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAccessibleDescription(
        'Explain the movement. Enter a note. Required for the stock record.',
      );
    },
  );

  it('moves focus to the first invalid field after submit', async () => {
    function Example() {
      const [submitted, setSubmitted] = useState(false);
      return (
        <FormDialog
          open
          onOpenChange={() => undefined}
          title="Register stock"
          description="Record a receipt."
          submitLabel="Save receipt"
          pendingLabel="Saving…"
          isPending={false}
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
          }}
        >
          <TextField label="Reference" required defaultValue="REF-1" />
          <TextField
            label="Batch number"
            required
            error={submitted ? 'Enter a batch number.' : undefined}
          />
          <TextareaField label="Note" error={submitted ? 'Enter a note.' : undefined} />
        </FormDialog>
      );
    }
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Save receipt' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Batch number' })).toHaveFocus(),
    );
  });
});
