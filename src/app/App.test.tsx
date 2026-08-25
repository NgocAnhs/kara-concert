import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: null }));

import { App } from './App';

describe('App', () => {
  it('shows the public practice catalog', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /concert practice/i })).toBeInTheDocument();
  });

  it('explains when the public catalog is not configured', () => {
    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent(/supabase/i);
  });
});
